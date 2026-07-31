-- Web Modules Phase F5 — workflow_runs semantic recall index
-- Grounding: docs/walkcroach-web-modules-imp-plan.md §6.2 / Phase F5
-- embedding column already on workflow_runs (020_connectors.sql)

CREATE VECTOR INDEX IF NOT EXISTS workflow_runs_embedding_idx
  ON workflow_runs (embedding);
