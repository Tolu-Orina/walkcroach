/**
 * Phase H1 — concurrent hard-quota + debit race tests.
 *
 * Simulates serialized SQL under parallel Promise.all the way Postgres
 * row locks would: at most `limit` consumes succeed; extras get ok:false.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  consumeHardQuota,
  HARD_QUOTAS,
  CREDIT_COSTS,
} from './handlers/billing.js';
import { debitCredits } from '@walkcroach/ledger';
import type { DbClient } from '@walkcroach/db';

function serializingQuotaDb(limit = HARD_QUOTAS.image_gen_daily.limit) {
  const state = { count: 0 };
  let chain: Promise<unknown> = Promise.resolve();

  const runExclusive = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) =>
      runExclusive(async () => {
        // Tiny yield so concurrent callers interleave before the lock runs.
        await new Promise((r) => setTimeout(r, 1));
        if (/INSERT INTO usage_counters/.test(sql)) {
          return { rows: [] };
        }
        if (/UPDATE usage_counters/.test(sql)) {
          const amount = Number(params?.[3] ?? 1);
          if (state.count + amount > limit) return { rows: [] };
          state.count += amount;
          return {
            rows: [
              {
                count: state.count,
                reset_at: new Date(Date.now() + 24 * 3600 * 1000),
              },
            ],
          };
        }
        if (/FROM usage_counters/.test(sql) && /SELECT/.test(sql)) {
          return {
            rows: [
              {
                count: state.count,
                reset_at: new Date(Date.now() + 24 * 3600 * 1000),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    ),
    close: vi.fn(async () => {}),
  } as unknown as DbClient;

  return { db, state };
}

function serializingDebitDb(monthly = 500) {
  const state = { used: 0, monthly };
  let chain: Promise<unknown> = Promise.resolve();

  const runExclusive = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const balanceRow = () => ({
    owner_id: 'owner-debit',
    monthly_credits: state.monthly,
    used_this_month: state.used,
    period_start: new Date(),
  });

  const query = vi.fn(async (sql: string, params?: unknown[]) =>
      runExclusive(async () => {
        await new Promise((r) => setTimeout(r, 1));
        if (/INSERT INTO credit_balances/.test(sql)) {
          return { rows: [] };
        }
        if (/UPDATE credit_balances/.test(sql) && /used_this_month = 0/.test(sql)) {
          state.used = 0;
          return { rows: [] };
        }
        if (/UPDATE credit_balances/.test(sql) && /used_this_month/.test(sql)) {
          const cost = Number(params?.[1] ?? 0);
          const remaining = state.monthly - state.used;
          if (remaining < cost) return { rows: [] };
          state.used += cost;
          return {
            rows: [
              {
                monthly_credits: state.monthly,
                used_this_month: state.used,
              },
            ],
          };
        }
        if (/INSERT INTO usage_ledger/.test(sql)) {
          return { rows: [] };
        }
        if (/FROM entitlements/.test(sql)) {
          return { rows: [{ plan: 'paid' }] };
        }
        if (/FROM credit_balances/.test(sql)) {
          return { rows: [balanceRow()] };
        }
        return { rows: [] };
      }),
    );

  const db = {
    query,
    // Statements inside a transaction still go through the same serializing
    // `query`, so the conditional UPDATE remains the atomic gate this test
    // exercises — withTransaction only groups it with the usage_ledger INSERT.
    withTransaction: vi.fn(
      async (fn: (tx: { query: typeof query }) => unknown) => fn({ query }),
    ),
    close: vi.fn(async () => {}),
  } as unknown as DbClient;

  return { db, state };
}

describe('Phase H1 — quota/debit load under concurrency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exactly 3 of 12 concurrent image consumes succeed', async () => {
    const { db, state } = serializingQuotaDb(3);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumeHardQuota(db, 'owner-race', 'image_gen_daily'),
      ),
    );
    const ok = results.filter((r) => r.ok);
    const denied = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(3);
    expect(denied).toHaveLength(9);
    expect(state.count).toBe(3);
  });

  it('atomic multi-slot consume (deck) cannot overshoot the daily cap', async () => {
    const { db, state } = serializingQuotaDb(3);
    const first = await consumeHardQuota(db, 'u', 'image_gen_daily', 2);
    expect(first.ok).toBe(true);
    const second = await consumeHardQuota(db, 'u', 'image_gen_daily', 2);
    expect(second.ok).toBe(false);
    expect(state.count).toBe(2);
    const third = await consumeHardQuota(db, 'u', 'image_gen_daily', 1);
    expect(third.ok).toBe(true);
    expect(state.count).toBe(3);
  });

  it('amount greater than limit is rejected without mutating', async () => {
    const { db, state } = serializingQuotaDb(3);
    const r = await consumeHardQuota(db, 'u', 'image_gen_daily', 99);
    expect(r.ok).toBe(false);
    expect(state.count).toBe(0);
  });

  it('concurrent generate_image debits never overspend the monthly pool', async () => {
    const cost = CREDIT_COSTS.generate_image;
    // 7 credits → at most one generate_image (5) succeeds; second fails.
    const { db, state } = serializingDebitDb(7);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        debitCredits(db, 'owner-debit', 'generate_image', undefined, {
          load: true,
        }),
      ),
    );
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    expect(state.used).toBe(cost);
  });
});
