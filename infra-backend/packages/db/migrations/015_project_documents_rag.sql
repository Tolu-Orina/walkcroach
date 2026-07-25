-- Multi-tenant project document RAG: vector index for cosine recall.
-- All recall queries MUST filter WHERE project_id = $1 (assertProjectOwner at API).

CREATE VECTOR INDEX IF NOT EXISTS project_documents_embedding_idx
  ON project_documents (embedding);
