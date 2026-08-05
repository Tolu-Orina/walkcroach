import { describe, expect, it } from 'vitest';
import { WalkCroach } from '@walkcroach/sdk';
import { createDispatcher } from './server.js';
import {
  ErrorCode,
  META,
  PROTOCOL_2025,
  PROTOCOL_2026,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcRequest,
} from './protocol.js';

/**
 * Conformance transcripts for MCP 2026-07-28.
 *
 * These assert wire shape, not behaviour, and they are the gate on claiming
 * 2026-07-28 support anywhere. The upstream SDK cannot be used as an oracle —
 * `@modelcontextprotocol/sdk@1.30.0` still declares 2025-11-25 as latest — so
 * every assertion here is written against the published changelog.
 */

const PROJECT = '11111111-2222-3333-4444-555555555555';

/** Records requests and replays canned `/v1` responses. */
function fakeApi(routes: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), body });
    const path = new URL(String(url)).pathname;
    const payload = routes[path] ?? {};
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  const wc = new WalkCroach({
    apiKey: `wc_live_${'a'.repeat(10)}_${'b'.repeat(32)}`,
    baseUrl: 'https://api.test',
    fetch: fetchImpl,
  });
  return { wc, calls };
}

const rpc = (method: string, params?: Record<string, unknown>, id: unknown = 1) =>
  ({ jsonrpc: '2.0', id, method, params }) as JsonRpcRequest;

const withVersion = (
  method: string,
  version: string,
  params: Record<string, unknown> = {},
) => rpc(method, { ...params, _meta: { [META.protocolVersion]: version } });

describe('MCP 2026-07-28 conformance', () => {
  it('implements the mandatory server/discover RPC', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(rpc('server/discover'))) as never;
    const result = (res as { result: Record<string, unknown> }).result;

    expect(result.protocolVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
    expect(result.serverInfo).toMatchObject({ name: 'walkcroach-memory' });
    expect(result.resultType).toBe('complete');
  });

  it('carries resultType on every result', async () => {
    const { wc } = fakeApi();
    const dispatch = createDispatcher(wc);
    for (const method of ['server/discover', 'tools/list', 'resources/list', 'prompts/list']) {
      const res = (await dispatch(rpc(method))) as { result: { resultType: string } };
      expect(res.result.resultType, `${method} must declare resultType`).toBe('complete');
    }
  });

  it('advertises serverInfo in result _meta', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(rpc('tools/list'))) as {
      result: { _meta: Record<string, unknown> };
    };
    expect(res.result._meta[META.serverInfo]).toMatchObject({ name: 'walkcroach-memory' });
  });

  it('accepts a per-request protocol version with no initialize handshake', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(
      withVersion('tools/list', PROTOCOL_2026),
    )) as { result: unknown };
    expect(res.result).toBeDefined();
  });

  it('rejects an unknown protocol version with -32022', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(
      withVersion('tools/list', '1999-01-01'),
    )) as { error: { code: number; data: { supported: string[] } } };

    expect(res.error.code).toBe(ErrorCode.UnsupportedProtocolVersion);
    expect(res.error.code).toBe(-32022); // renumbered from -32004 in this revision
    expect(res.error.data.supported).toContain(PROTOCOL_2026);
  });

  it('returns tools in a deterministic order for prompt-cache stability', async () => {
    const { wc } = fakeApi();
    const dispatch = createDispatcher(wc);
    const first = (await dispatch(rpc('tools/list'))) as {
      result: { tools: Array<{ name: string }> };
    };
    const second = (await dispatch(rpc('tools/list'))) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = first.result.tools.map((t) => t.name);

    expect(names).toEqual(second.result.tools.map((t) => t.name));
    expect(names).toEqual([...names].sort());
  });

  it('marks list results cacheable and private', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(rpc('tools/list'))) as {
      result: { ttlMs: number; cacheScope: string };
    };
    expect(typeof res.result.ttlMs).toBe('number');
    // Never "public": these responses are tenant-shaped and a shared
    // intermediary caching one tenant's for another would be a data leak.
    expect(res.result.cacheScope).toBe('private');
  });

  it('declares an outputSchema for every tool', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(rpc('tools/list'))) as {
      result: { tools: Array<{ name: string; outputSchema?: unknown }> };
    };
    for (const tool of res.result.tools) {
      expect(tool.outputSchema, `${tool.name} must declare outputSchema`).toBeDefined();
    }
  });

  it('propagates OpenTelemetry traceparent into the result', async () => {
    const { wc } = fakeApi({ '/v1/memory/recall': { hits: [] } });
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const res = (await createDispatcher(wc)({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'recall_project_memory',
        arguments: { projectId: PROJECT, query: 'anything' },
        _meta: { [META.protocolVersion]: PROTOCOL_2026, [META.traceparent]: traceparent },
      },
    })) as { result: { _meta: Record<string, unknown> } };

    expect(res.result._meta[META.traceparent]).toBe(traceparent);
  });

  it('returns no response for a notification', async () => {
    const { wc } = fakeApi();
    const res = await createDispatcher(wc)({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    } as JsonRpcRequest);
    expect(res).toBeNull();
  });
});

describe('2025-11-25 backward compatibility', () => {
  // Load-bearing: hosts on @modelcontextprotocol/sdk@1.30.0 still speak this.
  it('answers initialize even though the handshake was removed', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(
      rpc('initialize', { protocolVersion: PROTOCOL_2025 }),
    )) as { result: { protocolVersion: string; capabilities: unknown } };

    expect(res.result.protocolVersion).toBe(PROTOCOL_2025);
    expect(res.result.capabilities).toMatchObject({ tools: { listChanged: false } });
  });

  it('defaults a request with no _meta version to 2025-11-25 rather than failing', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(rpc('tools/list'))) as { result: unknown };
    expect(res.result).toBeDefined();
  });

  it('answers ping', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(rpc('ping'))) as { result: unknown };
    expect(res.result).toBeDefined();
  });

  it('negotiates 2026-07-28 when initialize asks for it', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(
      rpc('initialize', { protocolVersion: PROTOCOL_2026 }),
    )) as { result: { protocolVersion: string } };
    expect(res.result.protocolVersion).toBe(PROTOCOL_2026);
  });
});

describe('tools/call', () => {
  it('rejects an unknown tool with MethodNotFound', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(
      rpc('tools/call', { name: 'nope', arguments: {} }),
    )) as { error: { code: number } };
    expect(res.error.code).toBe(ErrorCode.MethodNotFound);
  });

  it('requires params.name', async () => {
    const { wc } = fakeApi();
    const res = (await createDispatcher(wc)(rpc('tools/call', {}))) as {
      error: { code: number };
    };
    expect(res.error.code).toBe(ErrorCode.InvalidParams);
  });

  it('returns structuredContent alongside prose for recall', async () => {
    const { wc } = fakeApi({
      '/v1/memory/recall': {
        hits: [
          {
            id: 'm1',
            kind: 'decision',
            text: 'Chose Drizzle over Prisma',
            surface: 'ide',
            relevance: 0.91,
          },
        ],
      },
    });
    const res = (await createDispatcher(wc)(
      rpc('tools/call', {
        name: 'recall_project_memory',
        arguments: { projectId: PROJECT, query: 'orm' },
      }),
    )) as {
      result: {
        content: Array<{ type: string; text: string }>;
        structuredContent: { hits: unknown[] };
      };
    };

    expect(res.result.structuredContent.hits).toHaveLength(1);
    expect(res.result.content[0]!.text).toContain('Drizzle');
  });

  it('tells the model to say so when recall is empty, rather than inventing context', async () => {
    const { wc } = fakeApi({ '/v1/memory/recall': { hits: [] } });
    const res = (await createDispatcher(wc)(
      rpc('tools/call', {
        name: 'recall_project_memory',
        arguments: { projectId: PROJECT, query: 'orm' },
      }),
    )) as { result: { content: Array<{ text: string }> } };
    expect(res.result.content[0]!.text).toMatch(/first time|rather than inventing/i);
  });

  it('surfaces supersededId in the prose so the user can be told', async () => {
    const { wc } = fakeApi({
      '/v1/memory/entries': { id: 'new-1', supersededId: 'old-9', kind: 'decision', surface: 'mcp' },
    });
    const res = (await createDispatcher(wc)(
      rpc('tools/call', {
        name: 'remember',
        arguments: { projectId: PROJECT, text: 'Use Drizzle' },
      }),
    )) as {
      result: { content: Array<{ text: string }>; structuredContent: { supersededId: string } };
    };

    expect(res.result.structuredContent.supersededId).toBe('old-9');
    expect(res.result.content[0]!.text).toContain('old-9');
    expect(res.result.content[0]!.text).toMatch(/replaced|mention/i);
  });

  it('never issues a recall without a project scope', async () => {
    // The vector index is prefixed on (project_id, superseded_by); an unscoped
    // recall would silently full-scan. Guarded client-side so it cannot be sent.
    const { wc, calls } = fakeApi({ '/v1/memory/recall': { hits: [] } });
    const res = (await createDispatcher(wc)(
      rpc('tools/call', {
        name: 'recall_project_memory',
        arguments: { query: 'no project id here' },
      }),
    )) as { result: { isError?: boolean; content: Array<{ text: string }> } };

    expect(res.result.isError).toBe(true);
    expect(res.result.content[0]!.text).toMatch(/projectId/i);
    expect(calls).toHaveLength(0);
  });

  it('explains a retention-window failure as a storage limit, not a permission error', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          error: 'timestamp is outside the MVCC retention window (gc.ttlseconds=90000…)',
          code: 'RETENTION_WINDOW_EXCEEDED',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof globalThis.fetch;

    const wc = new WalkCroach({
      apiKey: `wc_live_${'a'.repeat(10)}_${'b'.repeat(32)}`,
      baseUrl: 'https://api.test',
      fetch: fetchImpl,
    });

    const res = (await createDispatcher(wc)(
      rpc('tools/call', {
        name: 'memory_timeline',
        arguments: { projectId: PROJECT, from: '2020-01-01T00:00:00Z' },
      }),
    )) as { result: { isError?: boolean; content: Array<{ text: string }> } };

    expect(res.result.isError).toBe(true);
    expect(res.result.content[0]!.text).toMatch(/hard storage limit|no longer exists/i);
  });
});
