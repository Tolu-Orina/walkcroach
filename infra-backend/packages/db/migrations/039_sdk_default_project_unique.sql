-- P0: one alive `__walkcroach_sdk__` project per owner.
-- Select-then-insert in ensureSdkDefaultProject can race; this unique index
-- makes the loser fail and re-select instead of creating duplicates.
-- Scoped to the reserved name so ordinary project names may still collide
-- (existing product behaviour).

CREATE UNIQUE INDEX IF NOT EXISTS projects_sdk_default_alive_uidx
  ON projects (owner_id)
  WHERE deleted_at IS NULL AND name = '__walkcroach_sdk__';
