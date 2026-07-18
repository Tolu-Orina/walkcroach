import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import supertest from 'supertest';
import { normalizeEvent } from '../event.js';
import {
  handleChromeRest,
  handleChromeStream,
  matchStreamRoute,
  requireStreamAuth,
} from '../handlers/rest.js';
import { CORS_HEADERS } from '../http.js';

let sharedServer: Server | null = null;

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const port = Number(process.env.CHROME_PORT ?? 3002);
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8') || undefined;

  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v[0] : v;
  }

  const queryStringParameters: Record<string, string | undefined> = {};
  for (const [k, v] of url.searchParams.entries()) {
    queryStringParameters[k] = v;
  }

  const event = {
    httpMethod: req.method ?? 'GET',
    path: url.pathname,
    body,
    headers,
    pathParameters: {},
    queryStringParameters,
  };
  const httpReq = normalizeEvent(event);

  if (httpReq.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const streamRoute = matchStreamRoute(httpReq.method, httpReq.path);
  if (streamRoute) {
    const auth = await requireStreamAuth(httpReq);
    if ('error' in auth) {
      res.writeHead(auth.status, {
        'content-type': 'application/json',
        ...CORS_HEADERS,
      });
      res.end(JSON.stringify({ error: auth.error }));
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/x-ndjson',
      ...CORS_HEADERS,
    });
    try {
      for await (const ev of handleChromeStream(httpReq, streamRoute, auth)) {
        res.write(`${JSON.stringify(ev)}\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'stream error';
      res.write(`${JSON.stringify({ type: 'error', message })}\n`);
    }
    res.end();
    return;
  }

  const result = await handleChromeRest(httpReq);
  res.writeHead(result.statusCode, result.headers);
  res.end(result.body);
}

function getServer(): Server {
  if (!sharedServer) {
    sharedServer = createServer((req, res) => {
      void handle(req, res);
    });
  }
  return sharedServer;
}

export function chromeApi(): supertest.Agent {
  return supertest(getServer());
}

export function hasCrdb(): boolean {
  return Boolean(process.env.CRDB_CONNECTION_STRING?.trim());
}
