-- WalkCroach shared skills — user-scoped, cross-surface skill sync
-- Additive; does not rewrite 001_initial.sql (memory_entries) or 007_chrome_workspaces.sql
--
-- Skills are account-scoped, not project-scoped: a skill is a reusable recipe,
-- not tied to one project, so this mirrors workspaces' owner_id-only shape
-- rather than memory_entries' project_id-scoped shape.

CREATE TABLE IF NOT EXISTS shared_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  name STRING NOT NULL,
  description STRING NOT NULL,
  body STRING NOT NULL,
  source_surface STRING NOT NULL,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shared_skills_owner_name_unique UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS shared_skills_owner_id_idx ON shared_skills (owner_id);

-- Vector index left commented, matching memory_entries' own precedent (001_initial.sql) —
-- enable once cluster vector-index support is confirmed in this environment.
-- CREATE VECTOR INDEX IF NOT EXISTS shared_skills_embedding_idx ON shared_skills (embedding);
