-- P0: durable E2B sandbox identity per project (survive Lambda / process restart)
-- Apply with: npm run migrate -w @walkcroach/db

ALTER TABLE projects ADD COLUMN IF NOT EXISTS e2b_sandbox_id STRING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS e2b_preview_url STRING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS e2b_sandbox_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS projects_e2b_sandbox_id_idx
  ON projects (e2b_sandbox_id)
  WHERE e2b_sandbox_id IS NOT NULL;
