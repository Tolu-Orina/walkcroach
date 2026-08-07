/**
 * `/v1/runs/:id` — read, resume, and cancel asynchronous runs.
 *
 * Polling with `afterSeq` returns only events the caller has not seen, so a
 * client gets streaming-like progress without holding a connection open for
 * minutes — and unlike a stream, closing the laptop loses nothing.
 *
 * Resume uses LangGraph-style interrupt vocabulary: POST with interruptId +
 * value re-queues an `interrupted` run.
 */
import {
  appendRunEvent,
  cancelRun,
  getRun,
  isTerminal,
  listRunEvents,
  reapExpiredRuns,
  resumeRun,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { resolveDispatcher } from '../dispatch.js';
import { jsonResponse } from '../http.js';
import { isUuid, metricLog } from '../util.js';
import { runWorker } from '../worker.js';
import { requireScope } from './sdk-memory.js';

const dispatchRun = resolveDispatcher(runWorker);

/**
 * How long a client should wait before polling again.
 *
 * Returned with every response so backoff is the server's decision, not
 * something every SDK has to reinvent — and so it can be tuned without
 * shipping a new client.
 */
function pollAfterMs(status: string): number {
  if (isTerminal(status as never)) return 0;
  if (status === 'interrupted') return 0;
  return status === 'queued' ? 1_000 : 2_000;
}

function interruptFromResult(
  result: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const interrupt = result.interrupt;
  if (!interrupt || typeof interrupt !== 'object') return null;
  return interrupt as Record<string, unknown>;
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

    const interrupt =
      run.status === 'interrupted' ? interruptFromResult(run.result) : null;

    return jsonResponse(200, {
      runId: run.id,
      /** LangGraph-style alias — same as runId for content runs. */
      threadId: run.id,
      status: run.status,
      kind: run.kind,
      attempts: run.attempts,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      result: run.result,
      error: run.error,
      interrupt,
      events,
      // Where to resume from next poll, so the caller never has to track it.
      lastSeq: events.length > 0 ? events[events.length - 1]!.seq : afterSeq || 0,
      pollAfterMs: pollAfterMs(run.status),
    });
  } finally {
    await db.close();
  }
}

/** POST /v1/runs/:id/resume — continue after interrupt */
export async function handleResumeRun(
  auth: AuthContext,
  runId: string,
  body: unknown,
): Promise<ReturnType<typeof jsonResponse>> {
  const deniedContent = requireScope(auth, 'content:run');
  const deniedWrite = requireScope(auth, 'memory:write');
  if (deniedContent && deniedWrite) {
    return jsonResponse(deniedContent.status, { error: deniedContent.error });
  }

  if (!isUuid(runId)) return jsonResponse(400, { error: 'invalid run id' });

  const payload = (body ?? {}) as { interruptId?: unknown; value?: unknown };
  if (typeof payload.interruptId !== 'string' || !payload.interruptId.trim()) {
    return jsonResponse(400, { error: 'interruptId is required' });
  }
  if (payload.value === undefined) {
    return jsonResponse(400, { error: 'value is required' });
  }

  const db = createDbClient();
  try {
    const outcome = await resumeRun({
      db,
      runId,
      ownerId: auth.ownerId,
      interruptId: payload.interruptId.trim(),
      value: payload.value,
    });
    if (!outcome.ok) {
      if (outcome.error === 'run not found') {
        return jsonResponse(404, { error: outcome.error });
      }
      return jsonResponse(409, {
        error: outcome.error,
        status: outcome.status,
      });
    }

    await appendRunEvent({
      db,
      runId,
      type: 'resume',
      payload: { interruptId: payload.interruptId.trim() },
    }).catch(() => {});

    await dispatchRun(runId);

    metricLog('sdk.run.resumed', { ok: true });
    return jsonResponse(200, {
      runId,
      threadId: runId,
      status: 'queued',
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
