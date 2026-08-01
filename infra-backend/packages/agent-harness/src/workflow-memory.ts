/**
 * workflow_runs semantic recall (Phase F5).
 * "What did we send last week" → Titan embed + vector search.
 */
import type { DbClient } from '@walkcroach/db';
import { embedText } from './bedrock.js';
import { formatVector } from './memory.js';

export type WorkflowRecallHit = {
  id: string;
  action: string;
  status: string;
  surface: string;
  summary: string;
  distance: number;
  createdAt: string;
  executedAt: string | null;
};

export function workflowEmbedText(params: {
  action: string;
  proposed: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  status?: string;
}): string {
  const args =
    (params.proposed?.args as Record<string, unknown> | undefined) ??
    params.proposed;
  const parts = [
    `action:${params.action}`,
    params.status ? `status:${params.status}` : '',
    typeof args.to === 'string'
      ? `to:${args.to}`
      : Array.isArray(args.to)
        ? `to:${(args.to as string[]).join(',')}`
        : '',
    typeof args.subject === 'string' ? `subject:${args.subject}` : '',
    typeof args.summary === 'string' ? `summary:${args.summary}` : '',
    typeof args.channel === 'string' ? `channel:${args.channel}` : '',
    typeof args.text === 'string' ? `text:${args.text}` : '',
    typeof args.body === 'string' ? `body:${String(args.body).slice(0, 500)}` : '',
    typeof args.spreadsheetId === 'string'
      ? `sheet:${args.spreadsheetId}`
      : '',
    typeof args.email === 'string' ? `email:${args.email}` : '',
    params.result ? `result:${JSON.stringify(params.result).slice(0, 400)}` : '',
  ];
  return parts.filter(Boolean).join('\n').slice(0, 8000);
}

export async function embedAndStoreWorkflowRun(params: {
  db: DbClient;
  runId: string;
  action: string;
  proposed: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  status?: string;
}): Promise<void> {
  const text = workflowEmbedText(params);
  const embedding = await embedText(text);
  const vec = formatVector(embedding);
  await params.db.query(
    `UPDATE workflow_runs SET embedding = $2::vector WHERE id = $1::uuid`,
    [params.runId, vec],
  );
}

/**
 * Semantic recall over this owner's executed/failed workflow runs.
 */
export async function recallWorkflowRuns(params: {
  db: DbClient;
  ownerId: string;
  query: string;
  limit?: number;
}): Promise<WorkflowRecallHit[]> {
  const limit = Math.min(10, Math.max(1, params.limit ?? 5));
  const embedding = await embedText(params.query);
  const vec = formatVector(embedding);

  const { rows } = await params.db.query<{
    id: string;
    action: string;
    status: string;
    surface: string;
    proposed_action: Record<string, unknown>;
    result: Record<string, unknown> | null;
    distance: number;
    created_at: Date;
    executed_at: Date | null;
  }>(
    /**
     * Pins both prefix columns of `workflow_runs_recall_idx`
     * (owner_id, status) and nothing else.
     *
     * The three-status IN list stays in SQL because an IN list counts as
     * constraining a prefix column — verified against the cluster, and the
     * reason this query needs no caller-side filtering at all. `embedding IS
     * NOT NULL` is dropped as redundant, with a null-distance guard below for
     * the exact-scan fallback. See migrations 031/032.
     */
    `SELECT id, action, status, surface, proposed_action, result,
            embedding <=> $2::vector AS distance,
            created_at, executed_at
     FROM workflow_runs
     WHERE owner_id = $1
       AND status IN ('executed', 'failed', 'declined')
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [params.ownerId, vec, limit],
  );

  return rows
    .filter((r) => r.distance !== null)
    .map((r) => ({
    id: r.id,
    action: r.action,
    status: r.status,
    surface: r.surface,
    summary: workflowEmbedText({
      action: r.action,
      proposed: r.proposed_action ?? {},
      result: r.result,
      status: r.status,
    }).slice(0, 400),
    distance: Number(r.distance),
    createdAt: r.created_at.toISOString(),
    executedAt: r.executed_at ? r.executed_at.toISOString() : null,
  }));
}
