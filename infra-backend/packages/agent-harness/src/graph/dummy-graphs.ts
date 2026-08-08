/**
 * Phase 3 dummy graphs — prove bounds, cycles, resume, and registry reuse
 * without depending on content.publish (Phase 5).
 */
import { defineGraph } from './define.js';
import { getGraph, registerGraph } from './registry.js';
import type { GraphDefinition, GraphState } from './types.js';

export type DummyCycleState = GraphState & {
  /** Idempotent write log — re-running a node must not duplicate entries. */
  writes: string[];
  ticks: number;
  /** Gate flips after enough critique rounds. */
  critiquePass: boolean;
};

export type DummyLinearState = GraphState & {
  steps: string[];
  value: number;
};

/**
 * Fence → Critique ⇄ Revise → Remember, with a deliberate cycle.
 * Hits maxNodeExecutions when critique never passes; otherwise completes.
 */
export function buildDummyCycleGraph(opts?: {
  id?: string;
  maxNodeExecutions?: number;
  /** After this many critique visits, pass (default 2). Set null to never pass. */
  passAfterCritiqueVisits?: number | null;
}): GraphDefinition<DummyCycleState> {
  const passAfter = opts?.passAfterCritiqueVisits === undefined
    ? 2
    : opts.passAfterCritiqueVisits;

  return defineGraph<DummyCycleState>({
    id: opts?.id ?? 'dummy.cycle',
    entry: 'fence',
    maxNodeExecutions: opts?.maxNodeExecutions ?? 12,
    defaultNodeTimeoutMs: 5_000,
    nodes: [
      {
        id: 'fence',
        kind: 'code',
        run: async ({ state, nodeId }) => {
          const writes = idempotentPush(state.writes, `${nodeId}:ok`);
          return { writes, ticks: Number(state.ticks ?? 0) };
        },
      },
      {
        id: 'critique',
        kind: 'gate',
        run: async ({ state, visitCount, nodeId }) => {
          const writes = idempotentPush(state.writes, `${nodeId}:v${visitCount}`);
          const pass =
            passAfter === null ? false : visitCount + 1 >= passAfter;
          return {
            state: {
              writes,
              ticks: Number(state.ticks ?? 0) + 1,
              critiquePass: pass,
            },
          };
        },
      },
      {
        id: 'revise',
        kind: 'code',
        run: async ({ state, visitCount, nodeId }) => {
          const writes = idempotentPush(state.writes, `${nodeId}:v${visitCount}`);
          return {
            state: { writes, ticks: Number(state.ticks ?? 0) + 1 },
            reviseDelta: 1,
          };
        },
      },
      {
        id: 'remember',
        kind: 'code',
        run: async ({ state, nodeId }) => {
          const writes = idempotentPush(state.writes, `${nodeId}:done`);
          return { writes };
        },
      },
    ],
    edges: [
      { from: 'fence', to: 'critique' },
      {
        from: 'critique',
        to: 'remember',
        when: (s) => Boolean(s.critiquePass),
      },
      {
        from: 'critique',
        to: 'revise',
        when: (s) => !s.critiquePass,
      },
      { from: 'revise', to: 'critique' },
      { from: 'remember', to: null },
    ],
  });
}

/** Second registered graph — same executor, no code change (scenario #5). */
export function buildDummyLinearGraph(opts?: {
  id?: string;
}): GraphDefinition<DummyLinearState> {
  return defineGraph<DummyLinearState>({
    id: opts?.id ?? 'dummy.linear',
    entry: 'a',
    maxNodeExecutions: 8,
    nodes: [
      {
        id: 'a',
        kind: 'code',
        run: async ({ state }) => ({
          steps: idempotentPush(state.steps, 'a'),
          value: Number(state.value ?? 0) + 1,
        }),
      },
      {
        id: 'b',
        kind: 'code',
        run: async ({ state }) => ({
          steps: idempotentPush(state.steps, 'b'),
          value: Number(state.value ?? 0) + 10,
        }),
      },
      {
        id: 'c',
        kind: 'code',
        run: async ({ state }) => ({
          steps: idempotentPush(state.steps, 'c'),
          value: Number(state.value ?? 0) + 100,
        }),
      },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: null },
    ],
  });
}

function idempotentPush(list: unknown, item: string): string[] {
  const arr = Array.isArray(list) ? [...(list as string[])] : [];
  if (!arr.includes(item)) arr.push(item);
  return arr;
}

/** Register both dummies if not already present (idempotent for workers). */
export function ensureDummyGraphsRegistered(): void {
  if (!getGraph('dummy.cycle')) {
    registerGraph(buildDummyCycleGraph());
  }
  if (!getGraph('dummy.linear')) {
    registerGraph(buildDummyLinearGraph());
  }
}
