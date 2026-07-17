-- WalkCroach Phase 3 — deploy, GitHub, billing
-- Apply with: npm run migrate -w @walkcroach/db

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deploy_slug STRING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo STRING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stripe_customer_id STRING;

CREATE INDEX IF NOT EXISTS projects_deploy_slug_idx ON projects (deploy_slug);

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS build_id STRING;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS error_message STRING;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS live_prefix STRING;

CREATE INDEX IF NOT EXISTS deployments_project_id_idx
  ON deployments (project_id, deployed_at DESC);

CREATE TABLE IF NOT EXISTS credit_balances (
  owner_id STRING PRIMARY KEY,
  monthly_credits INT NOT NULL DEFAULT 100,
  used_this_month INT NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
