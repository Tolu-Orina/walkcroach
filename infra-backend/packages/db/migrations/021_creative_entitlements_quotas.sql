-- Web Modules Phase A — creative entitlements + rolling hard quotas
-- Grounding: docs/walkcroach-web-modules-imp-plan.md §4.4, §7, Phase A
--
-- Two separate controls, by design:
--   1) entitlements — WHO may call expensive creative models at all (paid gate)
--   2) usage_counters — even paid owners are hard-capped on rolling windows
--      (3 images / 24h; 1 video / 72h). Credits alone are insufficient control
--      because Nova Reel burns dollars per second regardless of credit price.
--
-- Both are CockroachDB tables — no new store, per the cross-cutting principle.

CREATE TABLE IF NOT EXISTS entitlements (
  owner_id STRING PRIMARY KEY,
  -- 'free' | 'paid'. Other lanes ('admin') reserved for later.
  plan STRING NOT NULL DEFAULT 'free',
  -- Optional bookkeeping once Stripe lands (Phase G); not required to gate.
  stripe_customer_id STRING,
  plan_started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rolling-window counters keyed by counter name.
--   counter_key 'image_gen_daily' → reset after interval '24 hours' since window_start
--   counter_key 'video_gen_3day'  → reset after interval '72 hours' since window_start
-- Windows roll continuously (per-owner), not calendar-aligned — same rolling
-- pattern Adobe Firefly uses for daily caps.
CREATE TABLE IF NOT EXISTS usage_counters (
  owner_id STRING NOT NULL,
  counter_key STRING NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (owner_id, counter_key)
);

-- Limits live in code (see handlers/billing.ts) so they can ship without a
-- migration, but this table makes the caps auditable and update-safe under
-- concurrency via atomic conditional UPDATEs.
