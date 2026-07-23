-- WalkCroach IDE: one-time OAuth-style authorization codes for Web → IDE handoff.
-- Industry pattern: never put access/refresh tokens in vscode:// redirect URIs.
-- Code is single-use, short-lived (≤5 minutes).

CREATE TABLE IF NOT EXISTS ide_auth_codes (
  code STRING PRIMARY KEY,
  state STRING NOT NULL,
  redirect_uri STRING NOT NULL,
  owner_id STRING NOT NULL,
  access_token STRING NOT NULL,
  refresh_token STRING,
  id_token STRING,
  token_expires_at TIMESTAMPTZ NOT NULL,
  code_expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ide_auth_codes_state_idx
  ON ide_auth_codes (state);

CREATE INDEX IF NOT EXISTS ide_auth_codes_expires_idx
  ON ide_auth_codes (code_expires_at);
