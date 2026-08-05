/**
 * `/v1/runs/:id` — read and cancel asynchronous runs.
 *
 * Polling with `afterSeq` returns only events the caller has not seen, so a
 * client gets streaming-like progress without holding a connection open for
 * minutes — and unlike a stream, closing the laptop loses nothing.
 */
import {
  cancelRun,
  getRun,
  isTerminal,
  listRunEvents,
  reapExpiredRuns,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { isUuid, metricLog } from '../util.js';
import { requireScope } from './sdk-memory.js';

/**
 * How long a client should wait before polling again.
 *
 * Returned with every response so backoff is the server's decision, not
 * something every SDK has to reinvent — and so it can be tuned without
 * shipping a new client.
 */
function pollAfterMs(status: string): number {
  if (isTerminal(status as never)) return 0;
  return status === 'queued' ? 1_000 : 2_000;
}

/** GET /v1/runs/:id?afterSeq=12&events=false */
export async function handleGetRun(
  auth: AuthContext,
  runId: string,
  query: Record<string, string | undefined>,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:read');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  if (!isUuid(runId)) return jsonResponse(400, { error: 'invalid run id' });

  const db = createDbClient();
  try {
    // Opportunistic: a run whose worker died would otherwise report `running`
    // forever, and there is no scheduler in this deployment to notice. Doing it
    // on read means the poller itself resolves the stall it is waiting on.
    await reapExpiredRuns(db).catch(() => 0);

    const run = await getRun({ db, runId, ownerId: auth.ownerId });
    // 404 for another tenant's run as well as a missing one — a 403 would
    // confirm the id exists.
    if (!run) return jsonResponse(404, { error: 'run not found' });

    const wantEvents = query.events !== 'false';
    const afterSeq = Number(query.afterSeq ?? 0);
    const events = wantEvents
      ? await listRunEvents({
          db,
          runId,
          afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
          limit: Number(query.limit ?? 200),
        })
      : [];

    return jsonResponse(200, {
      runId: run.id,
      status: run.status,
      kind: run.kind,
      attempts: run.attempts,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      result: run.result,
      error: run.error,
      events,
      // Where to resume from next poll, so the caller never has to track it.
      lastSeq: events.length > 0 ? events[events.length - 1]!.seq : afterSeq || 0,
      pollAfterMs: pollAfterMs(run.status),
    });
  } finally {
    await db.close();
  }
}

/** DELETE /v1/runs/:id */
export async function handleCancelRun(
  auth: AuthContext,
  runId: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:write');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  if (!isUuid(runId)) return jsonResponse(400, { error: 'invalid run id' });

  const db = createDbClient();
  try {
    const cancelled = await cancelRun({ db, runId, ownerId: auth.ownerId });
    if (!cancelled) {
      const run = await getRun({ db, runId, ownerId: auth.ownerId });
      if (!run) return jsonResponse(404, { error: 'run not found' });
      // Distinguishable from "no such run": the caller asked for something that
      // already happened, which is not the same as asking about nothing.
      return jsonResponse(409, {
        error: `run is already ${run.status}`,
        status: run.status,
      });
    }
    metricLog('sdk.run.cancelled', { ok: true });
    return jsonResponse(200, { runId, status: 'cancelled' });
  } finally {
    await db.close();
  }
}
