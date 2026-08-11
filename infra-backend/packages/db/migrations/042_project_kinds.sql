-- ADR-0004 / Web delineation Phase 1 — Project kinds
-- Pillars: Chat (general) · Project (knowledge) · App Builder (app)
-- Backfill policy A: existing rows keep kind=app (DEFAULT already 'app').
-- Apply with: npm run migrate -w @walkcroach/db
--
-- Idempotent. List index deferred to 043 (partial indexes can queue behind
-- SCHEMA CHANGE GC on busy clusters).

UPDATE projects
   SET kind = 'app'
 WHERE kind IS NULL
    OR kind NOT IN ('app', 'general', 'knowledge');

ALTER TABLE projects
  ALTER COLUMN kind SET DEFAULT 'app';

ALTER TABLE projects
  ADD CONSTRAINT IF NOT EXISTS projects_kind_check
  CHECK (kind IN ('app', 'general', 'knowledge'));
