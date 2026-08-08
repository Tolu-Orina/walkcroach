/**
 * GET /chrome/v1/credits — shared Web/Chrome credit pool (Phase G3).
 * Same owner_id ledger as WalkCroach Web (`credit_balances` + `entitlements`).
 */
import { createDbClient } from '@walkcroach/db';
import { normalizePlan } from '@walkcroach/ledger';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { FREE_MONTHLY_CREDITS } from './credits-shared.js';

export async function handleGetCredits(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(200, {
      requiresSignIn: true,
      remaining: 0,
      allowance: 0,
      plan: 'free',
      sharedPool: true,
    });
  }

  const db = createDbClient();
  try {
    await db.query(
      `INSERT INTO credit_balances (owner_id, monthly_credits, used_this_month)
       VALUES ($1, $2, 0)
       ON CONFLICT (owner_id) DO NOTHING`,
      [auth.ownerId, FREE_MONTHLY_CREDITS],
    );
    const { rows: bal } = await db.query<{
      monthly_credits: number;
      used_this_month: number;
      period_start: Date;
    }>(
      `SELECT monthly_credits, used_this_month, period_start
       FROM credit_balances WHERE owner_id = $1`,
      [auth.ownerId],
    );
    const monthly = bal[0]?.monthly_credits ?? FREE_MONTHLY_CREDITS;
    let used = bal[0]?.used_this_month ?? 0;
    const periodStart = bal[0]?.period_start;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    if (periodStart && periodStart < monthStart) {
      await db.query(
        `UPDATE credit_balances
         SET used_this_month = 0,
             period_start = date_trunc('month', now()),
             updated_at = now()
         WHERE owner_id = $1
           AND period_start < date_trunc('month', now())`,
        [auth.ownerId],
      );
      used = 0;
    }
    const { rows: ent } = await db.query<{ plan: string }>(
      `SELECT plan FROM entitlements WHERE owner_id = $1`,
      [auth.ownerId],
    );
    const plan = normalizePlan(ent[0]?.plan);
    const remaining = Math.max(0, monthly - used);
    const resetsAt = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1),
    ).toISOString();
    return jsonResponse(200, {
      remaining,
      allowance: monthly,
      resetsAt,
      plan,
      sharedPool: true,
      label: 'Shared with WalkCroach Web',
    });
  } finally {
    await db.close();
  }
}
