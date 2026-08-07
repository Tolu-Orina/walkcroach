/**
 * Durable state for asynchronous agent runs.
 *
 * Lifecycle: `queued → running → succeeded|failed|interrupted`, plus `cancelled`.
 * `interrupted` is a LangGraph-style pause (HITL): the worker stopped with an
 * interrupt payload; `resumeRun` re-queues with the caller's value.
 *
 * Every transition is guarded so a late or duplicate writer cannot corrupt it.
 * Failure modes: zombie worker after lease expiry; retried submit starting a
 * second job; resume of the wrong interrupt id.
 */
import type { DbClient } from '@walkcroach/db';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
];

/** Statuses that still accept cancel. */
export const CANCELLABLE_STATUSES: readonly RunStatus[] = [
  'queued',
  'running',
  'interrupted',
];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type AgentRun = {
  id: string;
  ownerId: string;
  projectId: string;
  kind: string;
  status: RunStatus;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type RunEvent = {
  seq: number;
  at: string;
  type: string;
  payload: Record<string, unknown>;
};

/** How long a worker's claim is good for before the reaper may take the run. */
export const LEASE_SECONDS = 90;

function toRun(row: {
  id: string;
  owner_id: string;
  project_id: string;
  kind: string;
  status: string;
  request: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}): AgentRun {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status as RunStatus,
    request: (row.request ?? {}) as Record<string, unknown>,
    result: (row.result ?? null) as Record<string, unknown> | null,
    error: row.error,
    attempts: Number(row.attempts),
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

const SELECT = `id, owner_id, project_id, kind, status, request, result, error,
                attempts, created_at, started_at, finished_at`;

/**
 * Submit a run.
 *
 * With an idempotency key, a repeat submit returns the **existing** run rather
 * than creating a second. `ON CONFLICT DO NOTHING` plus a follow-up read makes
 * that safe under concurrency: two simultaneous submits with the same key race
 * on the unique index, and the loser reads the winner's row instead of erroring.
 */
export async function submitRun(params: {
  db: DbClient;
  ownerId: string;
  projectId: string;
  kind: string;
  request: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<{ run: AgentRun; created: boolean }> {
  const key = params.idempotencyKey?.trim() || null;

  const { rows } = await params.db.query<Parameters<typeof toRun>[0]>(
    `INSERT INTO agent_runs (owner_id, project_id, kind, request, idempotency_key)
     VALUES ($1, $2::uuid, $3, $4::jsonb, $5)
     ON CONFLICT (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING ${SELECT}`,
    [params.ownerId, params.projectId, params.kind, JSON.stringify(params.request), key],
  );

  if (rows[0]) return { run: toRun(rows[0]), created: true };

  const { rows: existing } = await params.db.query<Parameters<typeof toRun>[0]>(
    `SELECT ${SELECT} FROM agent_runs WHERE owner_id = $1 AND idempotency_key = $2`,
    [params.ownerId, key],
  );
  if (!existing[0]) {
    throw new Error('run submission conflicted but no existing run was found');
  }
  return { run: toRun(existing[0]), created: false };
}

/**
 * Claim a queued run for execution.
 *
 * Conditional on `status = 'queued'` so two workers handed the same run — which
 * async invoke can do, since delivery is at-least-once — cannot both proceed.
 * The loser gets null and exits quietly.
 */
export async function claimRun(
  db: DbClient,
  runId: string,
): Promise<AgentRun | null> {
  const { rows } = await db.query<Parameters<typeof toRun>[0]>(
    `UPDATE agent_runs
        SET status = 'running',
            started_at = COALESCE(started_at, now()),
            attempts = attempts + 1,
            lease_expires_at = now() + ($2 || ' seconds')::interval
      WHERE id = $1::uuid AND status = 'queued'
      RETURNING ${SELECT}`,
    [runId, LEASE_SECONDS],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

/** Extend the lease. Returns false once the run is no longer ours to extend. */
export async function heartbeatRun(db: DbClient, runId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE agent_runs
        SET lease_expires_at = now() + ($2 || ' seconds')::interval
      WHERE id = $1::uuid AND status = 'running'`,
    [runId, LEASE_SECONDS],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Finish a run.
 *
 * Guarded on `status = 'running'`: a worker that lost its lease and was reaped
 * must not be able to overwrite the failure with a success it computed after
 * the fact. Returns false when the run had already moved on.
 */
export async function completeRun(params: {
  db: DbClient;
  runId: string;
  status: Extract<RunStatus, 'succeeded' | 'failed'>;
  result?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<boolean> {
  const res = await params.db.query(
    `UPDATE agent_runs
        SET status = $2, result = $3::jsonb, error = $4,
            finished_at = now(), lease_expires_at = NULL
      WHERE id = $1::uuid AND status = 'running'`,
    [
      params.runId,
      params.status,
      params.result ? JSON.stringify(params.result) : null,
      params.error ?? null,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Pause a running job for human input (LangGraph-style interrupt).
 *
 * Stores the interrupt on `result.interrupt` and clears the lease so the
 * reaper does not treat the pause as a dead worker. Not terminal — `resumeRun`
 * returns the job to `queued`.
 */
export async function interruptRun(params: {
  db: DbClient;
  runId: string;
  interrupt: {
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    createdAt: string;
  };
  /** Partial publish/agent result so far (files, refusals, …). */
  result?: Record<string, unknown> | null;
}): Promise<boolean> {
  const merged = {
    ...(params.result ?? {}),
    interrupt: params.interrupt,
    ok: false,
    reason: 'interrupted',
  };
  const res = await params.db.query(
    `UPDATE agent_runs
        SET status = 'interrupted',
            result = $2::jsonb,
            error = NULL,
            finished_at = NULL,
            lease_expires_at = NULL
      WHERE id = $1::uuid AND status = 'running'`,
    [params.runId, JSON.stringify(merged)],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Resume after an interrupt: verify interrupt id, stash resume value on the
 * request, and re-queue for a worker claim.
 */
export async function resumeRun(params: {
  db: DbClient;
  runId: string;
  ownerId: string;
  interruptId: string;
  value: unknown;
}): Promise<{ ok: true; run: AgentRun } | { ok: false; error: string; status?: RunStatus }> {
  const run = await getRun({
    db: params.db,
    runId: params.runId,
    ownerId: params.ownerId,
  });
  if (!run) return { ok: false, error: 'run not found' };
  if (run.status !== 'interrupted') {
    return { ok: false, error: `run is ${run.status}, not interrupted`, status: run.status };
  }
  const interrupt = (run.result?.interrupt ?? null) as
    | { id?: string }
    | null;
  if (!interrupt?.id || interrupt.id !== params.interruptId) {
    return { ok: false, error: 'interrupt id does not match' };
  }

  const nextRequest = {
    ...run.request,
    resume: {
      interruptId: params.interruptId,
      value: params.value,
      resumedAt: new Date().toISOString(),
    },
  };

  const res = await params.db.query<Parameters<typeof toRun>[0]>(
    `UPDATE agent_runs
        SET status = 'queued',
            request = $3::jsonb,
            result = NULL,
            error = NULL,
            finished_at = NULL,
            lease_expires_at = NULL
      WHERE id = $1::uuid AND owner_id = $2 AND status = 'interrupted'
      RETURNING ${SELECT}`,
    [params.runId, params.ownerId, JSON.stringify(nextRequest)],
  );
  if (!res.rows[0]) {
    return { ok: false, error: 'resume race: run left interrupted state' };
  }
  return { ok: true, run: toRun(res.rows[0]) };
}

/** Cancel, but only while there is still something to cancel. */
export async function cancelRun(params: {
  db: DbClient;
  runId: string;
  ownerId: string;
}): Promise<boolean> {
  const res = await params.db.query(
    `UPDATE agent_runs
        SET status = 'cancelled', finished_at = now(), lease_expires_at = NULL
      WHERE id = $1::uuid AND owner_id = $2
        AND status IN ('queued', 'running', 'interrupted')`,
    [params.runId, params.ownerId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getRun(params: {
  db: DbClient;
  runId: string;
  ownerId: string;
}): Promise<AgentRun | null> {
  // owner_id in the predicate, not checked afterwards — one tenant must not be
  // able to read another's run by guessing a uuid.
  const { rows } = await params.db.query<Parameters<typeof toRun>[0]>(
    `SELECT ${SELECT} FROM agent_runs WHERE id = $1::uuid AND owner_id = $2`,
    [params.runId, params.ownerId],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

/**
 * Append a progress event.
 *
 * `seq` is allocated from the existing maximum for the run rather than a global
 * sequence, so numbers are dense per run and a client can ask for "everything
 * after 12" without gaps.
 */
export async function appendRunEvent(params: {
  db: DbClient;
  runId: string;
  type: string;
  payload?: Record<string, unknown>;
}): Promise<number> {
  const { rows } = await params.db.query<{ seq: number }>(
    `INSERT INTO agent_run_events (run_id, seq, type, payload)
     SELECT $1::uuid, COALESCE(MAX(seq), 0) + 1, $2, $3::jsonb
       FROM agent_run_events WHERE run_id = $1::uuid
     RETURNING seq`,
    [params.runId, params.type, JSON.stringify(params.payload ?? {})],
  );
  return Number(rows[0]?.seq ?? 0);
}

export async function listRunEvents(params: {
  db: DbClient;
  runId: string;
  afterSeq?: number;
  limit?: number;
}): Promise<RunEvent[]> {
  const { rows } = await params.db.query<{
    seq: number;
    at: Date;
    type: string;
    payload: unknown;
  }>(
    `SELECT seq, at, type, payload FROM agent_run_events
      WHERE run_id = $1::uuid AND seq > $2
      ORDER BY seq ASC LIMIT $3`,
    [params.runId, params.afterSeq ?? 0, Math.min(params.limit ?? 200, 500)],
  );
  return rows.map((r) => ({
    seq: Number(r.seq),
    at: r.at.toISOString(),
    type: r.type,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Fail runs whose worker died.
 *
 * Without this a Lambda killed at its timeout leaves a run on `running`
 * forever, and the caller polls a status that will never change. The lease is
 * what turns "the worker vanished" into an answer.
 */
export async function reapExpiredRuns(db: DbClient): Promise<number> {
  const res = await db.query(
    `UPDATE agent_runs
        SET status = 'failed',
            error = 'the worker stopped responding (lease expired). It may have hit the ' ||
                    'Lambda execution limit; retry, or split the work into smaller runs.',
            finished_at = now(),
            lease_expires_at = NULL
      WHERE status = 'running' AND lease_expires_at < now()`,
  );
  return res.rowCount ?? 0;
}
