/**
 * Stripe Billing Meter Events (Phase P5.2).
 *
 * Ledger remains the source of truth. Meter events are best-effort and
 * asynchronous: debit succeeds even if Stripe is down. Idempotency uses the
 * usage_ledger row id as `identifier` (Stripe dedupes ~24h).
 *
 * Uses form-encoded fetch so `@walkcroach/ledger` does not take a Stripe SDK
 * dependency (agent Lambda already pins its own Stripe version).
 */
import type { DbClient } from '@walkcroach/db';

/** Default meter event_name — must match the meter configured in Stripe Dashboard. */
export const DEFAULT_STRIPE_METER_EVENT_NAME = 'walkcroach_credits';

export type MeterEmitResult =
  | { ok: true; skipped?: string }
  | { ok: false; error: string };

export function stripeMeterConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean((env.STRIPE_SECRET_KEY ?? '').trim());
}

export function stripeMeterEventName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    (env.STRIPE_METER_EVENT_NAME ?? '').trim() || DEFAULT_STRIPE_METER_EVENT_NAME
  );
}

/**
 * POST /v1/billing/meter_events — fire-and-forget from debit paths.
 */
export async function emitBillingMeterEvent(params: {
  secretKey: string;
  eventName: string;
  stripeCustomerId: string;
  value: number;
  /** usage_ledger.id — idempotent across retries */
  identifier: string;
}): Promise<MeterEmitResult> {
  if (params.value <= 0) return { ok: true, skipped: 'zero_value' };
  const body = new URLSearchParams();
  body.set('event_name', params.eventName);
  body.set('payload[stripe_customer_id]', params.stripeCustomerId);
  body.set('payload[value]', String(params.value));
  body.set('identifier', params.identifier.slice(0, 100));

  const res = await fetch('https://api.stripe.com/v1/billing/meter_events', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      error: `stripe meter ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  return { ok: true };
}

/**
 * After a successful debit: if the owner has a Stripe customer and metering is
 * configured, emit a meter event. Never throws.
 */
export async function maybeEmitMeterForDebit(
  db: DbClient,
  ownerId: string,
  debit: { ledgerId: string | null; credits: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<MeterEmitResult> {
  if (!debit.ledgerId || debit.credits <= 0) {
    return { ok: true, skipped: 'no_ledger' };
  }
  const secret = (env.STRIPE_SECRET_KEY ?? '').trim();
  if (!secret) return { ok: true, skipped: 'no_stripe_key' };

  const { rows } = await db.query<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id FROM entitlements WHERE owner_id = $1`,
    [ownerId],
  );
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) return { ok: true, skipped: 'no_customer' };

  try {
    return await emitBillingMeterEvent({
      secretKey: secret,
      eventName: stripeMeterEventName(env),
      stripeCustomerId: customerId,
      value: debit.credits,
      identifier: debit.ledgerId,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
