import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getEntitlement,
  setEntitlement,
  consumeHardQuota,
  peekHardQuota,
  HARD_QUOTAS,
  CREDIT_COSTS,
} from './handlers/billing.js';
import type { DbClient } from '@walkcroach/db';

type Row = Record<string, unknown>;

function fakeDb(initial?: { plan?: string; count?: number; windowAge?: 'fresh' | 'expired' }) {
  const state = {
    plan: initial?.plan,
    count: initial?.count ?? 0,
    windowAge: initial?.windowAge ?? 'fresh',
  };
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // entitlements select
      if (/FROM entitlements/.test(sql)) {
        return { rows: state.plan ? [{ plan: state.plan }] : [] };
      }
      if (/INSERT INTO entitlements/.test(sql)) {
        state.plan = String(params?.[1]);
        return { rows: [] };
      }
      // usage_counters insert-if-absent
      if (/INSERT INTO usage_counters/.test(sql)) {
        return { rows: [] };
      }
      // usage_counters atomic update
      if (/UPDATE usage_counters/.test(sql)) {
        const limit = Number(params?.[2]);
        const expired = state.windowAge === 'expired';
        if (!expired && state.count >= limit) return { rows: [] };
        state.count = expired ? 1 : state.count + 1;
        state.windowAge = 'fresh';
        return {
          rows: [
            {
              count: state.count,
              reset_at: new Date(Date.now() + 24 * 3600 * 1000),
            },
          ],
        };
      }
      // peek select
      if (/FROM usage_counters/.test(sql) && /SELECT/.test(sql)) {
        const expired = state.windowAge === 'expired';
        return {
          rows: [
            {
              count: expired ? 0 : state.count,
              reset_at: new Date(Date.now() + 24 * 3600 * 1000),
            },
          ],
        };
      }
      return { rows: [] as Row[] };
    }),
    close: vi.fn(async () => {}),
  } as unknown as DbClient;
  return { db, state };
}

describe('creative entitlements + hard quotas (Phase A)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('extends CREDIT_COSTS with generate_image and render_pptx', () => {
    expect(CREDIT_COSTS.generate_image).toBe(5);
    expect(CREDIT_COSTS.render_pptx).toBe(20);
  });

  it('defaults missing entitlement row to free', async () => {
    const { db } = fakeDb();
    expect(await getEntitlement(db, 'u1')).toBe('free');
  });

  it('reads and sets paid plan', async () => {
    const { db } = fakeDb();
    await setEntitlement(db, 'u1', 'paid');
    expect(await getEntitlement(db, 'u1')).toBe('paid');
  });

  it('hard cap: allows up to the limit, then blocks', async () => {
    const { db } = fakeDb({ count: 0 });
    const limit = HARD_QUOTAS.image_gen_daily.limit;
    for (let i = 0; i < limit; i++) {
      const r = await consumeHardQuota(db, 'u1', 'image_gen_daily');
      expect(r.ok).toBe(true);
    }
    const blocked = await consumeHardQuota(db, 'u1', 'image_gen_daily');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.limit).toBe(limit);
  });

  it('hard cap rolls after the window expires', async () => {
    const { db, state } = fakeDb({ count: 3 });
    state.windowAge = 'expired';
    const r = await consumeHardQuota(db, 'u1', 'image_gen_daily');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.used).toBe(1);
  });

  it('peek does not consume', async () => {
    const { db, state } = fakeDb({ count: 1 });
    const a = await peekHardQuota(db, 'u1', 'image_gen_daily');
    const b = await peekHardQuota(db, 'u1', 'image_gen_daily');
    expect(a.remaining).toBe(HARD_QUOTAS.image_gen_daily.limit - 1);
    expect(b.remaining).toBe(a.remaining);
    expect(state.count).toBe(1);
  });
});
