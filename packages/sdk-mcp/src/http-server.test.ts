import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpHttpServer } from './http-server.js';
import type { Server } from 'node:http';

/**
 * Streamable HTTP transport conformance.
 *
 * 2026-07-28 removed the HTTP GET/SSE endpoint, SSE resumability, and message
 * redelivery, so the transport is a plain POST/response cycle. These assert the
 * removals as much as the behaviour.
 */
describe('streamable HTTP transport', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createMcpHttpServer({
      apiKey: `wc_live_${'a'.repeat(10)}_${'b'.repeat(32)}`,
      baseUrl: 'http://127.0.0.1:1',
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/mcp`;
  });

  afterAll(() => server.close());

  const post = (body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('answers server/discover over HTTP', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'server/discover' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { protocolVersions: string[] } };
    expect(json.result.protocolVersions[0]).toBe('2026-07-28');
  });

  it('rejects GET on the RPC endpoint', async () => {
    // The GET/SSE endpoint was removed from the transport in this revision.
    const res = await fetch(url, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('serves a health endpoint for liveness checks', async () => {
    const res = await fetch(url.replace('/mcp', '/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('returns a JSON-RPC parse error for malformed bodies', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32700);
  });

  it('handles a batch and preserves ids', async () => {
    const res = await post([
      { jsonrpc: '2.0', id: 'a', method: 'server/discover' },
      { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
    ]);
    const json = (await res.json()) as Array<{ id: string }>;
    expect(json.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns 202 with no body for an all-notification batch', async () => {
    const res = await post([{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('answers CORS preflight', async () => {
    const res = await fetch(url, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('surfaces an upstream failure as a tool error, not a crash', async () => {
    // baseUrl points at a closed port, so the SDK's transport fails. The server
    // must stay up and report it through the tool result.
    const res = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'list_memory',
        arguments: { projectId: '11111111-2222-3333-4444-555555555555' },
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { isError: boolean } };
    expect(json.result.isError).toBe(true);
  });
});
