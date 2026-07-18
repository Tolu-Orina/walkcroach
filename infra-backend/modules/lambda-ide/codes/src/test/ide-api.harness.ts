import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import supertest from 'supertest';
import { normalizeEvent } from '../event.js';
import { handleIdeRest } from '../handlers/rest.js';
import { CORS_HEADERS } from '../http.js';

let sharedServer: Server | null = null;

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const port = Number(process.env.IDE_PORT ?? 3003);
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
  const result = await handleIdeRest(httpReq);
  res.writeHead(result.statusCode, result.headers ?? CORS_HEADERS);
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

export function ideApi(): supertest.Agent {
  return supertest(getServer());
}

export function hasCrdb(): boolean {
  return Boolean(process.env.CRDB_CONNECTION_STRING?.trim());
}

export function devBearer(ownerId: string): string {
  return `Bearer dev:${ownerId}`;
}
