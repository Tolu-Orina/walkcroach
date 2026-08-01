-- Rebuild every vector index with the prefix column its reader filters on.
-- Pairs with 026 (drop). See 026 for why the two halves are separate files.
--
-- RULE APPLIED
-- CockroachDB uses a vector index for a filtered query only when *each* prefix
-- column is constrained to a specific value. So the prefix must be exactly the
-- column every reader of that table pins — no more (extra prefix columns would
-- disqualify readers that don't pin them), no fewer.
--
-- Each index below is justified against a real query in the codebase:
--
--   memory_entries          project_id  agent-harness/src/memory.ts
--                                       (recallProjectMemory — cross-surface recall)
--   project_documents       project_id  agent-harness/src/project-knowledge.ts
--   project_document_chunks project_id  agent-harness/src/project-knowledge.ts
--   creative_assets         owner_id    agent-harness/src/creative-memory.ts
--                                       (recallCreativeAssets — Chat has no project,
--                                        so owner_id is the tenant key here, NOT project_id)
--   page_captures           owner_id    lambda-chrome/src/handlers/recall.ts
--   workflow_runs           owner_id    agent-harness/src/workflow-memory.ts

-- Project-scoped tenants -----------------------------------------------------

CREATE VECTOR INDEX IF NOT EXISTS memory_entries_project_embedding_idx
  ON memory_entries (project_id, embedding);

CREATE VECTOR INDEX IF NOT EXISTS project_documents_project_embedding_idx
  ON project_documents (project_id, embedding);

CREATE VECTOR INDEX IF NOT EXISTS project_document_chunks_project_embedding_idx
  ON project_document_chunks (project_id, embedding);

-- Owner-scoped tenants -------------------------------------------------------

-- creative_assets.project_id is nullable (General Chat creatives have no project),
-- which is precisely why recallCreativeAssets keys on owner_id instead.
CREATE VECTOR INDEX IF NOT EXISTS creative_assets_owner_embedding_idx
  ON creative_assets (owner_id, embedding);

CREATE VECTOR INDEX IF NOT EXISTS workflow_runs_owner_embedding_idx
  ON workflow_runs (owner_id, embedding);

-- page_captures had an embedding column since 001 but was never indexed at all —
-- Chrome recall has been doing exact scans. Both of its query shapes constrain
-- owner_id (the workspace-scoped path filters `workspace_id = $1 AND owner_id = $2`),
-- so a single owner_id prefix serves both; workspace_id is applied as a post-filter.
-- Adding workspace_id as a second prefix column would be *worse*: it would
-- disqualify the owner-scoped path, which never constrains workspace_id.
CREATE VECTOR INDEX IF NOT EXISTS page_captures_owner_embedding_idx
  ON page_captures (owner_id, embedding);

-- No reader today ------------------------------------------------------------

-- video_jobs embeddings are written by embedAndStoreVideoJob but nothing reads
-- them back — there is no vector recall over video_jobs anywhere in the codebase.
-- Kept (rather than dropped in 026 and left out here) so the column and its index
-- stay consistent with creative_assets for the recall that Video Studio will
-- eventually want; prefixed on owner_id to match recallCreativeAssets' shape.
-- If Video Studio recall is cut, drop this index — an index with no reader is
-- pure write amplification.
CREATE VECTOR INDEX IF NOT EXISTS video_jobs_owner_embedding_idx
  ON video_jobs (owner_id, embedding);

-- shared_skills deliberately stays unindexed: 019 left its vector index commented
-- out, and listSharedSkills (agent-harness/src/skills.ts) orders by updated_at —
-- there is no `<=>` query over shared_skills. Indexing it would cost write
-- amplification on every skill upsert for no read benefit. Enable it in the same
-- change that introduces semantic skill recall, prefixed on owner_id.
