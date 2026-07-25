-- One-time Chrome → Web Chat context handoff (page extract too large for URL).

CREATE TABLE IF NOT EXISTS chrome_chat_handoffs (
  code STRING PRIMARY KEY,
  owner_id STRING NOT NULL,
  title STRING,
  url STRING,
  extract_text STRING NOT NULL,
  question STRING,
  code_expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chrome_chat_handoffs_expires_idx
  ON chrome_chat_handoffs (code_expires_at);
