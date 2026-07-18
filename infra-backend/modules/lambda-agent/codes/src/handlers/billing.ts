import type { DbClient } from '@walkcroach/db';

export const FREE_MONTHLY_CREDITS = Number(process.env.FREE_MONTHLY_CREDITS ?? 100);

export const CREDIT_COSTS: Record<string, number> = {
  agent_turn: 1,
  deploy: 5,
  db_provision: 10,
  inline_edit: 0,
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
