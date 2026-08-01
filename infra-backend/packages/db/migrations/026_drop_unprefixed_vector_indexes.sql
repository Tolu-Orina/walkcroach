-- Drop unprefixed vector indexes ahead of 027 (prefixed rebuild).
--
-- WHY THIS EXISTS
-- Every vector index in migrations 003–025 was declared on the embedding column
-- alone, e.g. `CREATE VECTOR INDEX ... ON memory_entries (embedding)`. But every
-- recall query in the codebase is tenant-scoped first:
--
--   SELECT ... FROM memory_entries
--    WHERE project_id = $1::uuid AND embedding IS NOT NULL AND superseded_by IS NULL
--    ORDER BY embedding <=> $2::vector LIMIT $3
--
-- CockroachDB only uses a vector index for a filtered query when each prefix
-- column of the index is constrained to a specific value. With no prefix column
-- the tenant filter cannot pre-partition the C-SPANN search, so the index either
-- goes unused (full scan + exact distance) or the ANN search runs across every
-- tenant and the tenant filter is applied afterwards — which silently returns
-- fewer than LIMIT rows once more than one tenant has data.
--
-- 027 recreates each index with the prefix column its reader actually filters on.
--
-- WHY DROP-THEN-CREATE, IN TWO FILES
-- `migrate.ts` sends each .sql file as a single multi-statement query, i.e. one
-- implicit transaction. Dropping and recreating an index on the same table inside
-- one transaction is the kind of same-txn schema change CockroachDB restricts, and
-- it would additionally assume two vector indexes may briefly coexist on one column.
-- Splitting the two halves across files gives each its own transaction and avoids
-- both assumptions. The cost is a short window (between 026 and 027 in the same
-- `npm run migrate` run) where recall falls back to an exact scan — correct, just
-- slower, and unnoticeable at current row counts.

DROP INDEX IF EXISTS memory_entries@memory_entries_embedding_idx;
DROP INDEX IF EXISTS project_documents@project_documents_embedding_idx;
DROP INDEX IF EXISTS project_document_chunks@project_document_chunks_embedding_idx;
DROP INDEX IF EXISTS creative_assets@creative_assets_embedding_idx;
DROP INDEX IF EXISTS video_jobs@video_jobs_embedding_idx;
DROP INDEX IF EXISTS workflow_runs@workflow_runs_embedding_idx;
