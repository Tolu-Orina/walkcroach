-- Drop the tenant-only vector indexes ahead of 032.
--
-- WHY, AGAIN
-- 026/027 added the tenant prefix; 028/029 fixed the opclass. Both were
-- necessary. Neither was sufficient, and measuring the result is what exposed
-- the remaining gap: CockroachDB refuses a vector index for ANY query carrying
-- a predicate on a column that is not part of the index prefix.
--
-- Every recall query in this codebase carries at least one:
--
--   memory_entries           superseded_by IS NULL
--   creative_assets          status = 'ready', superseded_by IS NULL
--   workflow_runs            status IN ('executed','failed','declined')
--   page_captures            superseded_by IS NULL
--
-- so none of them could use its index. Recall has been an exact brute-force
-- scan throughout — correct, and getting slower with every row.
--
-- WHAT CHANGES
-- Filters that are ALWAYS present move into the index prefix. Verified against
-- the cluster first, because the rules are not obvious:
--
--   IS NULL on a prefix column        accepted  → superseded_by can be a prefix
--   IN (list) on a prefix column      accepted  → status can be a prefix
--   two prefix columns, both pinned   accepted
--   two prefix columns, one pinned    REJECTED  → a prefix column is a promise
--                                                 every reader must keep
--
-- Filters that are OPTIONAL (source_surface, kind, workspace_id) cannot go in
-- the prefix — a query that omits them would stop matching and lose the index
-- entirely. Those move to the caller, over the over-fetched candidate set
-- RECALL_OVERFETCH already produces.
--
-- Split from 032 for the same reason 026 was split from 027: migrate.ts runs
-- each file as one transaction, and dropping then recreating an index on the
-- same table inside one transaction is the kind of same-txn schema change
-- CockroachDB restricts.

DROP INDEX IF EXISTS memory_entries@memory_entries_project_embedding_idx;
DROP INDEX IF EXISTS creative_assets@creative_assets_owner_embedding_idx;
DROP INDEX IF EXISTS workflow_runs@workflow_runs_owner_embedding_idx;
DROP INDEX IF EXISTS page_captures@page_captures_owner_embedding_idx;
