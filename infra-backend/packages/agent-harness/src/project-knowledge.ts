/**
 * Project document RAG on CockroachDB VECTOR (chunk-level, multi-tenant).
 *
 * Ingest: chunk → Titan embed (1024-d) → project_document_chunks
 * Recall: embed query → cosine (<=>) WHERE project_id = $tenant LIMIT k
 */
import type { DbClient } from '@walkcroach/db';
import { embedText } from './bedrock.js';
import { formatVector } from './memory.js';
import { chunkText } from './text-chunker.js';

export type ProjectKnowledgeHit = {
  id: string;
  name: string;
  excerpt: string;
  documentId: string;
  chunkIndex?: number;
  distance?: number;
};

export type ProjectKnowledge = {
  name: string;
  description: string | null;
  instructions: string | null;
  documents: ProjectKnowledgeHit[];
};

const MAX_FALLBACK_DOCS = 8;
const EXCERPT_CHARS = 2000;
const MAX_RECALL_CHUNKS = 6;
/** Bound Bedrock InvokeModel calls per document ingest. */
const MAX_EMBED_CHUNKS = 80;

async function loadRecentDocuments(
  db: DbClient,
  projectId: string,
): Promise<ProjectKnowledgeHit[]> {
  const docs = await db.query<{
    id: string;
    name: string;
    text_content: string | null;
  }>(
    `SELECT id, name, text_content
     FROM project_documents
     WHERE project_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    [projectId, MAX_FALLBACK_DOCS],
  );
  return docs.rows.map((d) => ({
    id: d.id,
    documentId: d.id,
    name: d.name,
    excerpt: (d.text_content ?? '').slice(0, EXCERPT_CHARS),
  }));
}

/**
 * Semantic recall of project document chunks.
 * Tenant boundary is mandatory: WHERE project_id = $1.
 */
export async function recallProjectDocuments(params: {
  db: DbClient;
  projectId: string;
  query: string;
  limit?: number;
}): Promise<ProjectKnowledgeHit[]> {
  const limit = Math.min(
    Math.max(params.limit ?? MAX_RECALL_CHUNKS, 1),
    12,
  );
  const q = params.query.trim();
  if (!q) {
    return loadRecentDocuments(params.db, params.projectId);
  }

  try {
    const embedding = await embedText(q.slice(0, 8000));
    const vec = formatVector(embedding);

    const { rows } = await params.db.query<{
      chunk_id: string;
      document_id: string;
      name: string;
      content: string;
      chunk_index: number;
      distance: number;
    }>(
      /**
       * The vector search is isolated in a CTE so it carries exactly one
       * predicate — the index prefix — and nothing else.
       *
       * It previously joined `project_documents` inline with
       * `AND d.project_id = c.project_id`, which put a second predicate on the
       * indexed table and made CockroachDB refuse the index outright (an INNER
       * JOIN constraining the indexed table is rejected; a LEFT JOIN or a join
       * outside the search is not). See migrations 031/032.
       *
       * The tenant guard that condition provided is preserved on the outer
       * join, where it constrains `d` rather than `c` and costs nothing.
       */
      `WITH hits AS (
         SELECT id, document_id, content, chunk_index,
                embedding <=> $2::vector AS distance
           FROM project_document_chunks
          WHERE project_id = $1::uuid
          ORDER BY embedding <=> $2::vector
          LIMIT $3
       )
       SELECT h.id AS chunk_id, h.document_id, d.name, h.content,
              h.chunk_index, h.distance
         FROM hits h
         INNER JOIN project_documents d
           ON d.id = h.document_id
          AND d.project_id = $1::uuid
        WHERE h.distance IS NOT NULL
        ORDER BY h.distance`,
      [params.projectId, vec, limit],
    );

    if (rows.length > 0) {
      return rows.map((r) => ({
        id: r.chunk_id,
        documentId: r.document_id,
        name: r.name,
        excerpt: r.content.slice(0, EXCERPT_CHARS),
        chunkIndex: Number(r.chunk_index),
        distance: Number(r.distance),
      }));
    }

    // Legacy docs: whole-document embedding (pre-chunk migration)
    const legacy = await params.db.query<{
      id: string;
      name: string;
      text_content: string | null;
      distance: number;
    }>(
      /**
       * Prefix column only. `text_content IS NOT NULL` moved to the caller —
       * as a non-prefix predicate it disqualified the index, and it is a
       * legacy-data guard rather than a semantic filter. Over-fetched 4× so
       * dropping the text-less rows does not shorten the result.
       */
      `SELECT id, name, text_content,
              embedding <=> $2::vector AS distance
       FROM project_documents
       WHERE project_id = $1::uuid
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [params.projectId, vec, Math.min(100, limit * 4)],
    );

    // Filters the SQL used to carry, now applied here so the index stays usable.
    const usableLegacy = legacy.rows
      .filter((d) => d.distance !== null && d.text_content !== null)
      .slice(0, limit);

    if (usableLegacy.length > 0) {
      return usableLegacy.map((d) => ({
        id: d.id,
        documentId: d.id,
        name: d.name,
        excerpt: (d.text_content ?? '').slice(0, EXCERPT_CHARS),
        distance: Number(d.distance),
      }));
    }

    return loadRecentDocuments(params.db, params.projectId);
  } catch {
    return loadRecentDocuments(params.db, params.projectId);
  }
}

export async function loadProjectKnowledge(
  db: DbClient,
  projectId: string,
  query?: string,
): Promise<ProjectKnowledge | null> {
  const { rows } = await db.query<{
    name: string;
    description: string | null;
    instructions: string | null;
  }>(
    `SELECT name, description, instructions
     FROM projects
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [projectId],
  );
  const project = rows[0];
  if (!project) return null;

  const documents = query?.trim()
    ? await recallProjectDocuments({ db, projectId, query })
    : await loadRecentDocuments(db, projectId);

  return {
    name: project.name,
    description: project.description,
    instructions: project.instructions,
    documents,
  };
}

/**
 * Chunk + embed a project document into project_document_chunks.
 * All writes are scoped by projectId (tenant). Replaces prior chunks for the doc.
 * Also refreshes parent project_documents.embedding from chunk 0 for legacy fallback.
 *
 * Embeddings are computed before the SQL transaction so Bedrock latency
 * does not hold open a Cockroach txn.
 */
export async function embedProjectDocument(params: {
  db: DbClient;
  documentId: string;
  projectId: string;
  text: string;
}): Promise<{ chunkCount: number }> {
  const text = params.text.trim();
  if (!text) return { chunkCount: 0 };

  const chunks = chunkText(text, { maxChunks: MAX_EMBED_CHUNKS });
  if (chunks.length === 0) return { chunkCount: 0 };

  const embedded: Array<{
    index: number;
    content: string;
    charCount: number;
    vec: string;
  }> = [];

  for (const chunk of chunks) {
    const embedding = await embedText(chunk.content.slice(0, 8000));
    embedded.push({
      index: chunk.index,
      content: chunk.content,
      charCount: chunk.charCount,
      vec: formatVector(embedding),
    });
  }

  const client = await params.db.pool.connect();
  try {
    await client.query('BEGIN');

    const owned = await client.query<{ id: string }>(
      `SELECT id FROM project_documents
       WHERE id = $1::uuid AND project_id = $2::uuid
       LIMIT 1`,
      [params.documentId, params.projectId],
    );
    if (!owned.rows[0]) {
      await client.query('ROLLBACK');
      throw new Error('document not found for project');
    }

    await client.query(
      `DELETE FROM project_document_chunks
       WHERE document_id = $1::uuid AND project_id = $2::uuid`,
      [params.documentId, params.projectId],
    );

    for (const chunk of embedded) {
      await client.query(
        `INSERT INTO project_document_chunks
           (document_id, project_id, chunk_index, content, char_count, metadata, embedding)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::vector)`,
        [
          params.documentId,
          params.projectId,
          chunk.index,
          chunk.content,
          chunk.charCount,
          JSON.stringify({
            source: 'project_document',
            charCount: chunk.charCount,
          }),
          chunk.vec,
        ],
      );
    }

    const firstVec = embedded[0]?.vec;
    if (firstVec) {
      await client.query(
        `UPDATE project_documents
         SET embedding = $3::vector
         WHERE id = $1::uuid AND project_id = $2::uuid`,
        [params.documentId, params.projectId, firstVec],
      );
    }

    await client.query('COMMIT');
    return { chunkCount: embedded.length };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Format knowledge block appended to the agent system prompt. */
export function formatProjectKnowledgeBlock(
  knowledge: ProjectKnowledge,
): string {
  const parts: string[] = [`Project: ${knowledge.name}`];
  if (knowledge.description?.trim()) {
    parts.push(`Description:\n${knowledge.description.trim()}`);
  }
  if (knowledge.instructions?.trim()) {
    parts.push(
      `Standing instructions (follow across all chats in this project):\n${knowledge.instructions.trim()}`,
    );
  }
  if (knowledge.documents.length > 0) {
    parts.push(
      'Relevant project document chunks (retrieved by semantic similarity — use when helpful):',
    );
    for (const doc of knowledge.documents) {
      if (!doc.excerpt.trim()) {
        parts.push(`- ${doc.name} (no text extracted)`);
        continue;
      }
      const label =
        typeof doc.chunkIndex === 'number'
          ? `${doc.name} [chunk ${doc.chunkIndex}]`
          : doc.name;
      parts.push(`--- ${label} ---\n${doc.excerpt}`);
    }
  }
  return parts.join('\n\n');
}
