/**
 * Phase 6b — public Run Graph DSL contract tests (ADR-I).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DbClient } from '@walkcroach/db';
import {
  BYO_FORBIDDEN_KEYS,
  PUBLIC_MAX_NODE_EXECUTIONS_CAP,
  validatePublicGraph,
  listCatalogNodes,
  listPresets,
  GRAPH_RUN_CONTRACT_VERSION,
} from './public-catalog.js';
import { runPublicGraph } from './public-run.js';
import { buildSampleQualityGraph } from './sample-quality-graph.js';

describe('public catalog', () => {
  it('lists platform nodes and content.publish preset', () => {
    const types = listCatalogNodes().map((n) => n.type);
    expect(types).toContain('fence');
    expect(types).toContain('critique');
    expect(types).toContain('memory.recall');
    expect(listPresets().map((p) => p.id)).toEqual(['content.publish']);
    expect(GRAPH_RUN_CONTRACT_VERSION).toBe('graph.run/v1');
  });
});

describe('validatePublicGraph — BYO fail-closed (scenario #6)', () => {
  const base = {
    entry: 'fence',
    maxNodeExecutions: 8,
    nodes: [{ id: 'fence', type: 'fence' }],
    edges: [{ from: 'fence', to: null }],
  };

  it.each([...BYO_FORBIDDEN_KEYS])(
    'rejects forbidden key %s at root',
    (key) => {
      const result = validatePublicGraph({ ...base, [key]: {} });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes(key))).toBe(true);
      }
    },
  );

  it('rejects BYO tools nested under node.config', () => {
    const result = validatePublicGraph({
      ...base,
      nodes: [
        {
          id: 'fence',
          type: 'fence',
          config: { tools: [{ name: 'shell' }] },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/BYO|tools/);
    }
  });

  it('rejects unknown node types as BYO', () => {
    const result = validatePublicGraph({
      ...base,
      nodes: [{ id: 'x', type: 'custom.shell' }],
      entry: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/not in the platform catalog/);
    }
  });

  it('rejects content.publish used as a node type', () => {
    const result = validatePublicGraph({
      ...base,
      nodes: [{ id: 'p', type: 'content.publish' }],
      entry: 'p',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects illegal edge predicates and over-cap executions', () => {
    expect(
      validatePublicGraph({
        ...base,
        edges: [{ from: 'fence', to: null, when: 'eval(state)' }],
      }).ok,
    ).toBe(false);
    expect(
      validatePublicGraph({
        ...base,
        maxNodeExecutions: PUBLIC_MAX_NODE_EXECUTIONS_CAP + 1,
      }).ok,
    ).toBe(false);
  });

  it('accepts the sample quality graph', () => {
    const result = validatePublicGraph(buildSampleQualityGraph());
    expect(result.ok).toBe(true);
  });
});

describe('sample quality graph run (exit criterion #2)', () => {
  it('completes fence → critique → remember with checkpoints (memory-less path)', async () => {
    // rememberText omitted → remember node no-ops without DB/embed.
    const graph = buildSampleQualityGraph();
    const result = await runPublicGraph({
      db: {} as DbClient,
      projectId: '00000000-0000-0000-0000-000000000001',
      runId: randomUUID(),
      graph,
      durable: false,
      input: {
        text: 'Ship the quality pipeline with catalog nodes only.',
      },
    });

    expect(result.contractVersion).toBe('graph.run/v1');
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('completed');
    expect(result.nodeExecutionCount).toBeGreaterThanOrEqual(2);
    expect(result.visitCounts.fence).toBe(1);
    expect(result.visitCounts.critique).toBe(1);
  });
});
