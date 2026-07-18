import {
  formatVector,
  embedText,
  streamConverse,
  type AgentEvent,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { assertRateLimit, metricLog, truncateExtract } from '../util.js';

export type PageContextBody = {
  url?: string;
  title?: string;
  extractedText?: string;
  contentHash?: string;
  workspaceId?: string | null;
  question?: string;
  instruction?: string;
  tone?: string;
};

function pageBlock(body: PageContextBody): string {
  const title = body.title?.trim() || '(untitled)';
  const url = body.url?.trim() || '';
  const text = truncateExtract(body.extractedText ?? '');
  return `URL: ${url}\nTitle: ${title}\n\nPage content:\n${text}`;
}

export async function* streamSummarize(
  auth: AuthContext,
  body: PageContextBody,
): AsyncGenerator<AgentEvent> {
  const limited = assertRateLimit(`llm:${auth.ownerId}`, 60, 60_000);
  if (limited) {
    yield { type: 'error', message: limited };
    return;
  }
  const text = truncateExtract(body.extractedText ?? '');
  if (text.length < 40) {
    yield { type: 'error', message: 'page extract too short to summarize' };
    return;
  }
  const t0 = Date.now();
  let first = true;
  metricLog('chrome.extract.chars', { chars: text.length, route: 'summarize' });
  for await (const ev of streamConverse({
    system:
      'You are WalkCroach, a concise browser copilot for SME professionals. Summarize the page in clear plain language. Use short paragraphs or bullets. Do not invent facts not present in the page.',
    messages: [
      {
        role: 'user',
        content: [{ text: `Summarize this page.\n\n${pageBlock(body)}` }],
      },
    ],
  })) {
    if (ev.type === 'token' && first) {
      metricLog('chrome.summarize.ttfb_ms', { ms: Date.now() - t0 });
      first = false;
    }
    yield ev;
  }
}

export async function* streamAsk(
  auth: AuthContext,
  body: PageContextBody,
): AsyncGenerator<AgentEvent> {
  const limited = assertRateLimit(`llm:${auth.ownerId}`, 60, 60_000);
  if (limited) {
    yield { type: 'error', message: limited };
    return;
  }
  const question = body.question?.trim();
  if (!question) {
    yield { type: 'error', message: 'question required' };
    return;
  }
  const text = truncateExtract(body.extractedText ?? '');
  if (text.length < 20) {
    yield { type: 'error', message: 'page extract too short' };
    return;
  }
  const t0 = Date.now();
  let first = true;
  for await (const ev of streamConverse({
    system:
      'You are WalkCroach. Answer using only the provided page content unless the user asks for general knowledge. Be concise and practical. If the page lacks the answer, say so.',
    messages: [
      {
        role: 'user',
        content: [
          {
            text: `${pageBlock({ ...body, extractedText: text })}\n\nQuestion: ${question}`,
          },
        ],
      },
    ],
  })) {
    if (ev.type === 'token' && first) {
      metricLog('chrome.ask.ttfb_ms', { ms: Date.now() - t0 });
      first = false;
    }
    yield ev;
  }
}

export async function* streamDraft(
  auth: AuthContext,
  body: PageContextBody,
): AsyncGenerator<AgentEvent> {
  const limited = assertRateLimit(`llm:${auth.ownerId}`, 60, 60_000);
  if (limited) {
    yield { type: 'error', message: limited };
    return;
  }
  const instruction =
    body.instruction?.trim() || 'Draft a clear, professional reply.';
  const tone = body.tone?.trim() || 'professional, plain language';
  const page = truncateExtract(body.extractedText ?? '');
  let workspaceContext = '';

  if (body.workspaceId) {
    const db = createDbClient();
    try {
      const owned = await db.query(
        `SELECT 1 FROM workspaces WHERE id = $1::uuid AND owner_id = $2`,
        [body.workspaceId, auth.ownerId],
      );
      if (!owned.rows[0]) {
        yield { type: 'error', message: 'workspace not found' };
        return;
      }
      const { rows } = await db.query<{ title: string; extracted_text: string }>(
        `SELECT title, LEFT(extracted_text, 1500) AS extracted_text
         FROM page_captures
         WHERE workspace_id = $1::uuid
           AND owner_id = $2
           AND superseded_by IS NULL
         ORDER BY captured_at DESC
         LIMIT 5`,
        [body.workspaceId, auth.ownerId],
      );
      if (rows.length) {
        workspaceContext = rows
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title ?? 'capture'}: ${r.extracted_text ?? ''}`,
          )
          .join('\n');
      }
    } finally {
      await db.close();
    }
  }

  for await (const ev of streamConverse({
    system: `You are WalkCroach drafting assistance. Tone: ${tone}. Propose draft text only — never send or submit. The user will insert it manually.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            text: [
              `Instruction: ${instruction}`,
              page ? `Current page context:\n${page}` : '',
              workspaceContext
                ? `Saved workspace context:\n${workspaceContext}`
                : '',
              'Write the draft now.',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
      },
    ],
  })) {
    yield ev;
  }
}

export { embedText, formatVector };
