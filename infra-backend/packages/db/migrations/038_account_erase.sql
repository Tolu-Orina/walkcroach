-- Phase C — account erase (propose → confirm → execute).
-- Audited erase requests + platform account_audit. Memory content still
-- uses ADR-0002 tombstones via eraseMemoryEntries; this table records the
-- account-level proposal/execute lifecycle.

CREATE TABLE IF NOT EXISTS account_erase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  expected_email STRING NOT NULL,
  confirm_phrase STRING NOT NULL DEFAULT 'DELETE MY ACCOUNT',
  status STRING NOT NULL DEFAULT 'proposed',
  summary JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT account_erase_requests_status_check CHECK (
    status IN ('proposed', 'completed', 'failed', 'cancelled', 'expired')
  )
);

CREATE INDEX IF NOT EXISTS account_erase_requests_owner_idx
  ON account_erase_requests (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  action STRING NOT NULL,
  request_id UUID NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_audit_action_check CHECK (
    action IN (
      'erase_propose',
      'erase_execute',
      'erase_fail',
      'erase_cancel'
    )
  )
);

CREATE INDEX IF NOT EXISTS account_audit_owner_idx
  ON account_audit (owner_id, created_at DESC);
