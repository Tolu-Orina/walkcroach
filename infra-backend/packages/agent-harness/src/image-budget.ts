/**
 * Rolling 24-hour image-generation budget, scoped to an API key.
 *
 * `generateCanvasImage` is the raw Nova Canvas model call. Every control around
 * it — paid entitlement, the 3/24h hard quota, the 5-credit debit — lives in
 * `loop.ts` and is injected by the Web BFF. An SDK caller reaching Canvas
 * directly (which is correct; the creative Lambda is a Web capability) therefore
 * has no ceiling at all, and a runaway loop bills the account owner for
 * thousands of invocations.
 *
 * This is that ceiling. It is an abuse rail, not a billing primitive — spend
 * accounting stays in `credit_ledger`. Conflating the two would put a pricing
 * decision behind a safety control, and they change for different reasons.
 */
import type { DbClient } from '@walkcroach/db';

export const DEFAULT_IMAGE_DAILY_LIMIT = 20;

export class ImageBudgetExceededError extends Error {
  readonly code = 'IMAGE_BUDGET_EXCEEDED';
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      `image budget exhausted: ${used}/${limit} generated in the last 24h for this API key. ` +
        `Raise the key's image_daily_limit or wait for the window to roll.`,
    );
    this.name = 'ImageBudgetExceededError';
  }
}

export type BudgetState = { used: number; limit: number; remaining: number };

export async function getImageBudget(
  db: DbClient,
  keyId: string,
): Promise<BudgetState> {
  const { rows } = await db.query<{ limit: number; used: string }>(
    `SELECT k.image_daily_limit AS limit,
            COALESCE((
              SELECT sum(u.count) FROM api_key_image_usage u
               WHERE u.key_id = k.id
                 AND u.hour_bucket > now() - INTERVAL '24 hours'
            ), 0) AS used
       FROM api_keys k
      WHERE k.id = $1`,
    [keyId],
  );
  const row = rows[0];
  if (!row) return { used: 0, limit: 0, remaining: 0 };
  // CockroachDB INT is INT8 and node-postgres returns int8 as a string, so
  // sum() arrives as text. Number() here is load-bearing, not defensive.
  const used = Number(row.used);
  const limit = Number(row.limit);
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Reserve `count` images, or throw.
 *
 * Read-check-write in one transaction: two concurrent publishes on the same key
 * must not both observe `used = 19` against a limit of 20 and both proceed. The
 * whole point of this rail is that it holds under exactly the runaway
 * concurrency it exists to stop.
 */
export async function reserveImageBudget(
  db: DbClient,
  keyId: string,
  count = 1,
): Promise<BudgetState> {
  if (count <= 0) return getImageBudget(db, keyId);

  return db.withTransaction(async (tx) => {
    const { rows } = await tx.query<{ limit: number; used: string }>(
      `SELECT k.image_daily_limit AS limit,
              COALESCE((
                SELECT sum(u.count) FROM api_key_image_usage u
                 WHERE u.key_id = k.id
                   AND u.hour_bucket > now() - INTERVAL '24 hours'
              ), 0) AS used
         FROM api_keys k
        WHERE k.id = $1`,
      [keyId],
    );
    const row = rows[0];
    if (!row) throw new ImageBudgetExceededError(0, 0);

    const used = Number(row.used);
    const limit = Number(row.limit);
    if (used + count > limit) throw new ImageBudgetExceededError(used, limit);

    await tx.query(
      `INSERT INTO api_key_image_usage (key_id, hour_bucket, count)
       VALUES ($1, date_trunc('hour', now()), $2)
       ON CONFLICT (key_id, hour_bucket)
       DO UPDATE SET count = api_key_image_usage.count + $2`,
      [keyId, count],
    );

    return { used: used + count, limit, remaining: limit - used - count };
  });
}

/**
 * Hand back reservations that were never spent.
 *
 * Called when generation fails after reserving. Without it a Bedrock outage
 * silently burns a caller's whole daily budget — the same failure the Web path
 * avoids by releasing its hard quota on Canvas failure.
 */
export async function releaseImageBudget(
  db: DbClient,
  keyId: string,
  count = 1,
): Promise<void> {
  if (count <= 0) return;

  /**
   * Release from the most recent non-empty bucket, not from the current hour.
   *
   * Reserving at 10:59 and releasing at 11:01 lands in a different bucket, so
   * pinning to `date_trunc('hour', now())` silently released nothing and the
   * caller lost that budget until the window rolled — the exact failure this
   * function exists to prevent, and likeliest precisely when it matters, since
   * a slow Bedrock call is what pushes a release past the hour boundary.
   *
   * Walks buckets newest-first so a release spanning the boundary drains the
   * current hour first and takes the remainder from the previous one.
   */
  await db.withTransaction(async (tx) => {
    const { rows } = await tx.query<{ hour_bucket: Date; count: number }>(
      `SELECT hour_bucket, count FROM api_key_image_usage
        WHERE key_id = $1 AND count > 0
          AND hour_bucket > now() - INTERVAL '24 hours'
        ORDER BY hour_bucket DESC`,
      [keyId],
    );

    let remaining = count;
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(row.count));
      await tx.query(
        `UPDATE api_key_image_usage SET count = count - $3
          WHERE key_id = $1 AND hour_bucket = $2`,
        [keyId, row.hour_bucket, take],
      );
      remaining -= take;
    }
  });
}
