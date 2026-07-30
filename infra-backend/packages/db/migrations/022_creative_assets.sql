-- Web Modules Phase B — creative_assets for slides/flyers/images
-- Grounding: docs/walkcroach-web-modules-imp-plan.md §4.3, Phase B1
--
-- Every finished (or failed) creative lives here. General Chat has no project —
-- project_id is nullable. Embeddings enable “another deck like the bakery one”.

CREATE TABLE IF NOT EXISTS creative_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  owner_id STRING NOT NULL,
  session_id UUID REFERENCES sessions(id),
  kind STRING NOT NULL,              -- 'slide_deck' | 'flyer' | 'image'
  brief JSONB NOT NULL DEFAULT '{}',
  s3_key STRING,                    -- null while status=proposed|generating
  preview_s3_key STRING,            -- thumbnail grid JPEG for decks
  download_name STRING,             -- suggested filename for the client
  embedding VECTOR(1024),
  credits_charged INT NOT NULL DEFAULT 0,
  images_consumed INT NOT NULL DEFAULT 0,
  status STRING NOT NULL DEFAULT 'proposed',
    -- proposed | generating | ready | failed | declined
  error STRING,
  superseded_by UUID REFERENCES creative_assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creative_assets_owner_created_idx
  ON creative_assets (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS creative_assets_session_idx
  ON creative_assets (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS creative_assets_project_created_idx
  ON creative_assets (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
