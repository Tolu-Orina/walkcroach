-- Phase 1 — enterprise memory governance (ADR-0001, ADR-0002).
--
-- Additive only:
--   * provenance columns on memory_entries (actor + request lineage)
--   * erase tombstones (never silent hard DELETE)
--   * append-only memory_audit for control-plane actions
--
-- MVCC asOf window remains 90000s (034). Do not claim multi-year asOf here.

ALTER TABLE memory_entries
  ADD COLUMN IF NOT EXISTS actor_owner_id STRING NULL,
  ADD COLUMN IF NOT EXISTS actor_key_id UUID NULL,
  ADD COLUMN IF NOT EXISTS source_event_id STRING NULL,
  ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS erase_reason STRING NULL;

-- Live readers pin project + not-erased + not-superseded. Index supports list.
CREATE INDEX IF NOT EXISTS memory_entries_project_live_idx
  ON memory_entries (project_id, created_at DESC)
  WHERE erased_at IS NULL AND superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS memory_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  owner_id STRING NOT NULL,
  actor_key_id UUID NULL,
  action STRING NOT NULL,
  entry_id UUID NULL,
  request_id STRING NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT memory_audit_action_check CHECK (
    action IN (
      'remember',
      'supersede',
      'import',
      'export',
      'erase',
      'erase_export',
      'diff',
      'recall'
    )
  )
);

CREATE INDEX IF NOT EXISTS memory_audit_project_idx
  ON memory_audit (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS memory_audit_owner_idx
  ON memory_audit (owner_id, created_at DESC);
