-- Chunk-level multi-tenant RAG for project documents (CockroachDB VECTOR).
-- Tenant boundary: every chunk row carries project_id; recall MUST filter on it.
-- Parent document delete cascades chunks via document_id FK.

CREATE TABLE IF NOT EXISTS project_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INT4 NOT NULL,
  content STRING NOT NULL,
  char_count INT4 NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS project_document_chunks_project_id_idx
  ON project_document_chunks (project_id, document_id, chunk_index);

CREATE INDEX IF NOT EXISTS project_document_chunks_document_id_idx
  ON project_document_chunks (document_id);

CREATE VECTOR INDEX IF NOT EXISTS project_document_chunks_embedding_idx
  ON project_document_chunks (embedding);
