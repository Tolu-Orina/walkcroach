-- Service-account API keys for @walkcroach/sdk and @walkcroach/sdk-mcp.
--
-- Until now every caller was a Cognito user: Web, Chrome, IDE and CLI all carry a
-- user token. An SDK running server-side has no user to sign in, so it needs a
-- credential of its own. These keys are that credential, and they are scoped to a
-- single owner — they grant no more reach than the user who minted them.
--
-- What is deliberately NOT here:
--   * no `key` column. The raw secret is returned once at creation and never
--     stored. A leaked database dump must not be a leaked set of credentials.
--   * no project scoping. Keys are owner-scoped and every memory route already
--     re-checks `project_id`/`owner_id` in SQL (see 032's reader contract), so a
--     per-project key would add a second, weaker place to get tenancy wrong.

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id     STRING NOT NULL,
  name         STRING NOT NULL,

  -- Lookup handle. Safe to display and to log: it identifies the key without
  -- being sufficient to use it. Format `wc_live_<10 chars>`.
  key_prefix   STRING NOT NULL,

  -- scrypt(secret, salt) with the salt stored alongside. NOT a bare SHA —
  -- these are credentials, so verification must be deliberately slow.
  key_hash     BYTES  NOT NULL,
  key_salt     BYTES  NOT NULL,

  -- Checked per route. `memory:write` does not imply `memory:read`.
  scopes       STRING[] NOT NULL DEFAULT ARRAY['memory:read'],

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- Verification path: look up by prefix, then scrypt-compare the remainder.
-- Partial on revoked_at so a revoked key stops being a candidate at the index
-- level rather than in application code.
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx
  ON api_keys (key_prefix)
  WHERE revoked_at IS NULL;

-- "List my keys" in account settings.
CREATE INDEX IF NOT EXISTS api_keys_owner_idx
  ON api_keys (owner_id, created_at DESC);
