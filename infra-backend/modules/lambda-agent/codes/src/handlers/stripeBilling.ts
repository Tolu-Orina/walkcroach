/**
 * Stripe Billing — multi-tier subscriptions (Free / Starter / Pro).
 *
 * Checkout selects a paid tier by planId. Webhooks map Stripe Price IDs → plan.
 * Legacy `paid` entitlements normalize to `pro`.
 */
import Stripe from 'stripe';
import type { DbClient } from '@walkcroach/db';
import {
  isUpgrade,
  normalizePlan,
  planDefinition,
  publicPlanCatalog,
  type PlanId,
} from '@walkcroach/ledger';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { applySubscriptionPlan, getEntitlementRow } from './billing.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function stripeClient(): Stripe | null {
  const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
  if (!key) return null;
  return new Stripe(key, {
    apiVersion: '2025-02-24.acacia',
  });
}

function priceIdStarter(): string {
  return (process.env.STRIPE_PRICE_ID_STARTER ?? '').trim();
}

/** Pro price — `STRIPE_PRICE_ID_PRO` preferred; `STRIPE_PRICE_ID_PAID` kept as alias. */
function priceIdPro(): string {
  return (
    (process.env.STRIPE_PRICE_ID_PRO ?? '').trim() ||
    (process.env.STRIPE_PRICE_ID_PAID ?? '').trim()
  );
}

function webAppUrl(): string {
  return (process.env.WEB_APP_URL ?? '').replace(/\/$/, '') || 'http://localhost:5173';
}

function billingConfigured(): boolean {
  return Boolean(stripeClient() && (priceIdStarter() || priceIdPro()));
}

function priceIdForPlan(plan: PlanId): string | null {
  if (plan === 'starter') return priceIdStarter() || null;
  if (plan === 'pro') return priceIdPro() || null;
  return null;
}

function planFromPriceId(priceId: string | null | undefined): PlanId | null {
  const id = (priceId ?? '').trim();
  if (!id) return null;
  if (id === priceIdStarter()) return 'starter';
  if (id === priceIdPro()) return 'pro';
  return null;
}

function parseCheckoutBody(raw: string | undefined): { planId: PlanId } {
  let planId: PlanId = 'pro';
  if (raw) {
    try {
      const body = JSON.parse(raw) as { planId?: string; plan?: string };
      const requested = normalizePlan(body.planId ?? body.plan);
      if (requested === 'starter' || requested === 'pro') planId = requested;
    } catch {
      /* default pro */
    }
  }
  return { planId };
}

async function ensureStripeCustomer(
  db: DbClient,
  stripe: Stripe,
  ownerId: string,
  existing: string | null,
): Promise<string> {
  if (existing) return existing;
  const customer = await stripe.customers.create({
    metadata: { owner_id: ownerId },
  });
  await applySubscriptionPlan(db, ownerId, 'free', customer.id);
  return customer.id;
}

async function findActiveSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });
  return (
    list.data.find((s) => s.status === 'active' || s.status === 'trialing') ??
    null
  );
}

/** POST /billing/checkout — body `{ planId: 'starter' | 'pro' }`. */
export async function handleBillingCheckout(
  db: DbClient,
  auth: AuthContext,
  rawBody?: string,
): Promise<RestResult> {
  const stripe = stripeClient();
  if (!stripe || !billingConfigured()) {
    return jsonResponse(503, {
      error: 'billing_not_configured',
      message: 'Stripe Checkout is not configured yet.',
    });
  }

  const { planId } = parseCheckoutBody(rawBody);
  const priceId = priceIdForPlan(planId);
  if (!priceId) {
    return jsonResponse(503, {
      error: 'price_not_configured',
      message: `Stripe Price for ${planDefinition(planId).name} is not configured.`,
      planId,
    });
  }

  const current = await getEntitlementRow(db, auth.ownerId);
  if (current.plan === planId) {
    return jsonResponse(409, {
      error: 'already_on_plan',
      message: `You are already on ${planDefinition(planId).name}. Use Manage billing to change payment methods.`,
      planId,
    });
  }

  const customerId = await ensureStripeCustomer(
    db,
    stripe,
    auth.ownerId,
    current.stripeCustomerId,
  );

  const existingSub = await findActiveSubscription(stripe, customerId);
  if (existingSub) {
    // In-place price swap for upgrades / downgrades (no second subscription).
    const item = existingSub.items.data[0];
    if (!item) {
      return jsonResponse(500, { error: 'subscription_item_missing' });
    }
    await stripe.subscriptions.update(existingSub.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'create_prorations',
      metadata: {
        owner_id: auth.ownerId,
        plan_id: planId,
      },
    });
    await applySubscriptionPlan(db, auth.ownerId, planId, customerId);
    return jsonResponse(200, {
      ok: true,
      changed: true,
      planId,
      url: `${webAppUrl()}/app/settings?billing=success`,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${webAppUrl()}/app/settings?billing=success`,
    cancel_url: `${webAppUrl()}/app/settings?billing=cancel`,
    client_reference_id: auth.ownerId,
    metadata: { owner_id: auth.ownerId, plan_id: planId },
    subscription_data: {
      metadata: { owner_id: auth.ownerId, plan_id: planId },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    return jsonResponse(500, { error: 'checkout_url_missing' });
  }
  return jsonResponse(200, { url: session.url, sessionId: session.id, planId });
}

/** POST /billing/portal — Stripe Customer Portal (cancel / payment method). */
export async function handleBillingPortal(
  db: DbClient,
  auth: AuthContext,
): Promise<RestResult> {
  const stripe = stripeClient();
  if (!stripe) {
    return jsonResponse(503, { error: 'billing_not_configured' });
  }
  const row = await getEntitlementRow(db, auth.ownerId);
  if (!row.stripeCustomerId) {
    return jsonResponse(409, {
      error: 'no_stripe_customer',
      message: 'Subscribe first, then manage billing here.',
    });
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${webAppUrl()}/app/settings`,
  });
  return jsonResponse(200, { url: session.url });
}

/** GET /billing/status — current plan + public catalog + checkout readiness. */
export async function handleBillingStatus(
  db: DbClient,
  auth: AuthContext,
): Promise<RestResult> {
  const row = await getEntitlementRow(db, auth.ownerId);
  const def = planDefinition(row.plan);
  const catalog = publicPlanCatalog({
    starterPriceConfigured: Boolean(priceIdStarter()),
    proPriceConfigured: Boolean(priceIdPro()),
  });
  return jsonResponse(200, {
    plan: row.plan,
    planName: def.name,
    priceLabel: def.priceLabel,
    monthlyCredits: def.monthlyCredits,
    features: def.features,
    stripeCustomerId: row.stripeCustomerId ? 'set' : null,
    checkoutEnabled: billingConfigured(),
    catalog,
    upgrades: catalog.filter(
      (p) => p.paid && isUpgrade(row.plan, p.id) && p.checkoutAvailable,
    ),
  });
}

function ownerIdFromStripeObject(obj: {
  metadata?: Stripe.Metadata | null;
  client_reference_id?: string | null;
}): string | null {
  const fromMeta = obj.metadata?.owner_id?.trim();
  if (fromMeta) return fromMeta;
  const fromRef = obj.client_reference_id?.trim();
  if (fromRef) return fromRef;
  return null;
}

async function resolveOwnerId(
  db: DbClient,
  stripe: Stripe,
  opts: {
    ownerId?: string | null;
    customerId?: string | null;
  },
): Promise<{ ownerId: string; customerId: string | null } | null> {
  if (opts.ownerId) {
    return { ownerId: opts.ownerId, customerId: opts.customerId ?? null };
  }
  if (opts.customerId) {
    const { rows } = await db.query<{ owner_id: string }>(
      `SELECT owner_id FROM entitlements WHERE stripe_customer_id = $1`,
      [opts.customerId],
    );
    if (rows[0]) {
      return { ownerId: rows[0].owner_id, customerId: opts.customerId };
    }
    try {
      const customer = await stripe.customers.retrieve(opts.customerId);
      if (!customer.deleted) {
        const oid = customer.metadata?.owner_id?.trim();
        if (oid) return { ownerId: oid, customerId: opts.customerId };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function subscriptionActive(status: Stripe.Subscription.Status): boolean {
  return status === 'active' || status === 'trialing';
}

function planFromSubscription(sub: Stripe.Subscription): PlanId {
  const fromMeta = sub.metadata?.plan_id;
  if (fromMeta === 'starter' || fromMeta === 'pro') return fromMeta;
  const priceId = sub.items.data[0]?.price?.id;
  return planFromPriceId(priceId) ?? 'pro';
}

/**
 * POST /webhooks/stripe — signature-verified entitlement sync.
 * Must receive the raw body string (not re-serialized JSON).
 *
 * Subscribe in Stripe Dashboard to:
 *   checkout.session.completed
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_failed
 *   customer.deleted
 */
export async function handleStripeWebhook(
  db: DbClient,
  rawBody: string,
  signature: string | undefined,
): Promise<RestResult> {
  const stripe = stripeClient();
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (!stripe || !secret) {
    return jsonResponse(503, { error: 'billing_not_configured' });
  }
  if (!signature) {
    return jsonResponse(400, { error: 'missing_signature' });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return jsonResponse(400, {
      error: 'invalid_signature',
      message: err instanceof Error ? err.message : 'verify failed',
    });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id ?? null;
        const resolved = await resolveOwnerId(db, stripe, {
          ownerId: ownerIdFromStripeObject(session),
          customerId,
        });
        if (!resolved) break;

        let plan: PlanId = normalizePlan(session.metadata?.plan_id);
        if (plan === 'free' && session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          plan = planFromSubscription(sub);
        }
        if (plan === 'free') plan = 'pro';
        await applySubscriptionPlan(
          db,
          resolved.ownerId,
          plan,
          customerId ?? resolved.customerId,
        );
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const resolved = await resolveOwnerId(db, stripe, {
          ownerId: ownerIdFromStripeObject(sub),
          customerId,
        });
        if (!resolved) break;
        const plan: PlanId = subscriptionActive(sub.status)
          ? planFromSubscription(sub)
          : 'free';
        await applySubscriptionPlan(db, resolved.ownerId, plan, customerId);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const resolved = await resolveOwnerId(db, stripe, {
          ownerId: ownerIdFromStripeObject(sub),
          customerId,
        });
        if (resolved) {
          await applySubscriptionPlan(db, resolved.ownerId, 'free', customerId);
        }
        break;
      }
      case 'invoice.payment_failed': {
        // Dunning: revoke paid entitlements until payment succeeds again.
        // Restoration happens via customer.subscription.updated (active/trialing).
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id ?? null;
        if (!customerId) break;
        const resolved = await resolveOwnerId(db, stripe, { customerId });
        if (!resolved) break;
        await applySubscriptionPlan(db, resolved.ownerId, 'free', customerId);
        break;
      }
      case 'customer.deleted': {
        // Portal / account-erase / Stripe-side customer removal — drop local link.
        const customer = event.data.object as Stripe.Customer | Stripe.DeletedCustomer;
        const customerId = customer.id;
        const { rows } = await db.query<{ owner_id: string }>(
          `SELECT owner_id FROM entitlements WHERE stripe_customer_id = $1`,
          [customerId],
        );
        const ownerId = rows[0]?.owner_id;
        if (!ownerId) break;
        await applySubscriptionPlan(db, ownerId, 'free', null);
        await db.query(
          `UPDATE entitlements
           SET stripe_customer_id = NULL, plan = 'free', updated_at = now()
           WHERE owner_id = $1`,
          [ownerId],
        );
        break;
      }
      default:
        break;
    }
  } catch (err) {
    return jsonResponse(500, {
      error: 'webhook_handler_failed',
      message: err instanceof Error ? err.message : 'handler error',
    });
  }

  return jsonResponse(200, { received: true, type: event.type });
}
