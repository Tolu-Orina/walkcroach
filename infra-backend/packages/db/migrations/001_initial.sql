-- WalkCroach Phase 0 schema
-- CockroachDB Cloud — apply with: npm run migrate -w @walkcroach/db

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  name STRING NOT NULL,
  surface_origin STRING NOT NULL DEFAULT 'web',
  stack_config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  surface STRING NOT NULL DEFAULT 'web',
  model_config JSONB NOT NULL DEFAULT '{}',
  pending_tool JSONB NULL,
  status STRING NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id),
  role STRING NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  source_surface STRING NOT NULL,
  kind STRING NOT NULL,
  text STRING NOT NULL,
  embedding VECTOR(1024),
  superseded_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vector index: enable after confirming VECTOR + C-SPANN availability on your cluster.
-- CREATE VECTOR INDEX IF NOT EXISTS memory_entries_embedding_idx ON memory_entries (embedding);

CREATE TABLE IF NOT EXISTS build_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id),
  surface STRING NOT NULL DEFAULT 'web',
  tool_name STRING NOT NULL,
  tool_args JSONB NOT NULL DEFAULT '{}',
  result_summary STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_locks (
  project_id UUID NOT NULL,
  resource_path STRING NOT NULL,
  held_by_session_id UUID NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, resource_path)
);

CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  target STRING NOT NULL,
  url STRING,
  status STRING NOT NULL,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS page_captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  url STRING NOT NULL,
  title STRING,
  extracted_text STRING,
  screenshot_s3_key STRING,
  embedding VECTOR(1024),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions (project_id);
CREATE INDEX IF NOT EXISTS messages_session_id_idx ON messages (session_id);
CREATE INDEX IF NOT EXISTS memory_entries_project_id_idx ON memory_entries (project_id);
CREATE INDEX IF NOT EXISTS build_events_session_id_idx ON build_events (session_id);
CREATE INDEX IF NOT EXISTS page_captures_project_id_idx ON page_captures (project_id);
