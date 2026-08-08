import { describe, expect, it, vi, beforeEach } from 'vitest';

const applySubscriptionPlan = vi.fn(async () => {});
const getEntitlementRow = vi.fn(async () => ({
  plan: 'pro' as const,
  stripeCustomerId: 'cus_x',
}));

vi.mock('./billing.js', () => ({
  applySubscriptionPlan,
  getEntitlementRow,
}));

const constructEvent = vi.fn();
vi.mock('stripe', () => {
  class StripeMock {
    static create = vi.fn();
    webhooks = { constructEvent };
    constructor(_key: string, _opts?: unknown) {}
  }
  return { default: StripeMock };
});

const { handleStripeWebhook } = await import('./stripeBilling.js');

function fakeDb(ownerByCustomer: Record<string, string> = { cus_x: 'owner-1' }) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM entitlements WHERE stripe_customer_id/.test(sql)) {
        const cus = String(params?.[0] ?? '');
        const owner = ownerByCustomer[cus];
        return { rows: owner ? [{ owner_id: owner }] : [] };
      }
      if (/UPDATE entitlements/.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
  };
}

describe('Stripe webhook dunning + customer.deleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    process.env.STRIPE_PRICE_ID_PRO = 'price_pro';
  });

  it('invoice.payment_failed downgrades the owner to free', async () => {
    constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_x', id: 'in_1' } },
    });
    const db = fakeDb();
    const res = await handleStripeWebhook(db as never, '{}', 'sig');
    expect(res.statusCode).toBe(200);
    expect(applySubscriptionPlan).toHaveBeenCalledWith(
      db,
      'owner-1',
      'free',
      'cus_x',
    );
  });

  it('customer.deleted clears stripe_customer_id and sets free', async () => {
    constructEvent.mockReturnValue({
      type: 'customer.deleted',
      data: { object: { id: 'cus_x', deleted: true } },
    });
    const db = fakeDb();
    const res = await handleStripeWebhook(db as never, '{}', 'sig');
    expect(res.statusCode).toBe(200);
    expect(applySubscriptionPlan).toHaveBeenCalledWith(
      db,
      'owner-1',
      'free',
      null,
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/stripe_customer_id = NULL/),
      ['owner-1'],
    );
  });

  it('customer.deleted is a no-op when customer is unknown locally', async () => {
    constructEvent.mockReturnValue({
      type: 'customer.deleted',
      data: { object: { id: 'cus_unknown', deleted: true } },
    });
    const db = fakeDb({});
    const res = await handleStripeWebhook(db as never, '{}', 'sig');
    expect(res.statusCode).toBe(200);
    expect(applySubscriptionPlan).not.toHaveBeenCalled();
  });
});
