/**
 * Local HTTP server for Phase 0–2 development (no API Gateway required).
 *
 *   cd infra-backend && npm run dev
 */
import { createServer } from 'node:http';
import { handler as apiHandler } from './handlers/api.js';
import { runPromptStream } from './handlers/prompt.js';
import { runToolResultStream } from './handlers/toolResult.js';

const PORT = Number(process.env.PORT ?? 3001);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const readBody = async () => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  };

  try {
    // Streaming routes
    const promptMatch = url.pathname.match(/^\/sessions\/([^/]+)\/prompt$/);
    if (req.method === 'POST' && promptMatch) {
      const body = JSON.parse(await readBody());
      res.writeHead(200, {
        'content-type': 'application/x-ndjson',
        'transfer-encoding': 'chunked',
      });
      await runPromptStream(promptMatch[1]!, body, (chunk) => {
        res.write(chunk);
      });
      res.end();
      return;
    }

    const toolMatch = url.pathname.match(/^\/sessions\/([^/]+)\/tool-result$/);
    if (req.method === 'POST' && toolMatch) {
      const body = JSON.parse(await readBody());
      res.writeHead(200, {
        'content-type': 'application/x-ndjson',
        'transfer-encoding': 'chunked',
      });
      await runToolResultStream(toolMatch[1]!, body, (chunk) => {
        res.write(chunk);
      });
      res.end();
      return;
    }

    // Buffered API via Lambda-shaped handler
    const rawBody = ['POST', 'PUT', 'PATCH'].includes(req.method ?? '')
      ? await readBody()
      : undefined;
    const result = await apiHandler(
      {
        version: '2.0',
        routeKey: `${req.method} ${url.pathname}`,
        rawPath: url.pathname,
        rawQueryString: url.searchParams.toString(),
        headers: {},
        requestContext: {
          accountId: 'local',
          apiId: 'local',
          domainName: 'localhost',
          domainPrefix: 'localhost',
          http: {
            method: req.method ?? 'GET',
            path: url.pathname,
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'local',
          },
          requestId: 'local',
          routeKey: `${req.method} ${url.pathname}`,
          stage: '$default',
          time: new Date().toISOString(),
          timeEpoch: Date.now(),
        },
        isBase64Encoded: false,
        body: rawBody,
      },
      {} as never,
    );

    if (typeof result === 'string') {
      res.writeHead(200);
      res.end(result);
      return;
    }
    const r = result as {
      statusCode?: number;
      headers?: Record<string, string>;
      body?: string;
    };
    res.writeHead(r.statusCode ?? 200, r.headers);
    res.end(r.body ?? '');
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`walkcroach backend local http://localhost:${PORT}`);
});
