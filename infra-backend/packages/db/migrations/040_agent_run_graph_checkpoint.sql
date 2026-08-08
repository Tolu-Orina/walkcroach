-- Phase 3 — durable Graph checkpoint columns on agent_runs (ADR-G / ADR-C / A5).
--
-- LangGraph PostgresSaver analogue on CockroachDB: after each node the executor
-- persists typed stage state keyed by run_id (≈ thread_id). Lease expiry for
-- graph-backed runs becomes a recoverable re-queue, not a fail-wipe.

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS current_stage STRING;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS stage_state JSONB NOT NULL DEFAULT '{}';
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS stage_state_version INT NOT NULL DEFAULT 1;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS checkpoint_at TIMESTAMPTZ;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS revise_count INT NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS graph_id STRING;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS node_execution_count INT NOT NULL DEFAULT 0;
-- Durable thrash fingerprints for async runs only (A4); interactive stays in-process.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tool_fingerprints JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS agent_runs_graph_idx
  ON agent_runs (graph_id)
  WHERE graph_id IS NOT NULL;
