-- WalkCroach Chrome Phase 0 — workspaces + page_captures extensions + device sessions
-- Additive; does not rewrite 001_initial.sql

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  name STRING NOT NULL,
  linked_project_id UUID NULL REFERENCES projects(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspaces_owner_id_idx ON workspaces (owner_id);

-- Chrome-only saves use workspace_id; project_id remains for Web-linked captures.
ALTER TABLE page_captures ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS owner_id STRING;
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS capture_type STRING NOT NULL DEFAULT 'general';
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS structured_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS content_hash STRING;
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES page_captures(id);

CREATE INDEX IF NOT EXISTS page_captures_workspace_id_idx ON page_captures (workspace_id);
CREATE INDEX IF NOT EXISTS page_captures_owner_id_idx ON page_captures (owner_id);
CREATE INDEX IF NOT EXISTS page_captures_url_workspace_idx ON page_captures (workspace_id, url);

-- Anon try-first device sessions (hashed device key; never store plaintext)
CREATE TABLE IF NOT EXISTS chrome_device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_key_hash STRING NOT NULL UNIQUE,
  owner_id STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  upgraded_to_cognito_sub STRING NULL
);

CREATE INDEX IF NOT EXISTS chrome_device_sessions_owner_id_idx
  ON chrome_device_sessions (owner_id);
