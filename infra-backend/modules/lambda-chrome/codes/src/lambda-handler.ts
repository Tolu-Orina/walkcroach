/**
 * Chrome BFF Lambda entry — API Gateway response streaming.
 */
import type { ChromeStreamEvent } from './handlers/rest.js';
import {
  handleChromeRest,
  handleChromeStream,
  matchStreamRoute,
  requireStreamAuth,
  CORS_HEADERS,
} from './handlers/rest.js';
import { ensureRuntimeSecrets } from './secrets.js';
import { bridgeBedrockEnv, metricLog } from './util.js';
import { normalizeEvent } from './event.js';

function writeHttp(
  responseStream: NodeJS.WritableStream,
  statusCode: number,
  headers: Record<string, string>,
  body: string,
): void {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers,
  });
  stream.write(body);
  stream.end();
}

async function writeNdjsonStream(
  responseStream: NodeJS.WritableStream,
  events: AsyncIterable<ChromeStreamEvent>,
): Promise<void> {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      ...CORS_HEADERS,
    },
  });
  try {
    for await (const event of events) {
      stream.write(`${JSON.stringify(event)}\n`);
      if (event.type === 'error') {
        metricLog('chrome.stream.error', { code: 'handler' });
      }
    }
  } finally {
    stream.end();
  }
}

async function streamHandler(
  event: unknown,
  responseStream: NodeJS.WritableStream,
  _context: unknown,
): Promise<void> {
  try {
    await ensureRuntimeSecrets();
    bridgeBedrockEnv();
    const req = normalizeEvent(event);

    if (req.method === 'OPTIONS') {
      writeHttp(responseStream, 204, CORS_HEADERS, '');
      return;
    }

    const streamRoute = matchStreamRoute(req.method, req.path);
    if (streamRoute) {
      const auth = await requireStreamAuth(req);
      if ('error' in auth) {
        writeHttp(
          responseStream,
          auth.status,
          { 'content-type': 'application/json', ...CORS_HEADERS },
          JSON.stringify({ error: auth.error }),
        );
        return;
      }
      await writeNdjsonStream(
        responseStream,
        handleChromeStream(req, streamRoute, auth),
      );
      return;
    }

    const result = await handleChromeRest(req);
    writeHttp(
      responseStream,
      result.statusCode,
      result.headers,
      result.body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal error';
    console.error('chrome lambda error', message);
    metricLog('chrome.stream.error', { code: 'unhandled' });
    writeHttp(
      responseStream,
      500,
      { 'content-type': 'application/json', ...CORS_HEADERS },
      JSON.stringify({ error: 'internal error' }),
    );
  }
}

export const handler = awslambda.streamifyResponse(streamHandler);
