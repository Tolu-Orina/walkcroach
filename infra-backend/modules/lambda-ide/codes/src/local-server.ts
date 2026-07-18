import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEvent } from './event.js';
import { handleIdeRest } from './handlers/rest.js';
import { CORS_HEADERS } from './http.js';
import { ensureRuntimeSecrets } from './secrets.js';
import { bridgeBedrockEnv } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadLocalEnv(): Promise<void> {
  try {
    const { loadEnv } = await import('@walkcroach/db');
    loadEnv(join(__dirname, '..', '..', '..', '..'));
  } catch {
    // optional
  }
}

const port = Number(process.env.IDE_PORT ?? process.env.PORT ?? 3003);

await loadLocalEnv();
bridgeBedrockEnv();

const server = createServer(async (req, res) => {
  try {
    await ensureRuntimeSecrets();
    bridgeBedrockEnv();

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

    const result = await handleIdeRest(httpReq);
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal error';
    console.error(message);
    res.writeHead(500, { 'content-type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ error: 'internal error' }));
  }
});

server.listen(port, () => {
  console.log(`walkcroach-ide local listening on http://localhost:${port}`);
});
