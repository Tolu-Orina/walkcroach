-- Enable semantic recall over shared_skills.
--
-- 019 created embedding VECTOR(1024) but left the vector index commented out.
-- 027 explicitly deferred indexing until a `<=>` reader existed (write amp with
-- no reader). This migration is that reader+index pair.
--
-- Contract (same lessons as 026–032):
--   1. Prefix on owner_id — every searchSharedSkills query pins owner_id = $1.
--   2. opclass vector_cosine_ops — readers use cosine `<=>`, not L2 `<->`.
-- Reader: searchSharedSkills in agent-harness/src/skills.ts
--   pins: owner_id = $1
--   ORDER BY embedding <=> $2::vector

CREATE VECTOR INDEX IF NOT EXISTS shared_skills_owner_embedding_idx
  ON shared_skills (owner_id, embedding vector_cosine_ops);
