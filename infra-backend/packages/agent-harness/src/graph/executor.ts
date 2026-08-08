/**
 * Graph executor — directed edges, conditional routes, bounded cycles,
 * per-node timeout, checkpoint after every completed node.
 */
import type { GraphCheckpointer } from './checkpointer.js';
import { emptyCheckpoint } from './checkpointer.js';
import { getGraph } from './registry.js';
import type {
  GraphCheckpoint,
  GraphDefinition,
  GraphNodeDef,
  GraphRunOutcome,
  GraphState,
} from './types.js';

export type RunGraphParams<S extends GraphState = GraphState> = {
  runId: string;
  /** Registered graph id, or pass `graph` directly (tests). */
  graphId?: string;
  graph?: GraphDefinition<S>;
  checkpointer: GraphCheckpointer;
  initialState?: S;
  signal?: AbortSignal;
  /**
   * Emit progress events (maps to agent_run_events stage.*).
   * Must not throw — executor ignores emit failures after logging via payload.
   */
  onEvent?: (type: string, payload: Record<string, unknown>) => void | Promise<void>;
};

function resolveNext<S extends GraphState>(
  def: GraphDefinition<S>,
  from: string,
  state: S,
): string | null {
  const candidates = def.edges.filter((e) => e.from === from);
  if (candidates.length === 0) return null;
  for (const e of candidates) {
    if (!e.when || e.when(state)) {
      if (e.to === '__end__') return null;
      return e.to;
    }
  }
  // No matching conditional edge → treat as end (fail closed on dangling).
  return null;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number | undefined,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  if (!ms || ms <= 0) {
    return abortable(promise, signal);
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`node timeout after ${ms}ms: ${label}`)),
      ms,
    );
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

async function safeEmit(
  onEvent: RunGraphParams['onEvent'],
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await onEvent?.(type, payload);
  } catch {
    // Events must not fail the graph.
  }
}

/**
 * Execute (or resume) a graph from its checkpoint.
 *
 * Kill mid-node: last *completed* node is checkpointed; `currentStage` points at
 * the node that was about to run / was interrupted — resume re-executes that
 * node (nodes must be idempotent for durable quality).
 */
export async function runGraph<S extends GraphState = GraphState>(
  params: RunGraphParams<S>,
): Promise<GraphRunOutcome> {
  const def =
    params.graph ??
    (params.graphId ? (getGraph(params.graphId) as GraphDefinition<S> | undefined) : undefined);
  if (!def) {
    throw new Error(
      `graph not found: ${params.graphId ?? '(no graphId or graph provided)'}`,
    );
  }

  const nodes = new Map<string, GraphNodeDef<S>>(
    def.nodes.map((n) => [n.id, n as GraphNodeDef<S>]),
  );
  const checkpointWrites: Array<{ stage: string; writeMs: number }> = [];

  let cp =
    (await params.checkpointer.load(params.runId)) ??
    emptyCheckpoint(def.id, def.entry, params.initialState ?? {});

  if (cp.graphId && cp.graphId !== def.id) {
    throw new Error(
      `checkpoint graph_id mismatch: checkpoint=${cp.graphId} def=${def.id}`,
    );
  }
  cp = { ...cp, graphId: def.id };

  if (cp.status === 'completed' && cp.currentStage === null) {
    return {
      status: 'completed',
      state: cp.stageState as S,
      nodeExecutionCount: cp.nodeExecutionCount,
      reviseCount: cp.reviseCount,
      checkpointWrites,
    };
  }

  cp.status = 'running';
  cp.error = null;

  await safeEmit(params.onEvent, 'stage.graph_started', {
    graphId: def.id,
    currentStage: cp.currentStage,
    nodeExecutionCount: cp.nodeExecutionCount,
    resumed: cp.nodeExecutionCount > 0,
  });

  while (cp.currentStage) {
    if (params.signal?.aborted) {
      cp.status = 'paused';
      const write = await params.checkpointer.save(params.runId, cp);
      checkpointWrites.push({ stage: cp.currentStage, writeMs: write.writeMs });
      await safeEmit(params.onEvent, 'stage.paused', {
        reason: 'aborted',
        currentStage: cp.currentStage,
        checkpointWriteMs: write.writeMs,
      });
      return {
        status: 'paused',
        reason: 'aborted',
        state: cp.stageState,
        nodeExecutionCount: cp.nodeExecutionCount,
        reviseCount: cp.reviseCount,
        currentStage: cp.currentStage,
        checkpointWrites,
      };
    }

    if (cp.nodeExecutionCount >= def.maxNodeExecutions) {
      const error = `maxNodeExecutions exceeded (${def.maxNodeExecutions}) at stage ${cp.currentStage}`;
      cp.status = 'failed';
      cp.error = error;
      const write = await params.checkpointer.save(params.runId, cp);
      checkpointWrites.push({ stage: cp.currentStage, writeMs: write.writeMs });
      await safeEmit(params.onEvent, 'stage.bound_hit', {
        bound: 'maxNodeExecutions',
        max: def.maxNodeExecutions,
        currentStage: cp.currentStage,
        checkpointWriteMs: write.writeMs,
      });
      return {
        status: 'failed',
        error,
        state: cp.stageState,
        nodeExecutionCount: cp.nodeExecutionCount,
        reviseCount: cp.reviseCount,
        currentStage: cp.currentStage,
        checkpointWrites,
      };
    }

    const node = nodes.get(cp.currentStage);
    if (!node) {
      const error = `unknown stage node: ${cp.currentStage}`;
      cp.status = 'failed';
      cp.error = error;
      await params.checkpointer.save(params.runId, cp);
      return {
        status: 'failed',
        error,
        state: cp.stageState,
        nodeExecutionCount: cp.nodeExecutionCount,
        reviseCount: cp.reviseCount,
        currentStage: cp.currentStage,
        checkpointWrites,
      };
    }

    const stage = cp.currentStage;
    const visitCount = cp.visitCounts[stage] ?? 0;
    await safeEmit(params.onEvent, 'stage.started', {
      stage,
      kind: node.kind,
      visitCount,
      nodeExecutionCount: cp.nodeExecutionCount,
    });

    // Persist "about to run" so a kill mid-node resumes at this stage (not prior).
    {
      const write = await params.checkpointer.save(params.runId, {
        ...cp,
        status: 'running',
      });
      checkpointWrites.push({ stage: `${stage}:enter`, writeMs: write.writeMs });
      cp.stageStateVersion = write.version;
      await safeEmit(params.onEvent, 'stage.checkpoint', {
        stage,
        phase: 'enter',
        writeMs: write.writeMs,
        version: write.version,
      });
    }

    try {
      const timeoutMs = node.timeoutMs ?? def.defaultNodeTimeoutMs;
      const raw = await withTimeout(
        node.run({
          runId: params.runId,
          graphId: def.id,
          nodeId: stage,
          state: cp.stageState as S,
          visitCount,
          signal: params.signal,
          emit: (type, payload) =>
            safeEmit(params.onEvent, type, {
              stage,
              ...(payload ?? {}),
            }),
        }),
        timeoutMs,
        params.signal,
        stage,
      );

      let patch: Partial<S> = {};
      let reviseDelta = 0;
      if (raw && typeof raw === 'object') {
        if ('state' in raw || 'reviseDelta' in raw) {
          patch = (raw.state ?? {}) as Partial<S>;
          reviseDelta = Number(raw.reviseDelta ?? 0) || 0;
        } else {
          patch = raw as Partial<S>;
        }
      }

      if (node.resetOnRevisit && visitCount > 0) {
        cp.stageState = { ...(params.initialState ?? {}), ...patch } as GraphState;
      } else {
        cp.stageState = { ...cp.stageState, ...patch };
      }
      cp.reviseCount = Math.max(0, cp.reviseCount + reviseDelta);
      cp.visitCounts = {
        ...cp.visitCounts,
        [stage]: visitCount + 1,
      };
      cp.nodeExecutionCount += 1;

      const next = resolveNext(def, stage, cp.stageState as S);
      cp.currentStage = next;
      cp.status = next ? 'running' : 'completed';
      cp.error = null;

      const write = await params.checkpointer.save(params.runId, cp);
      cp.stageStateVersion = write.version;
      checkpointWrites.push({ stage: `${stage}:complete`, writeMs: write.writeMs });

      await safeEmit(params.onEvent, 'stage.completed', {
        stage,
        kind: node.kind,
        nextStage: next,
        nodeExecutionCount: cp.nodeExecutionCount,
        reviseCount: cp.reviseCount,
        checkpointWriteMs: write.writeMs,
      });
      await safeEmit(params.onEvent, 'stage.checkpoint', {
        stage,
        phase: 'complete',
        writeMs: write.writeMs,
        version: write.version,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        cp.status = 'paused';
        const write = await params.checkpointer.save(params.runId, cp);
        checkpointWrites.push({ stage: `${stage}:pause`, writeMs: write.writeMs });
        await safeEmit(params.onEvent, 'stage.paused', {
          reason: 'aborted',
          currentStage: stage,
          checkpointWriteMs: write.writeMs,
        });
        return {
          status: 'paused',
          reason: 'aborted',
          state: cp.stageState,
          nodeExecutionCount: cp.nodeExecutionCount,
          reviseCount: cp.reviseCount,
          currentStage: stage,
          checkpointWrites,
        };
      }
      const error = err instanceof Error ? err.message : String(err);
      cp.status = 'failed';
      cp.error = error;
      // Keep currentStage at the failed node for resume/diagnose.
      const write = await params.checkpointer.save(params.runId, cp);
      checkpointWrites.push({ stage: `${stage}:error`, writeMs: write.writeMs });
      await safeEmit(params.onEvent, 'stage.failed', {
        stage,
        error,
        checkpointWriteMs: write.writeMs,
      });
      return {
        status: 'failed',
        error,
        state: cp.stageState,
        nodeExecutionCount: cp.nodeExecutionCount,
        reviseCount: cp.reviseCount,
        currentStage: stage,
        checkpointWrites,
      };
    }
  }

  await safeEmit(params.onEvent, 'stage.graph_completed', {
    graphId: def.id,
    nodeExecutionCount: cp.nodeExecutionCount,
    reviseCount: cp.reviseCount,
  });

  return {
    status: 'completed',
    state: cp.stageState,
    nodeExecutionCount: cp.nodeExecutionCount,
    reviseCount: cp.reviseCount,
    checkpointWrites,
  };
}

/** Read-only helper for tests / workers inspecting a checkpoint. */
export function checkpointSummary(cp: GraphCheckpoint): {
  graphId: string;
  currentStage: string | null;
  nodeExecutionCount: number;
  reviseCount: number;
  status: GraphCheckpoint['status'];
} {
  return {
    graphId: cp.graphId,
    currentStage: cp.currentStage,
    nodeExecutionCount: cp.nodeExecutionCount,
    reviseCount: cp.reviseCount,
    status: cp.status,
  };
}
