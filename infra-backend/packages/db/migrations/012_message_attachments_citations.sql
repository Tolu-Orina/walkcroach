-- Phase F follow-up: persist Chat attachments + citations on messages (§7)
-- Apply with: npm run migrate -w @walkcroach/db

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS citations JSONB;
