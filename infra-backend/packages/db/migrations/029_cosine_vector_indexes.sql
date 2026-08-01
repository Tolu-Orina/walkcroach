-- Rebuild every vector index with BOTH corrections: the tenant prefix column
-- (from 027) and `vector_cosine_ops` to match the `<=>` operator the recall
-- queries use. Pairs with 028 (drop). See 028 for why the opclass matters.
--
-- The two properties a WalkCroach vector index must have:
--   1. prefix column = the column its reader constrains to a single value,
--      otherwise CockroachDB cannot use the index under that filter;
--   2. opclass = vector_cosine_ops, otherwise the index is ineligible for `<=>`
--      regardless of the prefix.
--
-- Both are required. 027 fixed only the first, which is why the planner still
-- refused the index afterwards.
--
-- If a future query switches to `<->` (L2) or `<#>` (inner product), it will need
-- its own index with the matching opclass — an index serves one operator.

-- Project-scoped tenants -----------------------------------------------------

CREATE VECTOR INDEX IF NOT EXISTS memory_entries_project_embedding_idx
  ON memory_entries (project_id, embedding vector_cosine_ops);

CREATE VECTOR INDEX IF NOT EXISTS project_documents_project_embedding_idx
  ON project_documents (project_id, embedding vector_cosine_ops);

CREATE VECTOR INDEX IF NOT EXISTS project_document_chunks_project_embedding_idx
  ON project_document_chunks (project_id, embedding vector_cosine_ops);

-- Owner-scoped tenants -------------------------------------------------------

CREATE VECTOR INDEX IF NOT EXISTS creative_assets_owner_embedding_idx
  ON creative_assets (owner_id, embedding vector_cosine_ops);

CREATE VECTOR INDEX IF NOT EXISTS workflow_runs_owner_embedding_idx
  ON workflow_runs (owner_id, embedding vector_cosine_ops);

CREATE VECTOR INDEX IF NOT EXISTS page_captures_owner_embedding_idx
  ON page_captures (owner_id, embedding vector_cosine_ops);

-- No reader today (see 027) --------------------------------------------------

CREATE VECTOR INDEX IF NOT EXISTS video_jobs_owner_embedding_idx
  ON video_jobs (owner_id, embedding vector_cosine_ops);
