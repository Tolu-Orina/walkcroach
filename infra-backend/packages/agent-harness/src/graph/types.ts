/**
 * Phase 3 — internal Graph runtime types (ADR-G).
 *
 * Macro orchestration for durable runs. Node-level ReAct stays in agent-engine /
 * sdk-host; this layer owns edges, bounds, checkpoints, and stage events.
 */

export type GraphNodeKind = 'code' | 'agent' | 'subagent' | 'gate';

/** Serializable stage bag — must survive CRDB JSONB round-trips. */
export type GraphState = Record<string, unknown>;

export type GraphNodeContext<S extends GraphState = GraphState> = {
  runId: string;
  graphId: string;
  nodeId: string;
  state: Readonly<S>;
  /** How many times this node id has completed in this run (0 before first). */
  visitCount: number;
  signal?: AbortSignal;
  /** Emit a stage.* / diagnostic event (executor also emits lifecycle events). */
  emit: (type: string, payload?: Record<string, unknown>) => void | Promise<void>;
};

export type GraphNodeResult<S extends GraphState = GraphState> =
  | void
  | Partial<S>
  | { state?: Partial<S>; reviseDelta?: number };

export type GraphNodeDef<S extends GraphState = GraphState> = {
  id: string;
  kind: GraphNodeKind;
  run: (ctx: GraphNodeContext<S>) => Promise<GraphNodeResult<S>>;
  /** Per-node timeout; falls back to graph defaultNodeTimeoutMs. */
  timeoutMs?: number;
  /**
   * When true, visiting this node again replaces prior state keys written by
   * this node only if the node returns a full replacement via `{ state }` —
   * default is accumulate (merge Partial into stage state). Strands analogue:
   * reset_on_revisit is modelled as node-returned replacement when set.
   */
  resetOnRevisit?: boolean;
};

export type GraphEdgeDef<S extends GraphState = GraphState> = {
  from: string;
  /** null / '__end__' = terminal success. */
  to: string | null;
  /** First matching edge from `from` wins; omit = unconditional. */
  when?: (state: S) => boolean;
};

export type GraphDefinition<S extends GraphState = GraphState> = {
  id: string;
  entry: string;
  nodes: readonly GraphNodeDef<S>[];
  edges: readonly GraphEdgeDef<S>[];
  /** Global ceiling on node completions (Strands max_node_executions). */
  maxNodeExecutions: number;
  defaultNodeTimeoutMs?: number;
};

export type GraphCheckpoint = {
  graphId: string;
  /** Next node to execute; null means graph completed successfully. */
  currentStage: string | null;
  stageState: GraphState;
  stageStateVersion: number;
  reviseCount: number;
  nodeExecutionCount: number;
  toolFingerprints: unknown[];
  checkpointAt: string;
  /** Per-node completion counts (for reset/visit tracking). */
  visitCounts: Record<string, number>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  error?: string | null;
};

export type GraphRunOutcome =
  | {
      status: 'completed';
      state: GraphState;
      nodeExecutionCount: number;
      reviseCount: number;
      checkpointWrites: Array<{ stage: string; writeMs: number }>;
    }
  | {
      status: 'failed';
      error: string;
      state: GraphState;
      nodeExecutionCount: number;
      reviseCount: number;
      currentStage: string | null;
      checkpointWrites: Array<{ stage: string; writeMs: number }>;
    }
  | {
      status: 'paused';
      reason: string;
      state: GraphState;
      nodeExecutionCount: number;
      reviseCount: number;
      currentStage: string | null;
      checkpointWrites: Array<{ stage: string; writeMs: number }>;
    };

export const GRAPH_END = null;
