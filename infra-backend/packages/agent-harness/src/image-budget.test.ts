import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, loadEnv } from '@walkcroach/db';
import {
  getImageBudget,
  ImageBudgetExceededError,
  releaseImageBudget,
  reserveImageBudget,
} from './image-budget.js';

loadEnv(process.cwd());

const describeDb = process.env.CRDB_CONNECTION_STRING ? describe : describe.skip;

describeDb('image budget (CRDB)', () => {
  let dbRef: ReturnType<typeof createDbClient> | null = null;
  const db = () => (dbRef ??= createDbClient());

  const owner = `budget-test-${Date.now()}`;
  let keyId = '';

  async function mintKey(limit: number): Promise<string> {
    const { rows } = await db().query<{ id: string }>(
      `INSERT INTO api_keys (owner_id, name, key_prefix, key_hash, key_salt, scopes, image_daily_limit)
       VALUES ($1, 'budget', $2, '\\x00'::bytes, '\\x00'::bytes, ARRAY['memory:read'], $3)
       RETURNING id`,
      [owner, `wc_live_${Math.random().toString(36).slice(2, 12)}`, limit],
    );
    return rows[0]!.id;
  }

  beforeAll(async () => {
    keyId = await mintKey(3);
  });

  afterAll(async () => {
    if (!dbRef) return;
    await dbRef.query(
      'DELETE FROM api_key_image_usage WHERE key_id IN (SELECT id FROM api_keys WHERE owner_id = $1)',
      [owner],
    );
    await dbRef.query('DELETE FROM api_keys WHERE owner_id = $1', [owner]);
    await dbRef.close();
  });

  it('starts with the full limit available', async () => {
    const state = await getImageBudget(db(), keyId);
    expect(state).toMatchObject({ used: 0, limit: 3, remaining: 3 });
  });

  it('decrements on reserve', async () => {
    const after = await reserveImageBudget(db(), keyId, 1);
    expect(after).toMatchObject({ used: 1, limit: 3, remaining: 2 });
  });

  it('refuses to exceed the limit and names the numbers', async () => {
    await reserveImageBudget(db(), keyId, 2); // now at 3/3
    try {
      await reserveImageBudget(db(), keyId, 1);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ImageBudgetExceededError);
      expect((err as ImageBudgetExceededError).code).toBe('IMAGE_BUDGET_EXCEEDED');
      expect((err as Error).message).toMatch(/3\/3/);
    }
  });

  it('refuses a batch that would overshoot, without partially reserving', async () => {
    const fresh = await mintKey(5);
    await expect(reserveImageBudget(db(), fresh, 6)).rejects.toThrow(
      ImageBudgetExceededError,
    );
    // All-or-nothing: a rejected batch must not have consumed anything.
    expect((await getImageBudget(db(), fresh)).used).toBe(0);
  });

  it('returns unspent reservations on failure', async () => {
    const fresh = await mintKey(5);
    await reserveImageBudget(db(), fresh, 3);
    await releaseImageBudget(db(), fresh, 2);
    expect((await getImageBudget(db(), fresh)).used).toBe(1);
  });

  it('releases a reservation made in an earlier hour', async () => {
    // Regression: release pinned to date_trunc('hour', now()), so a reservation
    // at 10:59 released at 11:01 hit a different bucket and silently freed
    // nothing — losing the caller that budget until the window rolled. Likeliest
    // exactly when it matters, since a slow Bedrock call is what pushes a
    // release past the boundary.
    const fresh = await mintKey(5);
    await db().query(
      `INSERT INTO api_key_image_usage (key_id, hour_bucket, count)
       VALUES ($1, date_trunc('hour', now()) - INTERVAL '1 hour', 3)`,
      [fresh],
    );
    expect((await getImageBudget(db(), fresh)).used).toBe(3);

    await releaseImageBudget(db(), fresh, 2);
    expect((await getImageBudget(db(), fresh)).used).toBe(1);
  });

  it('drains the current hour first, then spills into the previous one', async () => {
    const fresh = await mintKey(10);
    await db().query(
      `INSERT INTO api_key_image_usage (key_id, hour_bucket, count)
       VALUES ($1, date_trunc('hour', now()) - INTERVAL '1 hour', 3)`,
      [fresh],
    );
    await reserveImageBudget(db(), fresh, 2); // 2 in the current hour
    expect((await getImageBudget(db(), fresh)).used).toBe(5);

    await releaseImageBudget(db(), fresh, 4);
    expect((await getImageBudget(db(), fresh)).used).toBe(1);
  });

  it('never releases below zero', async () => {
    const fresh = await mintKey(5);
    await reserveImageBudget(db(), fresh, 1);
    await releaseImageBudget(db(), fresh, 10);
    expect((await getImageBudget(db(), fresh)).used).toBe(0);
  });

  it('holds under concurrent reservations', async () => {
    // The rail exists to stop runaway automation, so it has to survive exactly
    // the concurrency it is meant to catch. Ten parallel single reservations
    // against a limit of 4 must grant exactly 4.
    const fresh = await mintKey(4);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveImageBudget(db(), fresh, 1)),
    );
    const granted = results.filter((r) => r.status === 'fulfilled').length;
    expect(granted).toBe(4);
    expect((await getImageBudget(db(), fresh)).used).toBe(4);
  });

  it('reports zero budget for an unknown key rather than allowing it', async () => {
    const state = await getImageBudget(db(), '00000000-0000-0000-0000-000000000000');
    expect(state).toMatchObject({ limit: 0, remaining: 0 });
  });
});
