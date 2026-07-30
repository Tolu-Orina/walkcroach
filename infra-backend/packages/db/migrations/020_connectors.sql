-- Workflow connectors — cross-surface (master plan Part 1 §3.3, web modules plan §6.2)
--
-- Connectors are NOT a Chrome feature. Web Chat, the Chrome side panel, the IDE
-- and the CLI all propose and execute the same actions against the same
-- connected accounts, so this schema is deliberately surface-neutral: it is
-- owned by `owner_id`, not by a session or a project.
--
-- Reconciling the two plans:
--   * master §3.3 says "OAuth tokens NEVER stored in this table"; web §6.2 lists
--     `secret_ref`. Both hold — `secret_ref` is a Secrets Manager *name*, never a
--     token. It is spelled out below so nobody later mistakes it for one.
--   * web §6.2 gives workflow_runs an embedding (for CX-E / Chrome E8 recall);
--     master §3.3 omits it. Kept, because "what did we send last week" is a
--     stated deliverable on both roadmaps.
--   * master §3.3 has `session_id REFERENCES sessions(id)`. Chrome has no
--     `sessions` row — it works in workspaces — so that column must be nullable
--     and cannot be the ownership anchor. `owner_id` + `surface` are.

CREATE TABLE IF NOT EXISTS connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  provider STRING NOT NULL,          -- 'google_calendar' | 'gmail' | 'slack' | 'stripe' | ...
  status STRING NOT NULL,            -- 'connected' | 'revoked' | 'error'
  scopes STRING[] NOT NULL,
  -- Secrets Manager secret NAME holding the OAuth token set. Never a token, and
  -- never returned to any client: resolved server-side at execution only.
  secret_ref STRING NOT NULL,
  -- Display-only account hint ("alex@acme.com", "Acme Slack"), so the UI can
  -- name the connection without ever reading the credential.
  account_label STRING,
  last_error STRING,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One live connection per provider per owner. Re-connecting updates in place,
  -- so a re-auth cannot silently orphan the previous secret.
  UNIQUE (owner_id, provider)
);

CREATE INDEX IF NOT EXISTS connectors_owner_id_idx ON connectors (owner_id);

-- CSRF/replay state for the OAuth round trip, mirroring the existing
-- `github_oauth_states` precedent rather than inventing a second pattern.
CREATE TABLE IF NOT EXISTS connector_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  provider STRING NOT NULL,
  -- SHA-256 of the state value; the raw value only ever exists in the browser.
  state_hash STRING NOT NULL,
  -- PKCE verifier, required by Google and harmless elsewhere.
  code_verifier STRING,
  redirect_uri STRING NOT NULL,
  -- Which surface began the flow, so completion can route back correctly.
  surface STRING NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connector_oauth_states_hash_idx
  ON connector_oauth_states (state_hash);

CREATE INDEX IF NOT EXISTS connector_oauth_states_expires_idx
  ON connector_oauth_states (expires_at);

-- Every proposed action, whether or not it was ever confirmed.
--
-- Declined and failed rows are kept deliberately: "what did the agent try to do
-- on my behalf" is an audit question, and the never-delete/provenance rule
-- applies to actions as much as to captures.
CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  -- Null for surfaces without a chat session (Chrome side panel, CLI one-shots).
  session_id UUID REFERENCES sessions(id),
  connector_id UUID REFERENCES connectors(id),
  surface STRING NOT NULL,           -- 'web' | 'chrome' | 'ide' | 'cli'
  action STRING NOT NULL,            -- 'calendar.create_event' | 'gmail.send' | ...
  proposed_action JSONB NOT NULL,    -- exactly what was shown on the confirm card
  confirmed BOOL NOT NULL DEFAULT false,
  result JSONB,
  status STRING NOT NULL,            -- 'proposed'|'confirmed'|'executed'|'failed'|'declined'
  error STRING,
  embedding VECTOR(1024),            -- recall: "what did we send last week"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workflow_runs_owner_id_idx ON workflow_runs (owner_id);
CREATE INDEX IF NOT EXISTS workflow_runs_connector_id_idx ON workflow_runs (connector_id);
CREATE INDEX IF NOT EXISTS workflow_runs_owner_created_idx
  ON workflow_runs (owner_id, created_at DESC);
