-- Rebuild vector indexes with the always-present filters in the prefix.
-- Pairs with 031. See 031 for why, and for the rules verified against the cluster.
--
-- The contract each index below creates, which its reader MUST keep:
-- every prefix column has to be constrained in the query, every time. A reader
-- that stops pinning one loses the index silently — the query keeps returning
-- correct rows, just by scanning. That is precisely the failure this whole
-- sequence of migrations has been chasing, so the readers are named here.

-- memory_entries — recallProjectMemory (agent-harness/src/memory.ts)
--   pins: project_id = $1, superseded_by IS NULL
--   caller-side: source_surface (optional filter), null-distance guard
CREATE VECTOR INDEX IF NOT EXISTS memory_entries_recall_idx
  ON memory_entries (project_id, superseded_by, embedding vector_cosine_ops);

-- creative_assets — recallCreativeAssets (agent-harness/src/creative-memory.ts)
--   pins: owner_id = $1, status = 'ready', superseded_by IS NULL
--   caller-side: kind (optional filter)
-- status is in the prefix because this reader always asks for 'ready' and only
-- 'ready'. If a second reader ever wants another status, it must pin one too.
CREATE VECTOR INDEX IF NOT EXISTS creative_assets_recall_idx
  ON creative_assets (owner_id, status, superseded_by, embedding vector_cosine_ops);

-- workflow_runs — recallWorkflowRuns (agent-harness/src/workflow-memory.ts)
--   pins: owner_id = $1, status IN ('executed','failed','declined')
-- An IN list counts as constrained, so the three-status filter stays in SQL.
CREATE VECTOR INDEX IF NOT EXISTS workflow_runs_recall_idx
  ON workflow_runs (owner_id, status, embedding vector_cosine_ops);

-- page_captures — handleRecall (lambda-chrome/src/handlers/recall.ts)
--   pins: owner_id = $1, superseded_by IS NULL
--   caller-side: workspace_id (only the workspace-scoped path sends it, so it
--   cannot be a prefix column without breaking the owner-scoped path)
CREATE VECTOR INDEX IF NOT EXISTS page_captures_recall_idx
  ON page_captures (owner_id, superseded_by, embedding vector_cosine_ops);

-- Unchanged, and deliberately so:
--
--   project_documents_project_embedding_idx        (project_id, embedding)
--   project_document_chunks_project_embedding_idx  (project_id, embedding)
--
-- Their only always-present filter is the tenant, which they already have. What
-- blocks them is on the query side — `text_content IS NOT NULL` and an INNER
-- JOIN that adds a predicate to the indexed table — both fixed in
-- project-knowledge.ts rather than here.
--
--   video_jobs_owner_embedding_idx                 (owner_id, embedding)
--
-- still has no reader at all; see 027.
