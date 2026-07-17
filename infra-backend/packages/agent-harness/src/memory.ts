import type { DbClient } from '@walkcroach/db';
import { embedText } from './bedrock.js';
import type { MemoryHit, MemoryKind } from './types.js';

/** Format a float vector for CockroachDB VECTOR / array cast. */
export function formatVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function writeMemoryEntry(params: {
  db: DbClient;
  projectId: string;
  sourceSurface: string;
  kind: MemoryKind;
  text: string;
}): Promise<string> {
  const embedding = await embedText(params.text);
  const vec = formatVector(embedding);
  const { rows } = await params.db.query<{ id: string }>(
    `INSERT INTO memory_entries (project_id, source_surface, kind, text, embedding)
     VALUES ($1::uuid, $2, $3, $4, $5::vector)
     RETURNING id`,
    [
      params.projectId,
      params.sourceSurface,
      params.kind,
      params.text,
      vec,
    ],
  );
  return rows[0]!.id;
}

/**
 * Semantic recall via cosine distance.
 * Requires VECTOR column + preferably a C-SPANN index (see migrations).
 */
export async function recallProjectMemory(params: {
  db: DbClient;
  projectId: string;
  query: string;
  limit?: number;
}): Promise<MemoryHit[]> {
  const limit = params.limit ?? 5;
  const embedding = await embedText(params.query);
  const vec = formatVector(embedding);

  const { rows } = await params.db.query<{
    id: string;
    kind: MemoryKind;
    text: string;
    distance: number;
  }>(
    `SELECT id, kind, text,
            embedding <=> $2::vector AS distance
     FROM memory_entries
     WHERE project_id = $1::uuid
       AND embedding IS NOT NULL
       AND superseded_by IS NULL
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [params.projectId, vec, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    distance: Number(r.distance),
  }));
}
