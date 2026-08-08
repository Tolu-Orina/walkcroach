/**
 * Phase 6b — graphs.run / validate client contract tests.
 */
import { describe, expect, it } from 'vitest';
import { WalkCroach, ValidationError, GRAPH_RUN_CONTRACT_VERSION } from './index.js';

const KEY = `wc_live_${'a'.repeat(10)}_${'b'.repeat(32)}`;

function client(handler?: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body ?? '{}')) : {};
    calls.push({ url: String(url), body });
    const payload =
      handler?.(String(url), init) ??
      (String(url).includes('/graphs/catalog')
        ? {
            contractVersion: GRAPH_RUN_CONTRACT_VERSION,
            nodes: [{ type: 'fence', kind: 'code', description: 'x', configKeys: [] }],
            presets: [{ id: 'content.publish', description: 'preset' }],
            predicates: ['always'],
            caps: { maxNodeExecutions: 40, maxNodes: 24, maxEdges: 48 },
          }
        : String(url).includes('/graphs/validate')
          ? { ok: true, contractVersion: GRAPH_RUN_CONTRACT_VERSION, graph: body.graph }
          : {
              runId: '11111111-1111-1111-1111-111111111111',
              status: 'queued',
              createdAt: '2026-08-08T00:00:00Z',
              contractVersion: GRAPH_RUN_CONTRACT_VERSION,
            });
    return new Response(JSON.stringify(payload), {
      status: String(url).includes('/graphs/run') ? 202 : 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  const wc = new WalkCroach({
    apiKey: KEY,
    baseUrl: 'https://api.test',
    fetch: fetchImpl,
  });
  return { wc, calls };
}

describe('graphs API (Phase 6b)', () => {
  it('exports graph.run/v1 contract version', () => {
    expect(GRAPH_RUN_CONTRACT_VERSION).toBe('graph.run/v1');
  });

  it('catalog hits GET /v1/graphs/catalog', async () => {
    const { wc, calls } = client();
    const cat = await wc.graphs.catalog();
    expect(calls[0]!.url).toBe('https://api.test/v1/graphs/catalog');
    expect(cat.presets[0]!.id).toBe('content.publish');
  });

  it('rejects BYO tools client-side before submit', async () => {
    const { wc, calls } = client();
    await expect(
      wc.graphs.run({
        graph: {
          entry: 'fence',
          maxNodeExecutions: 4,
          nodes: [
            {
              id: 'fence',
              type: 'fence',
              config: { tools: [{ name: 'shell' }] },
            },
          ],
          edges: [{ from: 'fence', to: null }],
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('submits catalog graph to POST /v1/graphs/run', async () => {
    const { wc, calls } = client();
    const run = await wc.graphs.run({
      graph: {
        entry: 'fence',
        maxNodeExecutions: 8,
        nodes: [{ id: 'fence', type: 'fence' }],
        edges: [{ from: 'fence', to: null }],
      },
      input: { text: 'hello' },
    });
    expect(calls[0]!.url).toBe('https://api.test/v1/graphs/run');
    expect(calls[0]!.body.graph).toBeTruthy();
    expect(run.runId).toMatch(/11111111/);
  });

  it('forwards content.publish preset', async () => {
    const { wc, calls } = client();
    await wc.graphs.run({
      preset: 'content.publish',
      source: { kind: 'markdown', content: '# Hi' },
      writeScope: { mode: 'additive' },
      dryRun: true,
    });
    expect(calls[0]!.body.preset).toBe('content.publish');
    expect(calls[0]!.body.source).toEqual({ kind: 'markdown', content: '# Hi' });
  });
});
