import { afterAll, describe, expect, it } from 'vitest';
import { createDbClient, loadEnv } from '@walkcroach/db';
import {
  appendRunEvent,
  cancelRun,
  claimRun,
  completeRun,
  getRun,
  heartbeatRun,
  isTerminal,
  listRunEvents,
  reapExpiredRuns,
  submitRun,
} from './run-store.js';

loadEnv(process.cwd());

const describeDb = process.env.CRDB_CONNECTION_STRING ? describe : describe.skip;

describeDb('run store (CRDB)', () => {
  let dbRef: ReturnType<typeof createDbClient> | null = null;
  const db = () => (dbRef ??= createDbClient());

  const ownerA = `run-a-${Date.now()}`;
  const ownerB = `run-b-${Date.now()}`;
  const projectId = '11111111-2222-3333-4444-555555555555';

  const submit = (over: Partial<Parameters<typeof submitRun>[0]> = {}) =>
    submitRun({
      db: db(),
      ownerId: ownerA,
      projectId,
      kind: 'content.publish',
      request: { repo: 'acme/site' },
      ...over,
    });

  afterAll(async () => {
    if (!dbRef) return;
    await dbRef.query(
      `DELETE FROM agent_run_events WHERE run_id IN
         (SELECT id FROM agent_runs WHERE owner_id IN ($1, $2))`,
      [ownerA, ownerB],
    );
    await dbRef.query('DELETE FROM agent_runs WHERE owner_id IN ($1, $2)', [ownerA, ownerB]);
    await dbRef.close();
  });

  it('submits a queued run carrying its request', async () => {
    const { run, created } = await submit();
    expect(created).toBe(true);
    expect(run.status).toBe('queued');
    // The worker starts cold; the request has to be readable without the caller.
    expect(run.request).toMatchObject({ repo: 'acme/site' });
  });

  it('returns the existing run for a repeated idempotency key', async () => {
    // A flaky network must not turn one blog post into three pull requests.
    const first = await submit({ idempotencyKey: 'post-42' });
    const second = await submit({ idempotencyKey: 'post-42' });
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });

  it('scopes idempotency keys per owner', async () => {
    const a = await submit({ idempotencyKey: 'shared-key' });
    const b = await submit({ ownerId: ownerB, idempotencyKey: 'shared-key' });
    expect(b.created).toBe(true);
    expect(b.run.id).not.toBe(a.run.id);
  });

  it('treats concurrent submits with one key as a single run', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => submit({ idempotencyKey: 'racy' })),
    );
    expect(new Set(results.map((r) => r.run.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('lets exactly one worker claim a run', async () => {
    // Async invoke is at-least-once, so two workers can be handed the same run.
    const { run } = await submit();
    const claims = await Promise.all([
      claimRun(db(), run.id),
      claimRun(db(), run.id),
      claimRun(db(), run.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('records the attempt and start time on claim', async () => {
    const { run } = await submit();
    const claimed = await claimRun(db(), run.id);
    expect(claimed).toMatchObject({ status: 'running', attempts: 1 });
    expect(claimed!.startedAt).not.toBeNull();
  });

  it('heartbeats while running and stops once finished', async () => {
    const { run } = await submit();
    await claimRun(db(), run.id);
    expect(await heartbeatRun(db(), run.id)).toBe(true);

    await completeRun({ db: db(), runId: run.id, status: 'succeeded', result: { ok: true } });
    // Nothing left to extend — the run is terminal.
    expect(await heartbeatRun(db(), run.id)).toBe(false);
  });

  it('refuses a late writer trying to overwrite a terminal run', async () => {
    // A reaped worker must not resurrect its run with a result computed after
    // it lost the lease.
    const { run } = await submit();
    await claimRun(db(), run.id);
    expect(
      await completeRun({ db: db(), runId: run.id, status: 'failed', error: 'timed out' }),
    ).toBe(true);
    expect(
      await completeRun({ db: db(), runId: run.id, status: 'succeeded', result: { ok: true } }),
    ).toBe(false);

    const after = await getRun({ db: db(), runId: run.id, ownerId: ownerA });
    expect(after?.status).toBe('failed');
  });

  it('fails a run whose lease lapsed, with an actionable reason', async () => {
    const { run } = await submit();
    await claimRun(db(), run.id);
    await db().query(
      `UPDATE agent_runs SET lease_expires_at = now() - INTERVAL '1 minute' WHERE id = $1::uuid`,
      [run.id],
    );

    expect(await reapExpiredRuns(db())).toBeGreaterThanOrEqual(1);
    const after = await getRun({ db: db(), runId: run.id, ownerId: ownerA });
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/lease expired/);
    // Otherwise the caller polls a status that will never change.
    expect(after?.error).toMatch(/retry/i);
  });

  it('does not reap a healthy run', async () => {
    const { run } = await submit();
    await claimRun(db(), run.id);
    await reapExpiredRuns(db());
    expect((await getRun({ db: db(), runId: run.id, ownerId: ownerA }))?.status).toBe('running');
  });

  it('never returns another owner run', async () => {
    const { run } = await submit();
    expect(await getRun({ db: db(), runId: run.id, ownerId: ownerB })).toBeNull();
  });

  it('will not let another owner cancel a run', async () => {
    const { run } = await submit();
    expect(await cancelRun({ db: db(), runId: run.id, ownerId: ownerB })).toBe(false);
    expect(await cancelRun({ db: db(), runId: run.id, ownerId: ownerA })).toBe(true);
  });

  it('cannot cancel a finished run', async () => {
    const { run } = await submit();
    await claimRun(db(), run.id);
    await completeRun({ db: db(), runId: run.id, status: 'succeeded' });
    expect(await cancelRun({ db: db(), runId: run.id, ownerId: ownerA })).toBe(false);
  });

  it('numbers events densely so a poller can ask for everything after N', async () => {
    const { run } = await submit();
    for (const t of ['phase', 'tool_card', 'phase', 'done']) {
      await appendRunEvent({ db: db(), runId: run.id, type: t });
    }
    const all = await listRunEvents({ db: db(), runId: run.id });
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4]);

    const tail = await listRunEvents({ db: db(), runId: run.id, afterSeq: 2 });
    expect(tail.map((e) => e.type)).toEqual(['phase', 'done']);
  });

  it('round-trips event payloads', async () => {
    const { run } = await submit();
    await appendRunEvent({
      db: db(),
      runId: run.id,
      type: 'tool_card',
      payload: { name: 'write_file', path: 'src/a.tsx' },
    });
    const [event] = await listRunEvents({ db: db(), runId: run.id });
    expect(event!.payload).toMatchObject({ name: 'write_file', path: 'src/a.tsx' });
  });
});

describe('status helpers', () => {
  it('classifies terminal states', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('running')).toBe(false);
  });
});
