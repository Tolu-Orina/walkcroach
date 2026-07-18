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
  distance: number;
};

export async function* streamRecall(
  auth: AuthContext,
  rawBody: string | undefined,
): AsyncGenerator<AgentEvent> {
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

    if (scope === 'workspace') {
      const { rows } = await db.query<RecallHit>(
        `SELECT id, url, title, LEFT(extracted_text, 2000) AS extracted_text,
                embedding <=> $3::vector AS distance
         FROM page_captures
         WHERE workspace_id = $1::uuid
           AND owner_id = $2
           AND embedding IS NOT NULL
           AND superseded_by IS NULL
         ORDER BY embedding <=> $3::vector
         LIMIT 8`,
        [b.workspaceId, auth.ownerId, vec],
      );
      hits = rows;
    } else {
      const { rows } = await db.query<RecallHit>(
        `SELECT id, url, title, LEFT(extracted_text, 2000) AS extracted_text,
                embedding <=> $2::vector AS distance
         FROM page_captures
         WHERE owner_id = $1
           AND embedding IS NOT NULL
           AND superseded_by IS NULL
         ORDER BY embedding <=> $2::vector
         LIMIT 8`,
        [auth.ownerId, vec],
      );
      hits = rows;
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

  if (!hits.length) {
    yield {
      type: 'token',
      text: 'I do not have any saved captures that match that yet. Save a page to a workspace first.',
    };
    yield { type: 'done', reason: 'complete' };
    return;
  }

  const context = hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.title ?? 'Untitled'} (${h.url})\n${h.extracted_text ?? ''}`,
    )
    .join('\n\n');

  for await (const ev of streamConverse({
    system:
      'You are WalkCroach recall. Answer using only the user\'s saved captures below. Cite which capture (by title/url) you used. If unsure, say so.',
    messages: [
      {
        role: 'user',
        content: [
          {
            text: `Saved captures:\n${context}\n\nQuestion: ${question}`,
          },
        ],
      },
    ],
  })) {
    yield ev;
  }
}
