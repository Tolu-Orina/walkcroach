/**
 * Worker Lambda entry.
 *
 * A separate function from the API handler, sharing the same bundle. It exists
 * because the two workloads want opposite timeouts: a publish run needs the full
 * 15 minutes, while an HTTP request should fail fast so a hung one does not hold
 * a concurrency slot. One function cannot have both.
 *
 * No `streamifyResponse` here — nothing is listening. The invoke is
 * `InvocationType: 'Event'`, so what matters is that the promise is awaited
 * before the runtime freezes the container.
 */
import { runWorker } from './worker.js';
import { ensureRuntimeSecrets } from './secrets.js';
import { bridgeBedrockEnv, metricLog } from './util.js';

type WorkerEvent = { walkcroachWorker?: { runId?: string } };

export async function handler(event: WorkerEvent): Promise<{ ok: boolean; runId?: string }> {
  const runId = event?.walkcroachWorker?.runId;
  if (!runId) {
    // Nothing to retry and nowhere to report it: fail loudly in the logs rather
    // than exiting successfully on a malformed envelope.
    metricLog('ide.worker.bad_envelope', { ok: false });
    throw new Error('worker invoked without walkcroachWorker.runId');
  }

  await ensureRuntimeSecrets();
  bridgeBedrockEnv();

  const started = Date.now();
  try {
    // runWorker owns its own failure handling and records the outcome on the
    // run itself, so there is deliberately no try/catch translation here.
    await runWorker(runId);
    metricLog('ide.worker.done', { runId, ms: Date.now() - started });
    return { ok: true, runId };
  } catch (err) {
    metricLog('ide.worker.unhandled', {
      runId,
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    throw err;
  }
}
