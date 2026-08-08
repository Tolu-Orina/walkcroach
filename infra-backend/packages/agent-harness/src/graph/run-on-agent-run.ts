/**
 * Wire Graph executor to agent_runs checkpointer + agent_run_events.
 */
import type { DbClient } from '@walkcroach/db';
import { appendRunEvent } from '../run-store.js';
import { CrdbGraphCheckpointer } from './crdb-checkpointer.js';
import { runGraph, type RunGraphParams } from './executor.js';
import type { GraphDefinition, GraphRunOutcome, GraphState } from './types.js';

export async function runGraphOnAgentRun<S extends GraphState = GraphState>(params: {
  db: DbClient;
  runId: string;
  graphId?: string;
  graph?: GraphDefinition<S>;
  initialState?: S;
  signal?: AbortSignal;
}): Promise<GraphRunOutcome> {
  const checkpointer = new CrdbGraphCheckpointer(params.db);
  const onEvent: RunGraphParams['onEvent'] = async (type, payload) => {
    await appendRunEvent({
      db: params.db,
      runId: params.runId,
      type,
      payload,
    });
  };
  return runGraph({
    runId: params.runId,
    graphId: params.graphId,
    graph: params.graph,
    checkpointer,
    initialState: params.initialState,
    signal: params.signal,
    onEvent,
  });
}
