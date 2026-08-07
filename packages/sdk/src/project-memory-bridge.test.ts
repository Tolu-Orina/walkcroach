import { describe, expect, it, vi } from 'vitest';
import { createHostMemoryBridge } from './project-memory-bridge.js';

const PROJECT = '11111111-2222-3333-4444-555555555555';

describe('createHostMemoryBridge', () => {
  it('maps /v1 recall hits onto engine bridge fields', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hits: [
            {
              id: 'h1',
              kind: 'decision',
              text: 'Use CRDB',
              surface: 'cli',
              relevance: 0.5,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const bridge = createHostMemoryBridge({
      getAccessToken: async () => 'tok',
      projectId: PROJECT,
      surface: 'cli',
      getBaseUrl: () => 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const hits = await bridge.recall({ query: 'db' });
    expect(hits[0]).toMatchObject({
      id: 'h1',
      sourceSurface: 'cli',
      distance: 1,
    });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/v1/memory/recall');
  });

  it('remembers with the host surface tag', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        surface: 'ide',
        projectId: PROJECT,
      });
      return new Response(
        JSON.stringify({
          id: 'n1',
          supersededId: null,
          projectId: PROJECT,
          kind: 'decision',
          surface: 'ide',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const bridge = createHostMemoryBridge({
      getAccessToken: async () => 'tok',
      projectId: PROJECT,
      surface: 'ide',
      getBaseUrl: () => 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const out = await bridge.mirror({ text: 'Prefer UUIDs' });
    expect(out.id).toBe('n1');
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/v1/memory/entries');
  });
});
