-- WalkCroach IDE Phase C: link local repos to Web projects (FR-D26, FR-D28).
-- Additive only. Memory continues to live in memory_entries with source_surface='ide'.

CREATE TABLE IF NOT EXISTS ide_project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id),
  -- Stable local identity (prefer normalized git remote; else workspace folder hash)
  local_repo_key STRING NOT NULL,
  local_repo_display STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, local_repo_key)
);

CREATE INDEX IF NOT EXISTS ide_project_links_owner_id_idx
  ON ide_project_links (owner_id);

CREATE INDEX IF NOT EXISTS ide_project_links_project_id_idx
  ON ide_project_links (project_id);
