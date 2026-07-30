import { streamConverse, type AgentEvent } from '@walkcroach/agent-harness';
import type { AuthContext } from '../auth.js';
import { assertRateLimit, metricLog, truncateExtract } from '../util.js';
import type { PageContextBody } from './llm.js';

export type ProposeBody = PageContextBody & {
  actionId?: string;
  captureType?: string;
  fields?: string[];
  label?: string;
};

/** Per-field cap. Stops a model dumping the whole page into `notes`. */
export const MAX_FIELD_CHARS = 400;

function pageBlock(body: PageContextBody): string {
  const title = body.title?.trim() || '(untitled)';
  const url = body.url?.trim() || '';
  const text = truncateExtract(body.extractedText ?? '');
  return `URL: ${url}\nTitle: ${title}\n\nPage content:\n${text}`;
}

/**
 * Per-capture-type extraction rules (Phase D1).
 *
 * A generic "extract these keys" prompt produced fields the confirm card could
 * not present usefully — arrays where a string was expected, invented job titles,
 * and, worst, plausible-looking email addresses that appeared nowhere on the
 * page. Contact details are the one field where a hallucination causes real-world
 * harm: the user emails a stranger. Hence the explicit rules below.
 */
const CAPTURE_GUIDANCE: Record<string, string> = {
  candidate: [
    '- name: the person as written on the page. If the page is a job posting rather than a person, leave every field empty.',
    '- role: their current title only. Do not infer seniority.',
    '- skills: comma-separated, at most 8, only skills named on the page.',
    '- contact: ONLY an email or phone number that appears verbatim on the page. If none is visible, leave it empty. Never construct, guess, or pattern-match an address from a name and company.',
    '- notes: one short sentence a recruiter would find useful.',
  ].join('\n'),
  lead: [
    '- company: the organisation name as written.',
    '- industry: their stated sector, in the page’s own words.',
    '- size: employee count or range only if stated. Leave empty otherwise — do not estimate.',
    '- location: headquarters or primary location as written.',
    '- notes: one short sentence on what they do and why they might be a fit.',
  ].join('\n'),
  price: [
    '- price: the current selling price as a bare number. No currency symbol, no thousands separators. If a sale price and a list price are both shown, use the price the buyer pays today.',
    '- currency: three-letter ISO code (USD, GBP, EUR).',
    '- productName: the product title, without marketing suffixes.',
  ].join('\n'),
  listing: [
    '- price: asking price as a bare number.',
    '- size: floor area with its unit, as written.',
    '- beds / baths: whole numbers only.',
    '- features: comma-separated, at most 6, from the page.',
    '- address: as written on the page. Do not complete a partial address.',
  ].join('\n'),
};

const BASE_RULES = [
  'Respond with ONLY a single JSON object. No markdown fences, no commentary.',
  'Use exactly these keys, all of them: {KEYS}.',
  'Every value must be a plain string. Use "" for anything not visible on the page.',
  'Never infer, estimate, or complete a value that is not stated on the page. An empty string is always better than a guess.',
].join('\n');

export function buildProposeSystemPrompt(
  label: string,
  captureType: string,
  fields: string[],
): string {
  const guidance = CAPTURE_GUIDANCE[captureType];
  return [
    `You are WalkCroach, extracting structured data from a web page for: ${label}.`,
    '',
    BASE_RULES.replace('{KEYS}', fields.join(', ')),
    guidance ? `\nField rules:\n${guidance}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Stream a structured extraction proposal. Tokens stream for UX;
 * a final `proposal` event carries parsed fields (FR-C12).
 */
export async function* streamPropose(
  auth: AuthContext,
  body: ProposeBody,
): AsyncGenerator<AgentEvent | ProposalEvent> {
  const limited = assertRateLimit(`llm:${auth.ownerId}`, 60, 60_000);
  if (limited) {
    yield { type: 'error', message: limited };
    return;
  }
  const text = truncateExtract(body.extractedText ?? '');
  if (text.length < 20) {
    yield { type: 'error', message: 'page extract too short' };
    return;
  }

  const fields = body.fields?.length ? body.fields : ['summary', 'notes'];
  const captureType = body.captureType || 'general';
  const label = body.label || 'Extract structured summary';

  const t0 = Date.now();
  let first = true;
  let full = '';

  for await (const ev of streamConverse({
    system: buildProposeSystemPrompt(label, captureType, fields),
    messages: [
      {
        role: 'user',
        content: [
          {
            text: `Action: ${body.actionId ?? 'extract'}\nCapture type: ${captureType}\n\n${pageBlock(body)}`,
          },
        ],
      },
    ],
  })) {
    if (ev.type === 'token') {
      full += ev.text;
      if (first) {
        metricLog('chrome.propose.ttfb_ms', { ms: Date.now() - t0 });
        first = false;
      }
    }
    yield ev;
  }

  const raw = parseJsonObject(full);
  if (!raw) {
    metricLog('chrome.propose.parse_failed', { captureType });
    yield {
      type: 'error',
      message: 'could not read a structured result from this page; try again',
    };
    return;
  }

  const { fields: normalized, filled } = normalizeProposal(raw, fields);

  // An all-empty proposal means the page was the wrong kind, not that the model
  // failed. Saying so beats handing the user a confirm card of blank inputs.
  if (filled === 0) {
    metricLog('chrome.propose.empty', { captureType });
    yield {
      type: 'error',
      message: `Nothing on this page looks like ${indefinite(captureType)}. Try it on a ${captureType} page, or use Summarize instead.`,
    };
    return;
  }

  metricLog('chrome.propose.ok', {
    captureType,
    filled,
    of: fields.length,
  });

  yield {
    type: 'proposal',
    captureType,
    actionId: body.actionId ?? 'extract',
    fields: normalized,
    summary: summarizeFields(normalized),
  } satisfies ProposalEvent;
}

export type ProposalEvent = {
  type: 'proposal';
  captureType: string;
  actionId: string;
  fields: Record<string, unknown>;
  summary: string;
};

/**
 * Recover the JSON object from whatever the model actually sent.
 *
 * Deliberately lenient: it slices from the first `{` to the last `}`, so markdown
 * fences, a leading "Sure!", and a single-object array wrapper (`[{…}]`) all
 * still yield the object. Anything that does not parse to a plain object is
 * rejected and the caller reports a read failure.
 *
 * Note the consequence of slicing: the `Array.isArray` check below can only fire
 * if this extraction changes, since a `{`…`}` slice never parses to an array. It
 * is kept as a guard on the contract, not as live protection.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `productName` / `product_name` / `Product Name` all collapse to `productname`. */
function keyOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function coerceValue(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return clean(raw);
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : '';
  }
  if (typeof raw === 'boolean') return '';
  if (Array.isArray(raw)) {
    // Models routinely return arrays for skills / features despite the prompt.
    return clean(
      raw
        .map((v) =>
          typeof v === 'string' || typeof v === 'number' ? String(v) : '',
        )
        .map((v) => v.trim())
        .filter(Boolean)
        .join(', '),
    );
  }
  return '';
}

/**
 * C0/C1 control characters and DEL survive `JSON.parse` inside string values and
 * render as invisible junk in the confirm-card inputs. Tested by codepoint rather
 * than a character-class literal so this source file holds no raw control bytes.
 */
function isControlCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function stripControl(value: string): string {
  let out = '';
  for (const ch of value) {
    out += isControlCode(ch.codePointAt(0) ?? 0) ? ' ' : ch;
  }
  return out;
}

function clean(value: string): string {
  const collapsed = stripControl(value).replace(/\s+/g, ' ').trim();
  // Models sometimes signal absence in words. Treat those as empty so the
  // confirm card shows a blank field rather than the string "N/A".
  if (/^(n\/?a|none|unknown|not (stated|specified|available|found)|null|-{1,2})$/i.test(collapsed)) {
    return '';
  }
  return collapsed.length > MAX_FIELD_CHARS
    ? `${collapsed.slice(0, MAX_FIELD_CHARS).trimEnd()}…`
    : collapsed;
}

/**
 * Force a model response into exactly the shape the confirm card expects.
 *
 * Returns the requested keys in the requested order, every value a trimmed
 * string, unrequested keys dropped. `filled` is how many came back non-empty,
 * which is what lets the caller distinguish "wrong kind of page" from "worked".
 */
export function normalizeProposal(
  raw: Record<string, unknown>,
  expected: string[],
): { fields: Record<string, string>; filled: number } {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw)) {
    const norm = keyOf(k);
    // First occurrence wins — a duplicated key is the model waffling.
    if (!byKey.has(norm)) byKey.set(norm, v);
  }

  const fields: Record<string, string> = {};
  let filled = 0;
  for (const name of expected) {
    const value = coerceValue(byKey.get(keyOf(name)));
    fields[name] = value;
    if (value) filled++;
  }
  return { fields, filled };
}

/** One readable line per populated field; empties are not worth the space. */
export function summarizeFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => String(v ?? '').trim().length > 0)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('\n');
}

function indefinite(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}
