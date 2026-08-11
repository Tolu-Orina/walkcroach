-- ADR-0004 Phase 1 follow-on — list filter index for kind=knowledge|app
-- Separated from 042 so kind CHECK can land without waiting on index build.

CREATE INDEX IF NOT EXISTS projects_owner_kind_updated_idx
  ON projects (owner_id, kind, updated_at DESC)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
