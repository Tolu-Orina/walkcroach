import { createServer, type Server } from 'node:http';
import { WalkCroach } from '@walkcroach/sdk';
import { createDispatcher } from './server.js';
import { ErrorCode, rpcError, type JsonRpcRequest } from './protocol.js';

export type ServeOptions = {
  apiKey: string;
  baseUrl?: string;
  port?: number;
  host?: string;
};

/**
 * Streamable HTTP transport.
 *
 * Deliberately minimal: 2026-07-28 removed SSE resumability, message
 * redelivery, and the GET endpoint, so a plain POST/response cycle is the whole
 * transport for a server that emits no unsolicited notifications. There is
 * nothing here to resume.
 *
 * Binds to loopback by default. This process holds a `wc_live_` key in memory;
 * binding it to 0.0.0.0 would expose an unauthenticated proxy to that key on the
 * local network.
 */
export function createMcpHttpServer(opts: ServeOptions): Server {
  const wc = new WalkCroach({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  const dispatch = createDispatcher(wc);

  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost`);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type, accept, mcp-method, mcp-name',
          'access-control-allow-methods': 'POST, OPTIONS',
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, transport: 'streamable-http' }));
        return;
      }

      if (req.method !== 'POST') {
        // The GET/SSE endpoint was removed from the transport in 2026-07-28.
        res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
        res.end(
          JSON.stringify({
            error:
              'Only POST is supported. The HTTP GET/SSE endpoint was removed in MCP 2026-07-28.',
          }),
        );
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8');

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify(rpcError(null, ErrorCode.ParseError, 'invalid JSON')));
        return;
      }

      // A batch is an array; each element is dispatched independently because
      // nothing shares state between them.
      const single = !Array.isArray(parsed);
      const requests = (single ? [parsed] : parsed) as JsonRpcRequest[];

      const responses = [];
      for (const request of requests) {
        try {
          const out = await dispatch(request);
          if (out) responses.push(out);
        } catch (err) {
          responses.push(
            rpcError(
              request?.id ?? null,
              ErrorCode.InternalError,
              err instanceof Error ? err.message : String(err),
            ),
          );
        }
      }

      // All-notifications batch: nothing to say.
      if (responses.length === 0) {
        res.writeHead(202);
        res.end();
        return;
      }

      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(single ? responses[0] : responses));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}

export function serve(opts: ServeOptions): Promise<{ port: number; close: () => void }> {
  const server = createMcpHttpServer(opts);
  const port = opts.port ?? 0;
  const host = opts.host ?? '127.0.0.1';
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : port,
        close: () => server.close(),
      });
    });
  });
}
