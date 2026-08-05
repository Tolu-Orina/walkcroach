/**
 * IDE BFF Lambda entry — API Gateway response streaming transport
 * (buffered JSON responses; no agent loop streaming here).
 */
import { handleIdeRest } from './handlers/rest.js';
import { CORS_HEADERS } from './http.js';
import { ensureRuntimeSecrets } from './secrets.js';
import { bridgeBedrockEnv, metricLog } from './util.js';
import { normalizeEvent } from './event.js';
import { isWorkerEvent } from './worker.js';

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

    /**
     * A worker envelope arriving here means something is misrouted: runs are
     * dispatched to the separate worker function (`worker-handler.ts`), which
     * has the fifteen-minute timeout this one deliberately does not.
     *
     * Executing it anyway would appear to work and then be cut off partway,
     * leaving a half-finished run and a lease to reap. Refusing is the honest
     * answer, and it makes a misconfigured `WALKCROACH_WORKER_FUNCTION` obvious
     * immediately rather than as a mysterious timeout later.
     */
    if (isWorkerEvent(event)) {
      metricLog('ide.worker.misrouted', { runId: event.walkcroachWorker.runId });
      writeHttp(
        responseStream,
        400,
        { 'content-type': 'application/json' },
        JSON.stringify({
          error:
            'worker envelope delivered to the API function. Runs belong on the worker ' +
            'function; check WALKCROACH_WORKER_FUNCTION.',
        }),
      );
      return;
    }

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

/**
 * Worker entry, exported from the same module.
 *
 * The packaging script emits a single `index.mjs`, so both functions ship in one
 * artifact and are selected by handler export — `index.handler` for the API,
 * `index.workerHandler` for the worker. One bundle keeps the two from drifting;
 * two Lambda functions give them the independent timeouts they need.
 *
 * Deliberately not wrapped in `streamifyResponse`: the worker is invoked with
 * `InvocationType: 'Event'` and nothing is reading a response stream.
 */
export { handler as workerHandler } from './worker-handler.js';
