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

function pageBlock(body: PageContextBody): string {
  const title = body.title?.trim() || '(untitled)';
  const url = body.url?.trim() || '';
  const text = truncateExtract(body.extractedText ?? '');
  return `URL: ${url}\nTitle: ${title}\n\nPage content:\n${text}`;
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

  const fields = body.fields?.length
    ? body.fields
    : ['summary', 'notes'];
  const captureType = body.captureType || 'general';
  const label = body.label || 'Extract structured summary';

  const t0 = Date.now();
  let first = true;
  let full = '';

  for await (const ev of streamConverse({
    system: `You are WalkCroach. Extract structured data from the page for: ${label}.
Respond with ONLY a single JSON object (no markdown fences) using exactly these keys: ${fields.join(', ')}.
Use empty string for unknown values. Do not invent facts not visible on the page.`,
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

  const fieldsObj = parseJsonObject(full);
  if (!fieldsObj) {
    yield {
      type: 'error',
      message: 'could not parse structured proposal; try again',
    };
    return;
  }

  yield {
    type: 'proposal',
    captureType,
    actionId: body.actionId ?? 'extract',
    fields: fieldsObj,
    summary: summarizeFields(fieldsObj),
  } satisfies ProposalEvent;
}

export type ProposalEvent = {
  type: 'proposal';
  captureType: string;
  actionId: string;
  fields: Record<string, unknown>;
  summary: string;
};

function parseJsonObject(text: string): Record<string, unknown> | null {
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

function summarizeFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}: ${String(v ?? '')}`)
    .join('\n');
}
