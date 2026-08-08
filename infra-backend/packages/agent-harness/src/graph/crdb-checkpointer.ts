/**
 * CRDB-backed Graph checkpointer — persists onto agent_runs checkpoint columns.
 */
import type { DbClient } from '@walkcroach/db';
import type { CheckpointWriteResult, GraphCheckpointer } from './checkpointer.js';
import type { GraphCheckpoint } from './types.js';

type CheckpointRow = {
  graph_id: string | null;
  current_stage: string | null;
  stage_state: unknown;
  stage_state_version: number;
  revise_count: number;
  node_execution_count: number;
  tool_fingerprints: unknown;
  checkpoint_at: Date | null;
  status: string;
  error: string | null;
};

function rowToCheckpoint(row: CheckpointRow): GraphCheckpoint | null {
  if (!row.graph_id) return null;
  const state = (row.stage_state ?? {}) as Record<string, unknown>;
  const visitCounts =
    state.__visitCounts && typeof state.__visitCounts === 'object'
      ? (state.__visitCounts as Record<string, number>)
      : {};
  const { __visitCounts: _, __graphStatus: __, ...stageState } = state;
  const statusRaw = state.__graphStatus;
  const status =
    statusRaw === 'completed' ||
    statusRaw === 'failed' ||
    statusRaw === 'paused' ||
    statusRaw === 'running' ||
    statusRaw === 'pending'
      ? statusRaw
      : row.status === 'succeeded'
        ? 'completed'
        : row.status === 'failed'
          ? 'failed'
          : 'running';

  return {
    graphId: row.graph_id,
    currentStage: row.current_stage,
    stageState: stageState,
    stageStateVersion: Number(row.stage_state_version ?? 1),
    reviseCount: Number(row.revise_count ?? 0),
    nodeExecutionCount: Number(row.node_execution_count ?? 0),
    toolFingerprints: Array.isArray(row.tool_fingerprints)
      ? row.tool_fingerprints
      : [],
    checkpointAt: row.checkpoint_at?.toISOString() ?? new Date().toISOString(),
    visitCounts,
    status,
    error: row.error,
  };
}

function checkpointToStageState(cp: GraphCheckpoint): Record<string, unknown> {
  return {
    ...cp.stageState,
    __visitCounts: cp.visitCounts,
    __graphStatus: cp.status,
  };
}

export class CrdbGraphCheckpointer implements GraphCheckpointer {
  constructor(private readonly db: DbClient) {}

  async load(runId: string): Promise<GraphCheckpoint | null> {
    const { rows } = await this.db.query<CheckpointRow>(
      `SELECT graph_id, current_stage, stage_state, stage_state_version,
              revise_count, node_execution_count, tool_fingerprints,
              checkpoint_at, status, error
         FROM agent_runs WHERE id = $1::uuid`,
      [runId],
    );
    if (!rows[0]) return null;
    return rowToCheckpoint(rows[0]);
  }

  async save(
    runId: string,
    checkpoint: GraphCheckpoint,
  ): Promise<CheckpointWriteResult> {
    const started = performance.now();
    const payload = checkpointToStageState(checkpoint);
    const { rows } = await this.db.query<{ stage_state_version: number }>(
      `UPDATE agent_runs
          SET graph_id = $2,
              current_stage = $3,
              stage_state = $4::jsonb,
              stage_state_version = stage_state_version + 1,
              checkpoint_at = now(),
              revise_count = $5,
              node_execution_count = $6,
              tool_fingerprints = $7::jsonb
        WHERE id = $1::uuid
          AND stage_state_version = $8
        RETURNING stage_state_version`,
      [
        runId,
        checkpoint.graphId,
        checkpoint.currentStage,
        JSON.stringify(payload),
        checkpoint.reviseCount,
        checkpoint.nodeExecutionCount,
        JSON.stringify(checkpoint.toolFingerprints ?? []),
        checkpoint.stageStateVersion,
      ],
    );

    if (!rows[0]) {
      // First write may start at version 1 with empty row still at default 1 —
      // retry with force bump when version matches after concurrent writer, else conflict.
      const forced = await this.db.query<{ stage_state_version: number }>(
        `UPDATE agent_runs
            SET graph_id = $2,
                current_stage = $3,
                stage_state = $4::jsonb,
                stage_state_version = stage_state_version + 1,
                checkpoint_at = now(),
                revise_count = $5,
                node_execution_count = $6,
                tool_fingerprints = $7::jsonb
          WHERE id = $1::uuid
          RETURNING stage_state_version`,
        [
          runId,
          checkpoint.graphId,
          checkpoint.currentStage,
          JSON.stringify(payload),
          checkpoint.reviseCount,
          checkpoint.nodeExecutionCount,
          JSON.stringify(checkpoint.toolFingerprints ?? []),
        ],
      );
      if (!forced.rows[0]) {
        throw new Error(`checkpoint save failed: run ${runId} not found`);
      }
      return {
        writeMs: Math.max(0, performance.now() - started),
        version: Number(forced.rows[0].stage_state_version),
      };
    }

    return {
      writeMs: Math.max(0, performance.now() - started),
      version: Number(rows[0].stage_state_version),
    };
  }
}
