/**
 * WalkCroach subscription catalog — Free / Starter / Pro.
 *
 * Legacy DB value `paid` normalizes to `pro`. Feature gates use capabilities,
 * not string equality, so adding a fourth tier later does not rewrite every
 * creative/connector check.
 */
export type PlanId = 'free' | 'starter' | 'pro';

/** @deprecated Use PlanId — kept as alias while callers migrate. */
export type Entitlement = PlanId;

export type PlanFeatures = {
  /** Nova Canvas images, pptx, flyer creatives. */
  creatives: boolean;
  /** Nova Reel video studio. */
  video: boolean;
  /** Connector mutate actions (Gmail send, Calendar write, …). */
  connectorWrites: boolean;
};

export type PlanDefinition = {
  id: PlanId;
  name: string;
  /** Display price; Stripe Price object is the source of charge amount. */
  priceLabel: string;
  /** Suggested list price in USD cents (marketing / UI). */
  priceCents: number;
  /** Monthly credit grant ceiling. */
  monthlyCredits: number;
  features: PlanFeatures;
  /** Stripe Checkout / Portal — false for Free. */
  paid: boolean;
  blurb: string;
  highlights: string[];
};

export const FREE_MONTHLY_CREDITS = Number(process.env.FREE_MONTHLY_CREDITS ?? 100);
export const STARTER_MONTHLY_CREDITS = Number(
  process.env.STARTER_MONTHLY_CREDITS ?? 250,
);
/** Pro grant — was PAID_MONTHLY_CREDITS. */
export const PRO_MONTHLY_CREDITS = Number(
  process.env.PRO_MONTHLY_CREDITS ?? process.env.PAID_MONTHLY_CREDITS ?? 500,
);
/** @deprecated Prefer PRO_MONTHLY_CREDITS */
export const PAID_MONTHLY_CREDITS = PRO_MONTHLY_CREDITS;

export const PLAN_ORDER: readonly PlanId[] = ['free', 'starter', 'pro'];

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    priceLabel: '$0',
    priceCents: 0,
    monthlyCredits: FREE_MONTHLY_CREDITS,
    features: { creatives: false, video: false, connectorWrites: false },
    paid: false,
    blurb: 'Build and chat with a shared monthly credit pool.',
    highlights: [
      `${FREE_MONTHLY_CREDITS} credits / month`,
      'App Builder + Chat',
      'Memory across surfaces',
    ],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceLabel: '$12/mo',
    priceCents: 1200,
    monthlyCredits: STARTER_MONTHLY_CREDITS,
    features: { creatives: true, video: false, connectorWrites: true },
    paid: true,
    blurb: 'Creatives and connector writes for solo builders.',
    highlights: [
      `${STARTER_MONTHLY_CREDITS} credits / month`,
      'Images, decks, flyers (hard caps apply)',
      'Connector writes',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceLabel: '$20/mo',
    priceCents: 2000,
    monthlyCredits: PRO_MONTHLY_CREDITS,
    features: { creatives: true, video: true, connectorWrites: true },
    paid: true,
    blurb: 'Full studio — including video — with margin-safe hard caps.',
    highlights: [
      `${PRO_MONTHLY_CREDITS} credits / month`,
      'Everything in Starter',
      'Video studio (≤1 / 72h)',
    ],
  },
};

/** Map legacy and unknown plan strings to a catalog id. */
export function normalizePlan(raw: string | null | undefined): PlanId {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'starter') return 'starter';
  if (v === 'pro' || v === 'paid') return 'pro';
  return 'free';
}

export function planDefinition(plan: PlanId | string): PlanDefinition {
  return PLAN_CATALOG[normalizePlan(plan)];
}

export function grantForPlan(plan: PlanId | string): number {
  return planDefinition(plan).monthlyCredits;
}

export function planRank(plan: PlanId | string): number {
  return PLAN_ORDER.indexOf(normalizePlan(plan));
}

export function hasCreativesAccess(plan: PlanId | string): boolean {
  return planDefinition(plan).features.creatives;
}

export function hasVideoAccess(plan: PlanId | string): boolean {
  return planDefinition(plan).features.video;
}

export function hasConnectorWriteAccess(plan: PlanId | string): boolean {
  return planDefinition(plan).features.connectorWrites;
}

/** True when `candidate` is a strictly higher paid tier than `current`. */
export function isUpgrade(current: PlanId | string, candidate: PlanId | string): boolean {
  return planRank(candidate) > planRank(current);
}

export function isPaidPlan(plan: PlanId | string): boolean {
  return planDefinition(plan).paid;
}

export type PublicPlanCatalogItem = {
  id: PlanId;
  name: string;
  priceLabel: string;
  priceCents: number;
  monthlyCredits: number;
  features: PlanFeatures;
  paid: boolean;
  blurb: string;
  highlights: string[];
  /** Whether Checkout can start for this tier in this environment. */
  checkoutAvailable: boolean;
};

export function publicPlanCatalog(opts: {
  starterPriceConfigured: boolean;
  proPriceConfigured: boolean;
}): PublicPlanCatalogItem[] {
  return PLAN_ORDER.map((id) => {
    const def = PLAN_CATALOG[id];
    const checkoutAvailable =
      id === 'free'
        ? false
        : id === 'starter'
          ? opts.starterPriceConfigured
          : opts.proPriceConfigured;
    return {
      id: def.id,
      name: def.name,
      priceLabel: def.priceLabel,
      priceCents: def.priceCents,
      monthlyCredits: def.monthlyCredits,
      features: def.features,
      paid: def.paid,
      blurb: def.blurb,
      highlights: def.highlights,
      checkoutAvailable,
    };
  });
}
