import {
  formatVector,
  embedText,
  streamConverse,
  webSearch,
  type AgentEvent,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { getLinkedProjectId } from './link.js';
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
  /** When true, pre-ground Ask with SearXNG hits (same provider as Web Chat). */
  webSearchEnabled?: boolean;
};

function pageBlock(body: PageContextBody): string {
  const title = body.title?.trim() || '(untitled)';
  const url = body.url?.trim() || '';
  const text = truncateExtract(body.extractedText ?? '');
  return `URL: ${url}\nTitle: ${title}\n\nPage content:\n${text}`;
}

function formatSearchBlock(
  query: string,
  hits: Array<{ title: string; url: string; content: string }>,
): string {
  if (!hits.length) return '';
  const lines = hits.map(
    (h, i) =>
      `[${i + 1}] ${h.title}\n${h.url}\n${(h.content || '').slice(0, 280)}`,
  );
  return `Web search results for "${query}":\n${lines.join('\n\n')}`;
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

  let searchBlock = '';
  const wantSearch = body.webSearchEnabled === true;
  if (wantSearch) {
    try {
      const result = await webSearch(question, { limit: 5 });
      if (result.provider === 'searxng' && result.hits.length) {
        searchBlock = formatSearchBlock(question, result.hits);
        metricLog('chrome.ask.web_search', {
          hits: result.hits.length,
          ok: true,
        });
      } else {
        metricLog('chrome.ask.web_search', { hits: 0, ok: false });
      }
    } catch (err) {
      metricLog('chrome.ask.web_search', {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 80) : 'error',
      });
    }
  }

  const system = searchBlock
    ? 'You are WalkCroach. Prefer the provided page content for page-specific questions. You may also use the web search results when helpful — cite titles and URLs when you do. Be concise and practical. If neither source answers, say so.'
    : 'You are WalkCroach. Answer using only the provided page content unless the user asks for general knowledge. Be concise and practical. If the page lacks the answer, say so.';

  const userText = [
    pageBlock({ ...body, extractedText: text }),
    searchBlock,
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const t0 = Date.now();
  let first = true;
  for await (const ev of streamConverse({
    system,
    messages: [
      {
        role: 'user',
        content: [{ text: userText }],
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
  let projectContext = '';

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

      const linkedProjectId = await getLinkedProjectId(
        db,
        body.workspaceId,
        auth.ownerId,
      );
      if (linkedProjectId) {
        const { rows: projects } = await db.query<{
          name: string;
          instructions: string | null;
          memory_summary: string | null;
        }>(
          `SELECT name, instructions, memory_summary
           FROM projects
           WHERE id = $1::uuid
             AND owner_id = $2
             AND deleted_at IS NULL`,
          [linkedProjectId, auth.ownerId],
        );
        const project = projects[0];
        if (project) {
          const parts: string[] = [];
          const standing = project.instructions?.trim();
          if (standing) {
            parts.push(
              `Standing instructions for project "${project.name}" (follow these):\n${truncateExtract(standing, 4000)}`,
            );
          }
          const summary = project.memory_summary?.trim();
          if (summary) {
            parts.push(
              `Project memory summary:\n${truncateExtract(summary, 1500)}`,
            );
          }
          projectContext = parts.join('\n\n');
          if (projectContext) {
            metricLog('chrome.draft.project_context', {
              ok: true,
              hasInstructions: Boolean(standing),
              hasSummary: Boolean(summary),
            });
          }
        }
      }
    } finally {
      await db.close();
    }
  }

  for await (const ev of streamConverse({
    system: `You are WalkCroach drafting assistance. Tone: ${tone}. Propose draft text only — never send or submit. The user will insert it manually. When project standing instructions are provided, follow them.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            text: [
              `Instruction: ${instruction}`,
              page ? `Current page context:\n${page}` : '',
              projectContext ? `Linked WalkCroach project:\n${projectContext}` : '',
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
