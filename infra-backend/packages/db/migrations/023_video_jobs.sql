-- Web Modules Phase D — Video Studio jobs
-- Grounding: docs/walkcroach-web-modules-imp-plan.md §5.2, Phase D1
--
-- Cap rule (authoritative): count rows with
--   status IN ('queued','generating','composing','ready')
--   AND created_at > now() - interval '72 hours'
-- Failed / proposed / declined do NOT consume the 1/72h slot (retry allowed).

CREATE TABLE IF NOT EXISTS video_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  owner_id STRING NOT NULL,
  session_id UUID REFERENCES sessions(id),
  shot_list JSONB NOT NULL DEFAULT '[]',
  voiceover_script STRING,
  duration_sec INT NOT NULL CHECK (duration_sec <= 30),
  aspect STRING NOT NULL DEFAULT '16:9',  -- '16:9' | '9:16'
  invocation_arn STRING,
  status STRING NOT NULL DEFAULT 'proposed',
    -- proposed | queued | generating | composing | ready | failed | declined
  s3_key STRING,
  preview_s3_key STRING,
  credits_charged INT NOT NULL DEFAULT 0,
  images_consumed INT NOT NULL DEFAULT 0,
  error JSONB,
  superseded_by UUID REFERENCES video_jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_jobs_owner_created_idx
  ON video_jobs (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS video_jobs_owner_cap_idx
  ON video_jobs (owner_id, created_at DESC)
  WHERE status IN ('queued', 'generating', 'composing', 'ready');

CREATE INDEX IF NOT EXISTS video_jobs_session_idx
  ON video_jobs (session_id)
  WHERE session_id IS NOT NULL;
