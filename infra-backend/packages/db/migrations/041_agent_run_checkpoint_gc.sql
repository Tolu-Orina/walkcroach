-- Phase 8 — checkpoint GC support index (ADR-G production hardening).
--
-- Application prune: pruneStaleGraphCheckpoints(db, { retentionDays: 30 })
-- clears bulky stage_state on terminal graph runs past retention.
-- Metadata columns (graph_id, revise_count, node_execution_count) are kept.

CREATE INDEX IF NOT EXISTS agent_runs_terminal_checkpoint_gc_idx
  ON agent_runs (finished_at)
  WHERE graph_id IS NOT NULL
    AND status IN ('succeeded', 'failed', 'cancelled')
    AND finished_at IS NOT NULL;
