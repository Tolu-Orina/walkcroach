/**
 * Local HTTP request handler — shared by `local-server.ts` and integration tests.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handler as apiHandler } from './handlers/api.js';
import { assertSessionAccess } from './access.js';
import { runPromptStream } from './handlers/prompt.js';
import { runPlanDecisionStream } from './handlers/planDecision.js';
import { runToolResultStream } from './handlers/toolResult.js';

function normalizeHeaders(
  headers: IncomingMessage['headers'],
): Record<string, string | undefined> {
  const reqHeaders: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) reqHeaders[k] = v[0];
    else reqHeaders[k] = v;
  }
  return reqHeaders;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function handleLocalRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const port = Number(process.env.PORT ?? 3001);
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const promptMatch = url.pathname.match(/^\/sessions\/([^/]+)\/prompt$/);
    if (req.method === 'POST' && promptMatch) {
      const body = JSON.parse(await readBody(req));
      const reqHeaders = normalizeHeaders(req.headers);
      const access = await assertSessionAccess(
        promptMatch[1]!,
        body.projectId,
        reqHeaders,
      );
      if (!access.ok) {
        res.writeHead(access.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: access.error }));
        return;
      }
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
      const body = JSON.parse(await readBody(req));
      const reqHeaders = normalizeHeaders(req.headers);
      const access = await assertSessionAccess(
        toolMatch[1]!,
        body.projectId,
        reqHeaders,
      );
      if (!access.ok) {
        res.writeHead(access.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: access.error }));
        return;
      }
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

    const planMatch = url.pathname.match(/^\/sessions\/([^/]+)\/plan-decision$/);
    if (req.method === 'POST' && planMatch) {
      const body = JSON.parse(await readBody(req));
      const reqHeaders = normalizeHeaders(req.headers);
      const access = await assertSessionAccess(
        planMatch[1]!,
        body.projectId,
        reqHeaders,
      );
      if (!access.ok) {
        res.writeHead(access.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: access.error }));
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/x-ndjson',
        'transfer-encoding': 'chunked',
      });
      await runPlanDecisionStream(planMatch[1]!, body, (chunk) => {
        res.write(chunk);
      });
      res.end();
      return;
    }

    const rawBody = ['POST', 'PUT', 'PATCH'].includes(req.method ?? '')
      ? await readBody(req)
      : undefined;
    const reqHeaders = normalizeHeaders(req.headers);

    const result = await apiHandler(
      {
        version: '2.0',
        routeKey: `${req.method} ${url.pathname}`,
        rawPath: url.pathname,
        rawQueryString: url.searchParams.toString(),
        headers: reqHeaders,
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
}
