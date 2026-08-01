-- Drop the L2 vector indexes ahead of 029 (cosine rebuild).
--
-- WHY THIS EXISTS (second half of the vector-index fix; 026/027 were the first)
-- 026/027 gave every vector index the prefix column its reader filters on, which
-- was necessary but not sufficient. Verifying the result against the cluster with
-- an index hint produced:
--
--   index "memory_entries_project_embedding_idx" cannot be used for this query
--
-- The cause is the operator class. CockroachDB defaults a vector index to
-- `vector_l2_ops`, which accelerates only the L2 operator `<->`. Every recall
-- query in this codebase measures cosine distance with `<=>`:
--
--   ORDER BY embedding <=> $2::vector          -- memory.ts, project-knowledge.ts,
--                                              -- creative-memory.ts, workflow-memory.ts,
--                                              -- lambda-chrome/handlers/recall.ts
--
-- An opclass mismatch makes the index ineligible outright — the planner will not
-- consider it no matter how the prefix is shaped. Every vector index created from
-- migration 003 onward took the default, so no vector index in WalkCroach has ever
-- been used by a query. Recall has always been an exact brute-force scan; it
-- returned correct results, which is exactly why this stayed invisible.
--
-- 029 recreates each index with `vector_cosine_ops` to match the operator the
-- queries actually use. Same two-file split as 026/027, for the same reason:
-- `migrate.ts` runs each file as a single transaction.
--
-- 027 is deliberately left untouched. It is applied history on the live cluster,
-- and CLAUDE.md's rule is to add migrations rather than edit old ones.

DROP INDEX IF EXISTS memory_entries@memory_entries_project_embedding_idx;
DROP INDEX IF EXISTS project_documents@project_documents_project_embedding_idx;
DROP INDEX IF EXISTS project_document_chunks@project_document_chunks_project_embedding_idx;
DROP INDEX IF EXISTS creative_assets@creative_assets_owner_embedding_idx;
DROP INDEX IF EXISTS page_captures@page_captures_owner_embedding_idx;
DROP INDEX IF EXISTS video_jobs@video_jobs_owner_embedding_idx;
DROP INDEX IF EXISTS workflow_runs@workflow_runs_owner_embedding_idx;
