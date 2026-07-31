import {
  embedText,
  formatVector,
  streamConverse,
  type AgentEvent,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { metricLog, parseJsonBody } from '../util.js';

type RecallHit = {
  id: string;
  url: string;
  title: string | null;
  extracted_text: string | null;
  capture_type: string;
  workspace_name: string | null;
  project_id: string | null;
  captured_at: string;
  distance: number;
};

/**
 * Cited sources, emitted before the answer streams (Phase D5).
 *
 * The handler already told the model to cite its captures, but citations only
 * existed inside the prose — the panel received a bare `memory_recalled { count }`
 * and could not show what the answer was built from. Sending the hits themselves
 * makes the memory graph visible and clickable, which is the point of the
 * Agentic Memory story.
 */
export type RecallSource = {
  captureId: string;
  url: string;
  title: string | null;
  captureType: string;
  workspace: string | null;
  /** True when this capture is mirrored into a linked WalkCroach Web project. */
  inWebProject: boolean;
  capturedAt: string;
  /** Cosine distance; lower is closer. Rendered as relevance, not shown raw. */
  distance: number;
};

type WorkflowHit = {
  id: string;
  action: string;
  result: Record<string, unknown> | null;
  executed_at: string | null;
  provider: string | null;
  distance: number;
};

export type RecallSourcesEvent = {
  type: 'recall_sources';
  sources: RecallSource[];
};

export async function* streamRecall(
  auth: AuthContext,
  rawBody: string | undefined,
): AsyncGenerator<AgentEvent | RecallSourcesEvent> {
  const body = parseJsonBody<{
    question?: string;
    workspaceId?: string | null;
    scope?: 'workspace' | 'all';
  }>(rawBody);
  if ('error' in body && body.error === 'invalid JSON body') {
    yield { type: 'error', message: 'invalid JSON body' };
    return;
  }
  const b = body as {
    question?: string;
    workspaceId?: string | null;
    scope?: 'workspace' | 'all';
  };
  const question = b.question?.trim();
  if (!question) {
    yield { type: 'error', message: 'question required' };
    return;
  }

  const scope = b.scope ?? (b.workspaceId ? 'workspace' : 'all');
  if (scope === 'workspace' && !b.workspaceId) {
    yield { type: 'error', message: 'workspaceId required for workspace scope' };
    return;
  }

  const t0 = Date.now();
  const db = createDbClient();
  let hits: RecallHit[] = [];
  let runHits: WorkflowHit[] = [];
  let vecForRuns = '';
  try {
    if (scope === 'workspace' && b.workspaceId) {
      const owned = await db.query(
        `SELECT 1 FROM workspaces WHERE id = $1::uuid AND owner_id = $2`,
        [b.workspaceId, auth.ownerId],
      );
      if (!owned.rows[0]) {
        yield { type: 'error', message: 'workspace not found' };
        return;
      }
    }

    const embedding = await embedText(question);
    const vec = formatVector(embedding);
    vecForRuns = vec;

    if (scope === 'workspace') {
      const { rows } = await db.query<RecallHit>(
        `SELECT c.id, c.url, c.title,
                LEFT(c.extracted_text, 2000) AS extracted_text,
                c.capture_type, c.project_id, c.captured_at,
                w.name AS workspace_name,
                c.embedding <=> $3::vector AS distance
         FROM page_captures c
         LEFT JOIN workspaces w ON w.id = c.workspace_id
         WHERE c.workspace_id = $1::uuid
           AND c.owner_id = $2
           AND c.embedding IS NOT NULL
           AND c.superseded_by IS NULL
         ORDER BY c.embedding <=> $3::vector
         LIMIT 8`,
        [b.workspaceId, auth.ownerId, vec],
      );
      hits = rows;
    } else {
      const { rows } = await db.query<RecallHit>(
        `SELECT c.id, c.url, c.title,
                LEFT(c.extracted_text, 2000) AS extracted_text,
                c.capture_type, c.project_id, c.captured_at,
                w.name AS workspace_name,
                c.embedding <=> $2::vector AS distance
         FROM page_captures c
         LEFT JOIN workspaces w ON w.id = c.workspace_id
         WHERE c.owner_id = $1
           AND c.embedding IS NOT NULL
           AND c.superseded_by IS NULL
         ORDER BY c.embedding <=> $2::vector
         LIMIT 8`,
        [auth.ownerId, vec],
      );
      hits = rows;
    }
    /*
      E8 — actions are memory too.

      "What did we send last week" is a question about `workflow_runs`, not about
      saved pages, and answering it only in Web Chat would make the memory layer
      surface-specific. Runs are searched in the same embedding space and merged
      by distance, so a single answer can cite a saved quote and the email that
      went out about it.

      Scoped to executed runs: a proposal the user declined is auditable in
      history, but it is not something that happened, and recalling it as if it
      were would be actively misleading.
    */
    try {
      const { rows } = await db.query<WorkflowHit>(
        `SELECT r.id, r.action, r.result, r.executed_at,
                c.provider,
                r.embedding <=> $2::vector AS distance
         FROM workflow_runs r
         LEFT JOIN connectors c ON c.id = r.connector_id
         WHERE r.owner_id = $1
           AND r.status = 'executed'
           AND r.embedding IS NOT NULL
         ORDER BY r.embedding <=> $2::vector
         LIMIT 4`,
        [auth.ownerId, vecForRuns],
      );
      runHits = rows;
    } catch {
      // Pre-migration databases have no workflow_runs; recall still works.
      runHits = [];
    }
  } finally {
    await db.close();
  }

  metricLog('chrome.recall.latency_ms', {
    ms: Date.now() - t0,
    hits: hits.length,
  });

  yield {
    type: 'memory_recalled',
    count: hits.length,
  };

  if (hits.length) {
    yield {
      type: 'recall_sources',
      sources: hits.map(toSource),
    } satisfies RecallSourcesEvent;
  }

  if (runHits.length) {
    yield {
      type: 'recall_sources',
      sources: runHits.map(runToSource),
    } satisfies RecallSourcesEvent;
  }

  if (!hits.length && !runHits.length) {
    yield {
      type: 'token',
      text: 'I do not have any saved captures that match that yet. Save a page to a workspace first.',
    };
    yield { type: 'done', reason: 'complete' };
    return;
  }

  const runContext = runHits
    .map(
      (r, i) =>
        `[A${i + 1}] Action: ${r.action}${r.provider ? ` via ${r.provider}` : ''}, executed ${r.executed_at ?? 'recently'}
${JSON.stringify(r.result ?? {}).slice(0, 500)}`,
    )
    .join('\n\n');

  const context = hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.title ?? 'Untitled'} (${h.url})\n${h.extracted_text ?? ''}`,
    )
    .join('\n\n');

  for await (const ev of streamConverse({
    system: [
      'You are WalkCroach recall.',
      'Answer using only the saved captures and actions below. They are numbered.',
      'Cite captures by their number like [2], and actions like [A1].',
      'The panel renders the numbered sources beside your answer, so do not repeat their URLs.',
      'Actions listed are things that already happened. Never describe a capture as an action, or an action as something still to do.',
      'If the material does not answer the question, say so plainly rather than guessing.',
    ].join(' '),
    messages: [
      {
        role: 'user',
        content: [
          {
            text: [
              hits.length ? `Saved captures:\n${context}` : '',
              runHits.length ? `Actions you took:\n${runContext}` : '',
              `Question: ${question}`,
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

function toSource(hit: RecallHit): RecallSource {
  return {
    captureId: hit.id,
    url: hit.url,
    title: hit.title,
    captureType: hit.capture_type,
    workspace: hit.workspace_name,
    inWebProject: Boolean(hit.project_id),
    capturedAt: hit.captured_at,
    distance: hit.distance,
  };
}

/**
 * Present an executed action as a recall source.
 *
 * Reuses the capture source shape so the panel renders both in one list — from a
 * user's point of view "the quote I saved" and "the email I sent about it" are
 * the same kind of memory, and splitting them into two UIs would be an
 * implementation detail leaking into the product.
 */
function runToSource(hit: WorkflowHit): RecallSource {
  return {
    captureId: hit.id,
    url: '',
    title: describeRun(hit),
    captureType: 'action',
    workspace: hit.provider,
    inWebProject: false,
    capturedAt: hit.executed_at ?? new Date().toISOString(),
    distance: hit.distance,
  };
}

function describeRun(hit: WorkflowHit): string {
  const result = hit.result ?? {};
  switch (hit.action) {
    case 'gmail.send':
      return 'Email sent';
    case 'gmail.draft':
      return 'Email drafted';
    case 'calendar.create_event':
      return `Calendar event: ${String(result.summary ?? 'created')}`;
    case 'slack.post_message':
      return 'Posted to Slack';
    default:
      return hit.action;
  }
}
