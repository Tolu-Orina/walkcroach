/**
 * Stripe Billing — Checkout + Customer Portal + webhooks (Phase G1–G2).
 *
 * Profitability posture (web plan §7):
 * - Paid ≈ $20/mo subscription (STRIPE_PRICE_ID_PAID)
 * - Hard caps still bind Reel/Canvas dollar burn
 * - Paid monthly credit grant is finite (default 500) so one video (270) +
 *   limited creatives fit; uncapped grants are not offered
 */
import Stripe from 'stripe';
import type { DbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import {
  applySubscriptionPlan,
  getEntitlementRow,
  type Entitlement,
} from './billing.js';

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

function priceIdPaid(): string {
  return (process.env.STRIPE_PRICE_ID_PAID ?? '').trim();
}

function webAppUrl(): string {
  return (process.env.WEB_APP_URL ?? '').replace(/\/$/, '') || 'http://localhost:5173';
}

function billingConfigured(): boolean {
  return Boolean(stripeClient() && priceIdPaid());
}

/** POST /billing/checkout — start Paid subscription Checkout. */
export async function handleBillingCheckout(
  db: DbClient,
  auth: AuthContext,
): Promise<RestResult> {
  const stripe = stripeClient();
  const priceId = priceIdPaid();
  if (!stripe || !priceId) {
    return jsonResponse(503, {
      error: 'billing_not_configured',
      message: 'Stripe Checkout is not configured yet.',
    });
  }

  const plan = await getEntitlementRow(db, auth.ownerId);
  if (plan.plan === 'paid') {
    return jsonResponse(409, {
      error: 'already_paid',
      message: 'You are already on the Paid plan. Use Manage billing instead.',
    });
  }

  let customerId = plan.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { owner_id: auth.ownerId },
    });
    customerId = customer.id;
    await applySubscriptionPlan(db, auth.ownerId, 'free', customerId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${webAppUrl()}/app/settings?billing=success`,
    cancel_url: `${webAppUrl()}/app/settings?billing=cancel`,
    client_reference_id: auth.ownerId,
    metadata: { owner_id: auth.ownerId },
    subscription_data: {
      metadata: { owner_id: auth.ownerId },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    return jsonResponse(500, { error: 'checkout_url_missing' });
  }
  return jsonResponse(200, { url: session.url, sessionId: session.id });
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

/** GET /billing/status — plan + whether Checkout is live. */
export async function handleBillingStatus(
  db: DbClient,
  auth: AuthContext,
): Promise<RestResult> {
  const row = await getEntitlementRow(db, auth.ownerId);
  return jsonResponse(200, {
    plan: row.plan,
    stripeCustomerId: row.stripeCustomerId ? 'set' : null,
    checkoutEnabled: billingConfigured(),
    priceLabel: '~$20/mo',
  });
}

function ownerIdFromStripeObject(obj: {
  metadata?: Stripe.Metadata | null;
  client_reference_id?: string | null;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
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

function subscriptionIsPaid(status: Stripe.Subscription.Status): boolean {
  return status === 'active' || status === 'trialing';
}

/**
 * POST /webhooks/stripe — signature-verified entitlement sync.
 * Must receive the raw body string (not re-serialized JSON).
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
        if (resolved) {
          await applySubscriptionPlan(
            db,
            resolved.ownerId,
            'paid',
            customerId ?? resolved.customerId,
          );
        }
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
        if (resolved) {
          const plan: Entitlement = subscriptionIsPaid(sub.status)
            ? 'paid'
            : 'free';
          await applySubscriptionPlan(
            db,
            resolved.ownerId,
            plan,
            customerId,
          );
        }
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
          await applySubscriptionPlan(
            db,
            resolved.ownerId,
            'free',
            customerId,
          );
        }
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
