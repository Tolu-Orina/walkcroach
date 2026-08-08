/**
 * Shared credit ledger and entitlements.
 *
 * Extracted from `lambda-agent/handlers/billing.ts` because the pool is
 * explicitly shared across surfaces (plan §7, "sharedPool: true"), and the Chrome
 * BFF was reading the balance while never debiting it — connector actions run
 * from the side panel were free, which silently made the shared pool a Web-only
 * limit.
 *
 * Only the ledger primitives live here. Stripe webhooks, checkout and the billing
 * portal stay in the agent Lambda: they are Web-specific and have no business
 * being importable by an extension backend.
 */
import type { DbClient } from '@walkcroach/db';
import {
  FREE_MONTHLY_CREDITS,
  grantForPlan,
  normalizePlan,
  type PlanId,
} from './plans.js';

export type { PlanId, Entitlement, PlanDefinition, PlanFeatures, PublicPlanCatalogItem } from './plans.js';
export {
  FREE_MONTHLY_CREDITS,
  STARTER_MONTHLY_CREDITS,
  PRO_MONTHLY_CREDITS,
  PAID_MONTHLY_CREDITS,
  PLAN_CATALOG,
  PLAN_ORDER,
  normalizePlan,
  planDefinition,
  grantForPlan,
  planRank,
  hasCreativesAccess,
  hasVideoAccess,
  hasConnectorWriteAccess,
  isUpgrade,
  isPaidPlan,
  publicPlanCatalog,
} from './plans.js';

export const CREDIT_COSTS: Record<string, number> = {
  agent_turn: 1,
  deploy: 5,
  db_provision: 10,
  inline_edit: 0,
  /** Keep at 5 (plan lists 4) — profitability: Canvas burn + hard cap 3/day. */
  generate_image: 5,
  render_pptx: 20,
  render_flyer: 10,
  start_video_job: 270,
  connector_write: 2,
  connector_read: 1,
  /** Public SDK memory control plane (Phase P1.5). */
  memory_remember: 1,
  memory_recall: 1,
  memory_import: 2,
  /** P1 — previously free after auth; meter to close export/diff abuse. */
  memory_list: 1,
  memory_export: 2,
  memory_diff: 1,
  memory_erase: 1,
  memory_audit: 1,
  content_publish: 5,
  /** Phase 6b — public Run Graph DSL submit. */
  graph_run: 3,
};

export type BalanceRow = {
  owner_id: string;
  monthly_credits: number;
  used_this_month: number;
  period_start: Date;
};

/** Exported: callers that upsert a plan must create the balance row first. */
export async function ensureBalanceRow(db: DbClient, ownerId: string): Promise<BalanceRow> {
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
  plan: PlanId;
  sharedPool: true;
}> {
  const [balance, plan] = await Promise.all([
    ensureBalanceRow(db, ownerId),
    getEntitlement(db, ownerId),
  ]);
  const remaining = Math.max(0, balance.monthly_credits - balance.used_this_month);
  return {
    monthlyCredits: balance.monthly_credits,
    used: balance.used_this_month,
    remaining,
    costs: CREDIT_COSTS,
    plan,
    /** Same owner_id ledger for Web Chat and Chrome side panel (G3). */
    sharedPool: true,
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
): Promise<
  | {
      ok: true;
      remaining: number;
      limit: number;
      ledgerId: string | null;
      credits: number;
    }
  | { ok: false; remaining: number; limit: number }
> {
  const cost = CREDIT_COSTS[actionType] ?? 0;
  await ensureBalanceRow(db, ownerId);

  // The conditional UPDATE is atomic on its own (that is what makes this safe
  // against concurrent debits), but the balance change and its audit row must
  // also commit together: previously a crash between the two left credits spent
  // with no usage_ledger entry explaining where they went, so the ledger silently
  // stopped reconciling against the balance.
  const debited = await db.withTransaction(async (tx) => {
    if (cost > 0) {
      const { rows } = await tx.query<{
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

      if (!rows[0]) return null;
    }

    const { rows: ledgerRows } = await tx.query<{ id: string }>(
      `INSERT INTO usage_ledger (owner_id, project_id, action_type, credits, metadata)
       VALUES ($1, $2::uuid, $3, $4, $5::jsonb)
       RETURNING id`,
      [ownerId, projectId ?? null, actionType, cost, JSON.stringify(metadata)],
    );
    return ledgerRows[0]?.id ?? null;
  });

  const summary = await getUsageSummary(db, ownerId);
  if (debited === null && cost > 0) {
    return {
      ok: false,
      remaining: summary.remaining,
      limit: summary.monthlyCredits,
    };
  }
  const out = {
    ok: true as const,
    remaining: summary.remaining,
    limit: summary.monthlyCredits,
    ledgerId: debited,
    credits: cost,
  };
  // P5.2 — every debit can meter; never block the ledger on Stripe.
  if (out.ledgerId && out.credits > 0) {
    void import('./stripe-meter.js')
      .then(({ maybeEmitMeterForDebit }) =>
        maybeEmitMeterForDebit(db, ownerId, {
          ledgerId: out.ledgerId,
          credits: out.credits,
        }),
      )
      .catch(() => undefined);
  }
  return out;
}

/**
 * Credit a prior debit (e.g. pipeline failed to start after charge).
 * Inserts a negative ledger row and reduces used_this_month (floor 0).
 */
export async function refundCredits(
  db: DbClient,
  ownerId: string,
  actionType: string,
  amount: number,
  projectId?: string,
  metadata: Record<string, unknown> = {},
): Promise<{ ok: true; remaining: number }> {
  const n = Math.max(0, Math.floor(amount));
  await ensureBalanceRow(db, ownerId);
  if (n > 0) {
    await db.query(
      `UPDATE credit_balances
       SET
         used_this_month = GREATEST(0, used_this_month - $2),
         updated_at = now()
       WHERE owner_id = $1`,
      [ownerId, n],
    );
  }
  await db.query(
    `INSERT INTO usage_ledger (owner_id, project_id, action_type, credits, metadata)
     VALUES ($1, $2::uuid, $3, $4, $5::jsonb)`,
    [
      ownerId,
      projectId ?? null,
      `refund:${actionType}`,
      -n,
      JSON.stringify({ ...metadata, refund: true }),
    ],
  );
  const summary = await getUsageSummary(db, ownerId);
  return { ok: true, remaining: summary.remaining };
}

/* ------------------------------ entitlements ----------------------------- */

export type EntitlementRow = {
  plan: PlanId;
  stripeCustomerId: string | null;
};

/** Owner plan — rows created lazily; missing row means 'free'. Legacy `paid` → `pro`. */
export async function getEntitlement(
  db: DbClient,
  ownerId: string,
): Promise<PlanId> {
  const row = await getEntitlementRow(db, ownerId);
  return row.plan;
}

export async function getEntitlementRow(
  db: DbClient,
  ownerId: string,
): Promise<EntitlementRow> {
  const { rows } = await db.query<{
    plan: string;
    stripe_customer_id: string | null;
  }>(
    `SELECT plan, stripe_customer_id FROM entitlements WHERE owner_id = $1`,
    [ownerId],
  );
  return {
    plan: normalizePlan(rows[0]?.plan),
    stripeCustomerId: rows[0]?.stripe_customer_id ?? null,
  };
}

export {
  emitBillingMeterEvent,
  maybeEmitMeterForDebit,
  stripeMeterConfigured,
  stripeMeterEventName,
  DEFAULT_STRIPE_METER_EVENT_NAME,
  type MeterEmitResult,
} from './stripe-meter.js';
