/**
 * Unit tests for Stripe meter emit (P5.2) — no live Stripe calls.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  emitBillingMeterEvent,
  stripeMeterEventName,
  DEFAULT_STRIPE_METER_EVENT_NAME,
} from './stripe-meter.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('stripe meter (P5.2)', () => {
  it('defaults event name', () => {
    expect(stripeMeterEventName({})).toBe(DEFAULT_STRIPE_METER_EVENT_NAME);
    expect(
      stripeMeterEventName({ STRIPE_METER_EVENT_NAME: 'custom_meter' }),
    ).toBe('custom_meter');
  });

  it('posts form body with ledger id as identifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await emitBillingMeterEvent({
      secretKey: 'sk_test',
      eventName: 'walkcroach_credits',
      stripeCustomerId: 'cus_123',
      value: 2,
      identifier: '11111111-1111-4111-8111-111111111111',
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.stripe.com/v1/billing/meter_events');
    expect(init.headers.authorization).toBe('Bearer sk_test');
    const body = String(init.body);
    expect(body).toContain('event_name=walkcroach_credits');
    expect(body).toContain('payload%5Bstripe_customer_id%5D=cus_123');
    expect(body).toContain('payload%5Bvalue%5D=2');
    expect(body).toContain('identifier=11111111-1111-4111-8111-111111111111');
  });

  it('skips zero value', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      emitBillingMeterEvent({
        secretKey: 'sk',
        eventName: 'x',
        stripeCustomerId: 'cus',
        value: 0,
        identifier: 'id',
      }),
    ).resolves.toMatchObject({ ok: true, skipped: 'zero_value' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
