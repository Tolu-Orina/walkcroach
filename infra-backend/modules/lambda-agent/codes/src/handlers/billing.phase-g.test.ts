import { describe, expect, it, vi } from 'vitest';
import {
  CREDIT_COSTS,
  FREE_MONTHLY_CREDITS,
  PAID_MONTHLY_CREDITS,
  applySubscriptionPlan,
  getEntitlement,
  getUsageSummary,
} from './billing.js';

describe('Phase G billing profitability', () => {
  it('keeps expensive actions weighted for margin', () => {
    expect(CREDIT_COSTS.start_video_job).toBe(270);
    expect(CREDIT_COSTS.generate_image).toBe(5);
    expect(CREDIT_COSTS.render_pptx).toBe(20);
    expect(CREDIT_COSTS.connector_write).toBe(2);
  });

  it('paid grant exceeds free but stays finite', () => {
    expect(FREE_MONTHLY_CREDITS).toBe(100);
    expect(PAID_MONTHLY_CREDITS).toBe(500);
    expect(PAID_MONTHLY_CREDITS).toBeGreaterThan(FREE_MONTHLY_CREDITS);
    // One video must fit; two videos must not on a fresh paid month.
    expect(PAID_MONTHLY_CREDITS).toBeGreaterThanOrEqual(
      CREDIT_COSTS.start_video_job,
    );
    expect(PAID_MONTHLY_CREDITS).toBeLessThan(
      CREDIT_COSTS.start_video_job * 2,
    );
  });

  it('applySubscriptionPlan upserts entitlement and grant', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('FROM entitlements')) {
          return { rows: [{ plan: 'pro', stripe_customer_id: 'cus_x' }] };
        }
        if (sql.includes('FROM credit_balances') && sql.includes('SELECT')) {
          return {
            rows: [
              {
                owner_id: 'o1',
                monthly_credits: PAID_MONTHLY_CREDITS,
                used_this_month: 0,
                period_start: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    await applySubscriptionPlan(db as never, 'o1', 'pro', 'cus_x');
    expect(calls.some((c) => c.sql.includes('INSERT INTO entitlements'))).toBe(
      true,
    );
    expect(
      calls.some(
        (c) =>
          c.sql.includes('UPDATE credit_balances') &&
          c.params?.[1] === PAID_MONTHLY_CREDITS,
      ),
    ).toBe(true);
    expect(await getEntitlement(db as never, 'o1')).toBe('pro');
    const usage = await getUsageSummary(db as never, 'o1');
    expect(usage.plan).toBe('pro');
    expect(usage.sharedPool).toBe(true);
  });

  it('legacy paid entitlement normalizes to pro', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM entitlements')) {
          return { rows: [{ plan: 'paid', stripe_customer_id: null }] };
        }
        return { rows: [] };
      }),
    };
    expect(await getEntitlement(db as never, 'o1')).toBe('pro');
  });
});
