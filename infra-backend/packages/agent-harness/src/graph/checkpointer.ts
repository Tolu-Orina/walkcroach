/**
 * Graph checkpointer — after every completed node (LangGraph PostgresSaver shape).
 */
import type { GraphCheckpoint, GraphState } from './types.js';

export type CheckpointWriteResult = {
  writeMs: number;
  version: number;
};

export interface GraphCheckpointer {
  load(runId: string): Promise<GraphCheckpoint | null>;
  save(runId: string, checkpoint: GraphCheckpoint): Promise<CheckpointWriteResult>;
}

/** In-memory checkpointer for unit tests and local dry-runs. */
export class MemoryGraphCheckpointer implements GraphCheckpointer {
  readonly store = new Map<string, GraphCheckpoint>();
  /** Artificial delay to exercise latency accounting (ms). */
  latencyMs = 0;

  async load(runId: string): Promise<GraphCheckpoint | null> {
    const cp = this.store.get(runId);
    return cp ? structuredClone(cp) : null;
  }

  async save(
    runId: string,
    checkpoint: GraphCheckpoint,
  ): Promise<CheckpointWriteResult> {
    const started = performance.now();
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }
    const prev = this.store.get(runId);
    const nextVersion = (prev?.stageStateVersion ?? 0) + 1;
    const next: GraphCheckpoint = {
      ...structuredClone(checkpoint),
      checkpointAt: new Date().toISOString(),
      stageStateVersion: nextVersion,
    };
    this.store.set(runId, next);
    return {
      writeMs: Math.max(0, performance.now() - started),
      version: nextVersion,
    };
  }
}

export function emptyCheckpoint(
  graphId: string,
  entry: string,
  initialState: GraphState = {},
): GraphCheckpoint {
  return {
    graphId,
    currentStage: entry,
    stageState: { ...initialState },
    stageStateVersion: 1,
    reviseCount: 0,
    nodeExecutionCount: 0,
    toolFingerprints: [],
    checkpointAt: new Date().toISOString(),
    visitCounts: {},
    status: 'pending',
    error: null,
  };
}
