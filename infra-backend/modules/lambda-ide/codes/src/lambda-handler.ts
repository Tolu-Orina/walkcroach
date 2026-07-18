/**
 * IDE BFF Lambda entry — API Gateway response streaming transport
 * (buffered JSON responses; no agent loop streaming here).
 */
import { handleIdeRest } from './handlers/rest.js';
import { CORS_HEADERS } from './http.js';
import { ensureRuntimeSecrets } from './secrets.js';
import { bridgeBedrockEnv, metricLog } from './util.js';
import { normalizeEvent } from './event.js';

declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: unknown,
      responseStream: NodeJS.WritableStream,
      context: unknown,
    ) => Promise<void>,
  ) => unknown;
  HttpResponseStream: {
    from: (
      responseStream: NodeJS.WritableStream,
      metadata: { statusCode: number; headers: Record<string, string> },
    ) => NodeJS.WritableStream;
  };
};

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

    const result = await handleIdeRest(req);
    writeHttp(
      responseStream,
      result.statusCode,
      result.headers,
      result.body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal error';
    console.error('ide lambda error', message);
    metricLog('ide.unhandled', { ok: false });
    writeHttp(
      responseStream,
      500,
      { 'content-type': 'application/json', ...CORS_HEADERS },
      JSON.stringify({ error: 'internal error' }),
    );
  }
}

export const handler = awslambda.streamifyResponse(streamHandler);
