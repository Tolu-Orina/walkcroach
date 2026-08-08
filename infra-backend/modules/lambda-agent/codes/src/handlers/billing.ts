/**
 * Web billing: Stripe checkout, webhooks, and the billing portal.
 *
 * The credit ledger itself now lives in `@walkcroach/ledger` so the Chrome BFF
 * can debit the same pool — it was previously able to read the balance but not
 * charge against it. Re-exported here so this module's public surface is
 * unchanged for existing callers and tests.
 */
import type { DbClient } from '@walkcroach/db';
import {
  CREDIT_COSTS,
  ensureBalanceRow,
  grantForPlan,
  FREE_MONTHLY_CREDITS,
  PAID_MONTHLY_CREDITS,
  PRO_MONTHLY_CREDITS,
  STARTER_MONTHLY_CREDITS,
  assertCredits,
  debitCredits,
  refundCredits,
  getEntitlement,
  getEntitlementRow,
  getUsageSummary,
  hasCreativesAccess,
  hasVideoAccess,
  hasConnectorWriteAccess,
  normalizePlan,
  type Entitlement,
  type EntitlementRow,
  type PlanId,
} from '@walkcroach/ledger';

export {
  CREDIT_COSTS,
  FREE_MONTHLY_CREDITS,
  PAID_MONTHLY_CREDITS,
  PRO_MONTHLY_CREDITS,
  STARTER_MONTHLY_CREDITS,
  assertCredits,
  debitCredits,
  refundCredits,
  getEntitlement,
  getEntitlementRow,
  getUsageSummary,
  hasCreativesAccess,
  hasVideoAccess,
  hasConnectorWriteAccess,
  normalizePlan,
};
export type { Entitlement, EntitlementRow, PlanId };

/** Flip an owner to a plan; used by admin hook and Stripe webhook. */
export async function setEntitlement(
  db: DbClient,
  ownerId: string,
  plan: PlanId | string,
  stripeCustomerId?: string | null,
): Promise<void> {
  const normalized = normalizePlan(plan);
  await db.query(
    `INSERT INTO entitlements (owner_id, plan, stripe_customer_id, plan_started_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (owner_id)
     DO UPDATE SET
       plan = EXCLUDED.plan,
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, entitlements.stripe_customer_id),
       plan_started_at = CASE
         WHEN entitlements.plan IS DISTINCT FROM EXCLUDED.plan THEN now()
         ELSE entitlements.plan_started_at
       END,
       updated_at = now()`,
    [ownerId, normalized, stripeCustomerId ?? null],
  );
}

/**
 * Apply plan + credit grant ceiling together (Phase G2).
 * Does not wipe used_this_month — upgrading mid-cycle raises the ceiling only.
 * Legacy `paid` normalizes to `pro`.
 */
export async function applySubscriptionPlan(
  db: DbClient,
  ownerId: string,
  plan: PlanId | string,
  stripeCustomerId?: string | null,
): Promise<void> {
  const normalized = normalizePlan(plan);
  await setEntitlement(db, ownerId, normalized, stripeCustomerId);
  const grant = grantForPlan(normalized);
  await ensureBalanceRow(db, ownerId);
  await db.query(
    `UPDATE credit_balances
     SET monthly_credits = $2, updated_at = now()
     WHERE owner_id = $1`,
    [ownerId, grant],
  );
}

/* --------------------------- rolling hard quotas ------------------------- */
/**
 * Hard creative caps — separate from credits (web plan §4.4/§7). Even a paid
 * owner cannot exceed 3 Nova Canvas images in any rolling 24h window or 1 Nova
 * Reel video in any rolling 72h window, because those models burn dollars per
 * generation regardless of credit price.
 */
export const HARD_QUOTAS = {
  image_gen_daily: {
    label: 'Image generation',
    limit: 3,
    interval: '24 hours',
    unit: 'day',
  },
  video_gen_3day: {
    label: 'Video generation',
    limit: 1,
    interval: '72 hours',
    unit: '3 days',
  },
} as const;

export type HardQuotaKey = keyof typeof HARD_QUOTAS;

export type QuotaCheck =
  | { ok: true; used: number; limit: number }
  | { ok: false; used: number; limit: number; resetAt: string };

/**
 * Atomic check-and-increment on a rolling window. Returns ok:false without
 * mutating when the cap would be exceeded. `amount` is for deck/flyer paths
 * that reserve multiple Canvas stills in one confirm (Phase H1).
 */
export async function consumeHardQuota(
  db: DbClient,
  ownerId: string,
  key: HardQuotaKey,
  amount = 1,
): Promise<QuotaCheck> {
  const q = HARD_QUOTAS[key];
  const n = Math.max(1, Math.floor(amount));
  if (n > q.limit) {
    return {
      ok: false,
      used: q.limit,
      limit: q.limit,
      resetAt: new Date().toISOString(),
    };
  }
  await db.query(
    `INSERT INTO usage_counters (owner_id, counter_key, window_start, count)
     VALUES ($1, $2, now(), 0)
     ON CONFLICT (owner_id, counter_key) DO NOTHING`,
    [ownerId, key],
  );
  const { rows } = await db.query<{
    count: number;
    reset_at: Date;
  }>(
    `UPDATE usage_counters
     SET
       count = CASE
         WHEN window_start + interval '${q.interval}' < now() THEN $4::int
         ELSE count + $4::int
       END,
       window_start = CASE
         WHEN window_start + interval '${q.interval}' < now() THEN now()
         ELSE window_start
       END
     WHERE owner_id = $1
       AND counter_key = $2
       AND (
         CASE
           WHEN window_start + interval '${q.interval}' < now() THEN 0
           ELSE count
         END
       ) + $4::int <= $3
     RETURNING count, window_start + interval '${q.interval}' AS reset_at`,
    [ownerId, key, q.limit, n],
  );
  if (!rows[0]) {
    const { rows: cur } = await db.query<{ count: number; reset_at: Date }>(
      `SELECT count, window_start + interval '${q.interval}' AS reset_at
       FROM usage_counters WHERE owner_id = $1 AND counter_key = $2`,
      [ownerId, key],
    );
    return {
      ok: false,
      used: cur[0]?.count ?? q.limit,
      limit: q.limit,
      resetAt: cur[0]?.reset_at?.toISOString() ?? new Date().toISOString(),
    };
  }
  return { ok: true, used: rows[0].count, limit: q.limit };
}

/**
 * Release previously consumed hard-quota slots (debit failed / Canvas failed).
 * Never drops below 0; no-op when the rolling window has already reset.
 */
export async function releaseHardQuota(
  db: DbClient,
  ownerId: string,
  key: HardQuotaKey,
  amount = 1,
): Promise<void> {
  const q = HARD_QUOTAS[key];
  const n = Math.max(1, Math.floor(amount));
  await db.query(
    `UPDATE usage_counters
     SET count = GREATEST(0, count - $3::int)
     WHERE owner_id = $1
       AND counter_key = $2
       AND window_start + interval '${q.interval}' >= now()`,
    [ownerId, key, n],
  );
}

/** Peek without consuming — for the Chat quota pill. */
export async function peekHardQuota(
  db: DbClient,
  ownerId: string,
  key: HardQuotaKey,
): Promise<{ used: number; limit: number; remaining: number; resetAt: string }> {
  const q = HARD_QUOTAS[key];
  const { rows } = await db.query<{ count: number; reset_at: Date }>(
    `SELECT
       CASE
         WHEN window_start + interval '${q.interval}' < now() THEN 0
         ELSE count
       END AS count,
       window_start + interval '${q.interval}' AS reset_at
     FROM usage_counters
     WHERE owner_id = $1 AND counter_key = $2`,
    [ownerId, key],
  );
  const used = rows[0]?.count ?? 0;
  return {
    used,
    limit: q.limit,
    remaining: Math.max(0, q.limit - used),
    resetAt: rows[0]?.reset_at?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Video hard cap — authoritative source is `video_jobs` (§5.2), not
 * usage_counters. In-flight + successful jobs in the last 72h count;
 * failed / proposed / declined do not (retry allowed).
 */
export async function peekVideoQuota(
  db: DbClient,
  ownerId: string,
): Promise<{ used: number; limit: number; remaining: number; resetAt: string }> {
  const limit = HARD_QUOTAS.video_gen_3day.limit;
  const { rows } = await db.query<{ used: number; oldest: Date | null }>(
    `SELECT
       COUNT(*)::int AS used,
       MIN(created_at) AS oldest
     FROM video_jobs
     WHERE owner_id = $1
       AND status IN ('queued', 'generating', 'composing', 'ready')
       AND created_at > now() - interval '72 hours'`,
    [ownerId],
  );
  const used = rows[0]?.used ?? 0;
  const oldest = rows[0]?.oldest;
  const resetAt = oldest
    ? new Date(oldest.getTime() + 72 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt,
  };
}

/** Assert a video slot is free before debit / start. */
export async function assertVideoQuota(
  db: DbClient,
  ownerId: string,
): Promise<QuotaCheck> {
  const peek = await peekVideoQuota(db, ownerId);
  if (peek.remaining <= 0) {
    return {
      ok: false,
      used: peek.used,
      limit: peek.limit,
      resetAt: peek.resetAt,
    };
  }
  return { ok: true, used: peek.used, limit: peek.limit };
}
