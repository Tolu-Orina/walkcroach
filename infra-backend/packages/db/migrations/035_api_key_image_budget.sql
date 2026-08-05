-- Per-API-key image generation budget.
--
-- Nova Canvas is reachable from the SDK by calling `generateCanvasImage` directly,
-- which is correct — the creative Lambda is a WalkCroach Web capability and an SDK
-- caller should not need it. But it also bypasses every control that exists today:
-- entitlement, the 3/24h hard quota, and the 5-credit debit all live in
-- `agent-harness/src/loop.ts` and are injected by the Web BFF (`consumeHardQuota`).
--
-- An SDK caller therefore has NO ceiling. One runaway loop bills the account owner
-- for thousands of Canvas invocations. This table is the ceiling.
--
-- Deliberately a rolling 24h counter rather than a credit ledger: this is a safety
-- rail against runaway automation, not a billing primitive. Billing stays in
-- `credit_ledger` where it already is, and conflating the two would put a spend
-- decision behind an abuse control.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS image_daily_limit INT NOT NULL DEFAULT 20;

CREATE TABLE IF NOT EXISTS api_key_image_usage (
  key_id       UUID NOT NULL,
  -- Truncated to the hour so the rolling window is a cheap sum over 24 rows
  -- rather than a row per image. A key generating thousands of images produces
  -- 24 rows, not thousands.
  hour_bucket  TIMESTAMPTZ NOT NULL,
  count        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, hour_bucket)
);

-- Reader: sum(count) WHERE key_id = $1 AND hour_bucket > now() - 24h.
-- key_id is the leading column, so that range scan is covered.
CREATE INDEX IF NOT EXISTS api_key_image_usage_window_idx
  ON api_key_image_usage (key_id, hour_bucket DESC);
