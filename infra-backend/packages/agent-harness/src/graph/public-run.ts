/**
 * Execute a public graph.run (or validate-only helpers).
 */
import type { DbClient } from '@walkcroach/db';
import type { AgentRunner } from '../content-publish.js';
import { CrdbGraphCheckpointer } from './crdb-checkpointer.js';
import { MemoryGraphCheckpointer } from './checkpointer.js';
import { runGraph } from './executor.js';
import {
  compilePublicGraph,
  graphNeedsAgentRunner,
  type PublicGraphState,
} from './public-compile.js';
import {
  GRAPH_RUN_CONTRACT_VERSION,
  validatePublicGraph,
  type PublicGraphDefinition,
} from './public-catalog.js';

export type PublicGraphRunResult = {
  ok: boolean;
  contractVersion: typeof GRAPH_RUN_CONTRACT_VERSION;
  graphId: string;
  nodeExecutionCount: number;
  reviseCount: number;
  state: PublicGraphState;
  reason: string;
  error?: string;
  /** Per-node completion counts for metering. */
  visitCounts: Record<string, number>;
};

export async function runPublicGraph(params: {
  db: DbClient;
  projectId: string;
  runId: string;
  graph: PublicGraphDefinition;
  input?: Record<string, unknown>;
  runAgent?: AgentRunner;
  signal?: AbortSignal;
  onEvent?: (
    type: string,
    payload: Record<string, unknown>,
  ) => void | Promise<void>;
  /** When false, use memory checkpointer (tests). Default true when runId is uuid-like. */
  durable?: boolean;
}): Promise<PublicGraphRunResult> {
  const validated = validatePublicGraph(params.graph);
  if (!validated.ok) {
    return {
      ok: false,
      contractVersion: GRAPH_RUN_CONTRACT_VERSION,
      graphId: 'invalid',
      nodeExecutionCount: 0,
      reviseCount: 0,
      state: { input: params.input ?? {} },
      reason: 'validation_failed',
      error: validated.errors.join('; '),
      visitCounts: {},
    };
  }

  const def = validated.normalized;
  if (graphNeedsAgentRunner(def) && !params.runAgent) {
    return {
      ok: false,
      contractVersion: GRAPH_RUN_CONTRACT_VERSION,
      graphId: def.id ?? 'graph.run',
      nodeExecutionCount: 0,
      reviseCount: 0,
      state: { input: params.input ?? {} },
      reason: 'agent_required',
      error:
        'This graph includes plan/draft/revise nodes which require an agent runner',
      visitCounts: {},
    };
  }

  const compiled = compilePublicGraph(def, {
    db: params.db,
    projectId: params.projectId,
    runAgent: params.runAgent,
  });

  const durable = params.durable ?? true;
  const checkpointer = durable
    ? new CrdbGraphCheckpointer(params.db)
    : new MemoryGraphCheckpointer();

  const outcome = await runGraph<PublicGraphState>({
    runId: params.runId,
    graph: compiled,
    checkpointer,
    initialState: {
      input: params.input ?? {},
      text:
        typeof params.input?.text === 'string'
          ? params.input.text
          : typeof params.input?.content === 'string'
            ? params.input.content
            : undefined,
      pipelineOk: true,
    },
    signal: params.signal,
    onEvent: params.onEvent,
  });

  const state = outcome.state as PublicGraphState;
  const ok =
    outcome.status === 'completed' && state.pipelineOk !== false;

  const loaded = await checkpointer.load(params.runId);

  return {
    ok,
    contractVersion: GRAPH_RUN_CONTRACT_VERSION,
    graphId: compiled.id,
    nodeExecutionCount: outcome.nodeExecutionCount,
    reviseCount: outcome.reviseCount,
    state,
    reason: ok
      ? 'completed'
      : outcome.status === 'failed'
        ? 'graph_failed'
        : state.pipelineError
          ? 'pipeline_error'
          : outcome.status,
    ...(outcome.status === 'failed' || state.pipelineError
      ? {
          error:
            (outcome.status === 'failed' ? outcome.error : undefined) ??
            state.pipelineError,
        }
      : {}),
    visitCounts: loaded?.visitCounts ?? {},
  };
}
