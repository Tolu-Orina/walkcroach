-- WalkCroach Phase 2 — generated-app resources + usage ledger stub
-- Apply with: npm run migrate -w @walkcroach/db

CREATE TABLE IF NOT EXISTS project_app_resources (
  project_id UUID PRIMARY KEY REFERENCES projects(id),
  app_database_name STRING NOT NULL,
  secrets_prefix STRING NOT NULL,
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  project_id UUID REFERENCES projects(id),
  action_type STRING NOT NULL,
  credits INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_ledger_owner_day_idx
  ON usage_ledger (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_secret_keys (
  project_id UUID NOT NULL REFERENCES projects(id),
  key_name STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, key_name)
);
