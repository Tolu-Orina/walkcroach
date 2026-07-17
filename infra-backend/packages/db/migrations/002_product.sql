-- WalkCroach Phase 1 product schema extensions
-- Apply with: npm run migrate -w @walkcroach/db

ALTER TABLE projects ADD COLUMN IF NOT EXISTS status STRING NOT NULL DEFAULT 'draft';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_id STRING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS memory_summary STRING;

CREATE INDEX IF NOT EXISTS projects_owner_updated_idx
  ON projects (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;
