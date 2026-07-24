-- Phase F follow-up: first-class tool_invocations audit (§7)
-- Dual-written alongside build_events from appendBuildEvent.
-- Apply with: npm run migrate -w @walkcroach/db

CREATE TABLE IF NOT EXISTS tool_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  tool_name STRING NOT NULL,
  tool_args JSONB NOT NULL DEFAULT '{}',
  result_summary STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_invocations_session_id_idx
  ON tool_invocations (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tool_invocations_project_id_idx
  ON tool_invocations (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
