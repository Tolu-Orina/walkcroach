/**
 * Phase 8 — prune durable Graph checkpoint payloads on terminal runs.
 *
 * LangGraph production lesson: checkpoint growth needs TTL/GC. We keep row
 * metadata (graph_id, revise_count, …) for audit but null out bulky
 * `stage_state` after retention so CRDB stays bounded.
 */
import type { DbClient } from '@walkcroach/db';

/** Default retention for bulky stage_state on terminal graph runs. */
export const GRAPH_CHECKPOINT_RETENTION_DAYS = 30;

export type PruneGraphCheckpointsResult = {
  pruned: number;
  retentionDays: number;
};

/**
 * Clear `stage_state` (set to `{}`) for succeeded/failed/cancelled graph runs
 * whose `finished_at` is older than `retentionDays`.
 */
export async function pruneStaleGraphCheckpoints(
  db: DbClient,
  opts?: { retentionDays?: number; limit?: number },
): Promise<PruneGraphCheckpointsResult> {
  const retentionDays = opts?.retentionDays ?? GRAPH_CHECKPOINT_RETENTION_DAYS;
  const limit = opts?.limit ?? 500;

  const { rowCount } = await db.query(
    `UPDATE agent_runs
        SET stage_state = '{}'::jsonb,
            checkpoint_at = NULL
      WHERE id IN (
        SELECT id FROM agent_runs
         WHERE graph_id IS NOT NULL
           AND status IN ('succeeded', 'failed', 'cancelled')
           AND finished_at IS NOT NULL
           AND finished_at < now() - ($1::int * INTERVAL '1 day')
           AND stage_state <> '{}'::jsonb
         ORDER BY finished_at ASC
         LIMIT $2
      )`,
    [retentionDays, limit],
  );

  return { pruned: rowCount ?? 0, retentionDays };
}
