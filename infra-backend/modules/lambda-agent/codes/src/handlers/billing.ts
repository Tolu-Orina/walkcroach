import type { DbClient } from '@walkcroach/db';

export const FREE_MONTHLY_CREDITS = Number(process.env.FREE_MONTHLY_CREDITS ?? 100);

export const CREDIT_COSTS: Record<string, number> = {
  agent_turn: 1,
  deploy: 5,
  db_provision: 10,
  inline_edit: 0,
  generate_image: 5,
  render_pptx: 20,
};

type BalanceRow = {
  owner_id: string;
  monthly_credits: number;
  used_this_month: number;
  period_start: Date;
};

async function ensureBalanceRow(db: DbClient, ownerId: string): Promise<BalanceRow> {
  await db.query(
    `INSERT INTO credit_balances (owner_id, monthly_credits, used_this_month)
     VALUES ($1, $2, 0)
     ON CONFLICT (owner_id) DO NOTHING`,
    [ownerId, FREE_MONTHLY_CREDITS],
  );

  const { rows } = await db.query<BalanceRow>(
    `SELECT owner_id, monthly_credits, used_this_month, period_start
     FROM credit_balances WHERE owner_id = $1`,
    [ownerId],
  );
  const row = rows[0]!;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  if (row.period_start < monthStart) {
    await db.query(
      `UPDATE credit_balances
       SET used_this_month = 0, period_start = date_trunc('month', now()), updated_at = now()
       WHERE owner_id = $1 AND period_start < date_trunc('month', now())`,
      [ownerId],
    );
    row.used_this_month = 0;
  }

  return row;
}

export async function getUsageSummary(
  db: DbClient,
  ownerId: string,
): Promise<{
  monthlyCredits: number;
  used: number;
  remaining: number;
  costs: typeof CREDIT_COSTS;
}> {
  const balance = await ensureBalanceRow(db, ownerId);
  const remaining = Math.max(0, balance.monthly_credits - balance.used_this_month);
  return {
    monthlyCredits: balance.monthly_credits,
    used: balance.used_this_month,
    remaining,
    costs: CREDIT_COSTS,
  };
}

export async function assertCredits(
  db: DbClient,
  ownerId: string,
  actionType: string,
): Promise<{ ok: true } | { ok: false; remaining: number }> {
  const cost = CREDIT_COSTS[actionType] ?? 0;
  if (cost === 0) return { ok: true };
  const summary = await getUsageSummary(db, ownerId);
  if (summary.remaining < cost) {
    return { ok: false, remaining: summary.remaining };
  }
  return { ok: true };
}

/**
 * Atomically debit credits. Safe under concurrent requests (no TOCTOU with assertCredits).
 * Returns ok:false when the balance cannot cover the cost.
 */
export async function debitCredits(
  db: DbClient,
  ownerId: string,
  actionType: string,
  projectId?: string,
  metadata: Record<string, unknown> = {},
): Promise<{ ok: true; remaining: number } | { ok: false; remaining: number }> {
  const cost = CREDIT_COSTS[actionType] ?? 0;
  await ensureBalanceRow(db, ownerId);

  if (cost > 0) {
    const { rows } = await db.query<{
      monthly_credits: number;
      used_this_month: number;
    }>(
      `UPDATE credit_balances
       SET
         used_this_month = CASE
           WHEN period_start < date_trunc('month', now()) THEN $2
           ELSE used_this_month + $2
         END,
         period_start = CASE
           WHEN period_start < date_trunc('month', now()) THEN date_trunc('month', now())
           ELSE period_start
         END,
         updated_at = now()
       WHERE owner_id = $1
         AND (
           CASE
             WHEN period_start < date_trunc('month', now()) THEN monthly_credits
             ELSE monthly_credits - used_this_month
           END
         ) >= $2
       RETURNING monthly_credits, used_this_month`,
      [ownerId, cost],
    );

    if (!rows[0]) {
      const summary = await getUsageSummary(db, ownerId);
      return { ok: false, remaining: summary.remaining };
    }
  }

  await db.query(
    `INSERT INTO usage_ledger (owner_id, project_id, action_type, credits, metadata)
     VALUES ($1, $2::uuid, $3, $4, $5::jsonb)`,
    [
      ownerId,
      projectId ?? null,
      actionType,
      cost,
      JSON.stringify(metadata),
    ],
  );

  const summary = await getUsageSummary(db, ownerId);
  return { ok: true, remaining: summary.remaining };
}

/* ------------------------------ entitlements ----------------------------- */

export type Entitlement = 'free' | 'paid';

/** Owner plan — rows created lazily; missing row means 'free'. */
export async function getEntitlement(
  db: DbClient,
  ownerId: string,
): Promise<Entitlement> {
  const { rows } = await db.query<{ plan: string }>(
    `SELECT plan FROM entitlements WHERE owner_id = $1`,
    [ownerId],
  );
  const plan = rows[0]?.plan;
  return plan === 'paid' ? 'paid' : 'free';
}

/** Flip an owner to a plan; used by Phase A2 admin hook and later Stripe webhook. */
export async function setEntitlement(
  db: DbClient,
  ownerId: string,
  plan: Entitlement,
): Promise<void> {
  await db.query(
    `INSERT INTO entitlements (owner_id, plan, plan_started_at, updated_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (owner_id)
     DO UPDATE SET plan = EXCLUDED.plan, plan_started_at = now(), updated_at = now()`,
    [ownerId, plan],
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
 * mutating when the cap is already reached.
 */
export async function consumeHardQuota(
  db: DbClient,
  ownerId: string,
  key: HardQuotaKey,
): Promise<QuotaCheck> {
  const q = HARD_QUOTAS[key];
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
         WHEN window_start + interval '${q.interval}' < now() THEN 1
         ELSE count + 1
       END,
       window_start = CASE
         WHEN window_start + interval '${q.interval}' < now() THEN now()
         ELSE window_start
       END
     WHERE owner_id = $1
       AND counter_key = $2
       AND (
         window_start + interval '${q.interval}' < now()
         OR count < $3
       )
     RETURNING count, window_start + interval '${q.interval}' AS reset_at`,
    [ownerId, key, q.limit],
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
