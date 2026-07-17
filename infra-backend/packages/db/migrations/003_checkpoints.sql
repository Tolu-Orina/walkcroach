-- WalkCroach Phase 1 checkpoints + file index (Days 9–10)
-- Apply with: npm run migrate -w @walkcroach/db

CREATE TABLE IF NOT EXISTS checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  session_id UUID REFERENCES sessions(id),
  name STRING,
  summary STRING NOT NULL,
  storage_key STRING NOT NULL,
  parent_checkpoint_id UUID REFERENCES checkpoints(id),
  superseded_by UUID REFERENCES checkpoints(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkpoints_project_created_idx
  ON checkpoints (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_files (
  project_id UUID NOT NULL REFERENCES projects(id),
  path STRING NOT NULL,
  content_hash STRING NOT NULL,
  storage_key STRING NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path)
);

CREATE INDEX IF NOT EXISTS project_files_project_idx
  ON project_files (project_id);

-- Enable vector recall when C-SPANN is available on the cluster.
CREATE VECTOR INDEX IF NOT EXISTS memory_entries_embedding_idx
  ON memory_entries (embedding);
