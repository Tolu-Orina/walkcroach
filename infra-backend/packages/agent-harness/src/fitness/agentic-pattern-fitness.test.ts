/**
 * Phase 8 — CI fitness functions for agentic-pattern quality scenarios (§0.1).
 *
 * Structural/behavioural guards that must stay green in harness CI.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createForbiddenImportCheck,
  defaultPublishCriticChecks,
  runCriticGate,
} from '../critic-gate/index.js';
import {
  BYO_FORBIDDEN_KEYS,
  GRAPH_CHECKPOINT_RETENTION_DAYS,
  PLATFORM_NODE_CATALOG,
  buildDummyCycleGraph,
  buildSampleQualityGraph,
  clearGraphRegistry,
  ensureDummyGraphsRegistered,
  listRegisteredGraphs,
  MemoryGraphCheckpointer,
  runGraph,
  validatePublicGraph,
} from '../graph/index.js';

afterEach(() => {
  clearGraphRegistry();
});

describe('Phase 8 fitness — quality scenarios', () => {
  it('§0.1 #2 plan isolation: plan catalog node forbids tool config keys', () => {
    const planNode = PLATFORM_NODE_CATALOG.find((n) => n.type === 'plan');
    expect(planNode?.kind).toBe('subagent');
    expect(planNode?.configKeys).toEqual([]);
    expect(planNode?.configKeys).not.toContain('tools');
  });

  it('§0.1 #3 checkpoint recoverability bound: maxNodeExecutions enforced', async () => {
    const graph = buildDummyCycleGraph({
      maxNodeExecutions: 5,
      passAfterCritiqueVisits: null,
    });
    const outcome = await runGraph({
      runId: 'fitness-bound',
      graph,
      checkpointer: new MemoryGraphCheckpointer(),
      initialState: { writes: [], ticks: 0, critiquePass: false },
    });
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/maxNodeExecutions/);
    }
  });

  it('§0.1 #4 critique enforcement: forbidden @/ never passes floor', async () => {
    const e = await runCriticGate({
      checks: defaultPublishCriticChecks({ allowedImportPrefixes: [] }),
      context: {
        artifacts: [
          {
            path: 'src/post.tsx',
            content: `import { Card } from '@/components/ui/card';\n`,
          },
        ],
      },
    });
    expect(e.action).not.toBe('pass');
    expect(
      createForbiddenImportCheck({ forbidden: ['@/'], allowed: [] }).id,
    ).toBeTruthy();
  });

  it('§0.1 #5 graph reuse: second registered graph without new executor', () => {
    ensureDummyGraphsRegistered();
    expect(listRegisteredGraphs().sort()).toEqual(
      ['dummy.cycle', 'dummy.linear'].sort(),
    );
  });

  it('§0.1 #6 public Run Graph: BYO keys fail closed 100%', () => {
    const base = {
      entry: 'fence',
      maxNodeExecutions: 4,
      nodes: [{ id: 'fence', type: 'fence' }],
      edges: [{ from: 'fence', to: null }],
    };
    for (const key of BYO_FORBIDDEN_KEYS) {
      const result = validatePublicGraph({ ...base, [key]: true });
      expect(result.ok).toBe(false);
    }
    expect(validatePublicGraph(buildSampleQualityGraph()).ok).toBe(true);
  });

  it('§0.1 checkpoint GC retention constant (Phase 8)', () => {
    expect(GRAPH_CHECKPOINT_RETENTION_DAYS).toBe(30);
  });
});
