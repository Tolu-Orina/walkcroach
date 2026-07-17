-- GitHub App installation OAuth (replaces PAT connect in prod)

ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_installation_id INT;

CREATE TABLE IF NOT EXISTS github_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  owner_id STRING NOT NULL,
  repo STRING NOT NULL,
  nonce STRING NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_oauth_states_nonce
  ON github_oauth_states (nonce);

CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expires
  ON github_oauth_states (expires_at);
