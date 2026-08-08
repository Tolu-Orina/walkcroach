import { describe, expect, it } from 'vitest';
import {
  FREE_MONTHLY_CREDITS,
  STARTER_MONTHLY_CREDITS,
  PRO_MONTHLY_CREDITS,
  grantForPlan,
  hasConnectorWriteAccess,
  hasCreativesAccess,
  hasVideoAccess,
  isPaidPlan,
  isUpgrade,
  normalizePlan,
  planRank,
  publicPlanCatalog,
} from './plans.js';

describe('subscription plan catalog', () => {
  it('normalizes legacy paid to pro', () => {
    expect(normalizePlan('paid')).toBe('pro');
    expect(normalizePlan('Pro')).toBe('pro');
    expect(normalizePlan('starter')).toBe('starter');
    expect(normalizePlan(undefined)).toBe('free');
    expect(normalizePlan('unknown')).toBe('free');
  });

  it('orders free < starter < pro', () => {
    expect(planRank('free')).toBeLessThan(planRank('starter'));
    expect(planRank('starter')).toBeLessThan(planRank('pro'));
    expect(isUpgrade('free', 'starter')).toBe(true);
    expect(isUpgrade('starter', 'pro')).toBe(true);
    expect(isUpgrade('pro', 'starter')).toBe(false);
  });

  it('gates features by tier', () => {
    expect(hasCreativesAccess('free')).toBe(false);
    expect(hasCreativesAccess('starter')).toBe(true);
    expect(hasVideoAccess('starter')).toBe(false);
    expect(hasVideoAccess('pro')).toBe(true);
    expect(hasVideoAccess('paid')).toBe(true);
    expect(hasConnectorWriteAccess('free')).toBe(false);
    expect(hasConnectorWriteAccess('starter')).toBe(true);
    expect(isPaidPlan('starter')).toBe(true);
    expect(isPaidPlan('free')).toBe(false);
  });

  it('grants match catalog defaults', () => {
    expect(grantForPlan('free')).toBe(FREE_MONTHLY_CREDITS);
    expect(grantForPlan('starter')).toBe(STARTER_MONTHLY_CREDITS);
    expect(grantForPlan('pro')).toBe(PRO_MONTHLY_CREDITS);
    expect(grantForPlan('paid')).toBe(PRO_MONTHLY_CREDITS);
    expect(STARTER_MONTHLY_CREDITS).toBe(250);
    expect(PRO_MONTHLY_CREDITS).toBe(500);
  });

  it('public catalog marks checkout availability per price', () => {
    const catalog = publicPlanCatalog({
      starterPriceConfigured: true,
      proPriceConfigured: false,
    });
    expect(catalog.map((c) => c.id)).toEqual(['free', 'starter', 'pro']);
    expect(catalog.find((c) => c.id === 'starter')?.checkoutAvailable).toBe(
      true,
    );
    expect(catalog.find((c) => c.id === 'pro')?.checkoutAvailable).toBe(false);
    expect(catalog.find((c) => c.id === 'free')?.checkoutAvailable).toBe(false);
  });
});
