-- Web Modules Phase E — creative memory, video embeddings, alt text
-- Grounding: docs/walkcroach-web-modules-imp-plan.md Phase E1–E3
--
-- E1: C-SPANN vector indexes for “like last time” recall
-- E3: durable alt_text on creative_assets

ALTER TABLE creative_assets
  ADD COLUMN IF NOT EXISTS alt_text STRING;

ALTER TABLE video_jobs
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1024);

-- Same pattern as memory_entries_embedding_idx (003_checkpoints.sql)
CREATE VECTOR INDEX IF NOT EXISTS creative_assets_embedding_idx
  ON creative_assets (embedding);

CREATE VECTOR INDEX IF NOT EXISTS video_jobs_embedding_idx
  ON video_jobs (embedding);
