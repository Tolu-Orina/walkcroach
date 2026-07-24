-- WalkCroach Web revamp Phase A — projects as knowledge + chats/artefacts
-- Apply with: npm run migrate -w @walkcroach/db

-- Project knowledge (Claude-style standing context)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description STRING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS instructions STRING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kind STRING NOT NULL DEFAULT 'app';

-- Documents attached to a project (retrieval corpus)
CREATE TABLE IF NOT EXISTS project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name STRING NOT NULL,
  mime STRING NOT NULL DEFAULT 'application/octet-stream',
  s3_key STRING NOT NULL,
  byte_size INT8 NOT NULL DEFAULT 0,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_documents_project_id_idx
  ON project_documents (project_id, created_at DESC);

-- Sessions generalized toward chats (dual-read with existing sessions)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title STRING;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode STRING NOT NULL DEFAULT 'builder';
-- General Chat may have no project; builder chats keep project_id set.
ALTER TABLE sessions ALTER COLUMN project_id DROP NOT NULL;

-- Code artefacts collected across chats / builder sync
CREATE TABLE IF NOT EXISTS code_artefacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id STRING NOT NULL,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  session_id UUID NULL REFERENCES sessions(id) ON DELETE SET NULL,
  path STRING NOT NULL,
  language STRING,
  content_hash STRING,
  s3_key STRING,
  content STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS code_artefacts_user_updated_idx
  ON code_artefacts (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS code_artefacts_project_id_idx
  ON code_artefacts (project_id)
  WHERE project_id IS NOT NULL;
