/**
 * Phase 3 Graph runtime — exit criteria without CRDB.
 *
 * 1. Kill mid-node → resume at correct stage with state (idempotent writes)
 * 2. Cyclic dummy hits maxNodeExecutions cleanly
 * 3. Checkpoint write latency recorded (never dropped)
 * 4. Second graph registers without changing executor
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryGraphCheckpointer,
  buildDummyCycleGraph,
  buildDummyLinearGraph,
  clearGraphRegistry,
  defineGraph,
  ensureDummyGraphsRegistered,
  getGraph,
  listRegisteredGraphs,
  registerGraph,
  runGraph,
} from './index.js';

afterEach(() => {
  clearGraphRegistry();
});

describe('defineGraph / registry', () => {
  it('rejects invalid definitions', () => {
    expect(() =>
      defineGraph({
        id: 'bad',
        entry: 'missing',
        maxNodeExecutions: 3,
        nodes: [{ id: 'a', kind: 'code', run: async () => ({}) }],
        edges: [],
      }),
    ).toThrow(/entry/);
  });

  it('registers a second graph without touching the executor (scenario #5)', () => {
    ensureDummyGraphsRegistered();
    expect(listRegisteredGraphs()).toEqual(['dummy.cycle', 'dummy.linear']);
    expect(getGraph('dummy.linear')?.entry).toBe('a');
    expect(getGraph('dummy.cycle')?.entry).toBe('fence');
  });
});

describe('dummy.cycle graph', () => {
  it('completes fence → critique⇄revise → remember with revise_count', async () => {
    const graph = buildDummyCycleGraph({ passAfterCritiqueVisits: 2 });
    const cp = new MemoryGraphCheckpointer();
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];

    const outcome = await runGraph({
      runId: 'run-cycle-ok',
      graph,
      checkpointer: cp,
      initialState: { writes: [], ticks: 0, critiquePass: false },
      onEvent: (type, payload) => {
        events.push({ type, payload });
      },
    });

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.reviseCount).toBeGreaterThanOrEqual(1);
    expect(outcome.state.writes).toEqual(
      expect.arrayContaining([
        'fence:ok',
        'critique:v0',
        'revise:v0',
        'critique:v1',
        'remember:done',
      ]),
    );
    expect(events.some((e) => e.type === 'stage.started')).toBe(true);
    expect(events.some((e) => e.type === 'stage.completed')).toBe(true);
    expect(events.some((e) => e.type === 'stage.checkpoint')).toBe(true);
    expect(events.some((e) => e.type === 'stage.graph_completed')).toBe(true);
  });

  it('hits maxNodeExecutions on an unbounded critique cycle (exit #3)', async () => {
    const graph = buildDummyCycleGraph({
      maxNodeExecutions: 5,
      passAfterCritiqueVisits: null,
    });
    const cp = new MemoryGraphCheckpointer();
    const events: string[] = [];

    const outcome = await runGraph({
      runId: 'run-cycle-bound',
      graph,
      checkpointer: cp,
      initialState: { writes: [], ticks: 0, critiquePass: false },
      onEvent: (type) => {
        events.push(type);
      },
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.error).toMatch(/maxNodeExecutions/);
    expect(outcome.nodeExecutionCount).toBe(5);
    expect(events).toContain('stage.bound_hit');
    // No infinite loop — executor returned.
    expect(outcome.currentStage).toBeTruthy();
  });

  it('records checkpoint write latency and never drops checkpoints (exit #4)', async () => {
    const graph = buildDummyLinearGraph();
    const cp = new MemoryGraphCheckpointer();
    cp.latencyMs = 5;

    const outcome = await runGraph({
      runId: 'run-latency',
      graph,
      checkpointer: cp,
      initialState: { steps: [], value: 0 },
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.checkpointWrites.length).toBeGreaterThan(0);
    expect(outcome.checkpointWrites.every((w) => w.writeMs >= 0)).toBe(true);
    expect(outcome.checkpointWrites.some((w) => w.writeMs >= 4)).toBe(true);
  });
});

describe('kill mid-node resume (exit #1)', () => {
  it('resumes at the interrupted stage with prior state; writes stay idempotent', async () => {
    let critiqueCalls = 0;
    const graph = defineGraph({
      id: 'dummy.kill',
      entry: 'fence',
      maxNodeExecutions: 10,
      nodes: [
        {
          id: 'fence',
          kind: 'code',
          run: async ({ state }) => {
            const writes = Array.isArray(state.writes)
              ? [...(state.writes as string[])]
              : [];
            if (!writes.includes('fence')) writes.push('fence');
            return { writes };
          },
        },
        {
          id: 'critique',
          kind: 'gate',
          run: async ({ state, signal }) => {
            critiqueCalls += 1;
            if (critiqueCalls === 1) {
              // Simulate worker kill mid-node.
              const err = new DOMException('Aborted', 'AbortError');
              // Honour abort if provided; otherwise throw AbortError directly.
              if (signal?.aborted) throw err;
              throw err;
            }
            const writes = Array.isArray(state.writes)
              ? [...(state.writes as string[])]
              : [];
            if (!writes.includes('critique')) writes.push('critique');
            return { writes, done: true };
          },
        },
        {
          id: 'remember',
          kind: 'code',
          run: async ({ state }) => {
            const writes = Array.isArray(state.writes)
              ? [...(state.writes as string[])]
              : [];
            if (!writes.includes('remember')) writes.push('remember');
            return { writes };
          },
        },
      ],
      edges: [
        { from: 'fence', to: 'critique' },
        {
          from: 'critique',
          to: 'remember',
          when: (s) => Boolean(s.done),
        },
        { from: 'remember', to: null },
      ],
    });

    const cp = new MemoryGraphCheckpointer();
    const runId = 'run-kill';

    const first = await runGraph({
      runId,
      graph,
      checkpointer: cp,
      initialState: { writes: [], done: false },
    });
    expect(first.status).toBe('paused');
    if (first.status !== 'paused') return;
    expect(first.currentStage).toBe('critique');
    expect(first.state.writes).toEqual(['fence']);

    const loaded = await cp.load(runId);
    expect(loaded?.currentStage).toBe('critique');
    expect(loaded?.stageState.writes).toEqual(['fence']);

    const second = await runGraph({
      runId,
      graph,
      checkpointer: cp,
    });
    expect(second.status).toBe('completed');
    if (second.status !== 'completed') return;
    // Idempotent: fence not duplicated; critique/remember once.
    expect(second.state.writes).toEqual(['fence', 'critique', 'remember']);
    expect(critiqueCalls).toBe(2);
  });
});

describe('registered graphs via graphId', () => {
  it('runs dummy.linear through the registry', async () => {
    registerGraph(buildDummyLinearGraph());
    const cp = new MemoryGraphCheckpointer();
    const outcome = await runGraph({
      runId: 'run-linear',
      graphId: 'dummy.linear',
      checkpointer: cp,
      initialState: { steps: [], value: 0 },
    });
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.state.steps).toEqual(['a', 'b', 'c']);
    expect(outcome.state.value).toBe(111);
  });
});
