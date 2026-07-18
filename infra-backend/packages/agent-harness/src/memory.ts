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
 * Includes all source surfaces for the project by default (web, chrome, ide).
 * Optional `sourceSurfaces` filter supports FR-D16 surface re-rank/filter.
 */
export async function recallProjectMemory(params: {
  db: DbClient;
  projectId: string;
  query: string;
  limit?: number;
  sourceSurfaces?: string[];
}): Promise<MemoryHit[]> {
  const limit = params.limit ?? 5;
  const embedding = await embedText(params.query);
  const vec = formatVector(embedding);
  const surfaces = params.sourceSurfaces?.filter(Boolean) ?? [];

  if (surfaces.length > 0) {
    const { rows } = await params.db.query<{
      id: string;
      kind: MemoryKind;
      text: string;
      distance: number;
      source_surface: string;
    }>(
      `SELECT id, kind, text, source_surface,
              embedding <=> $2::vector AS distance
       FROM memory_entries
       WHERE project_id = $1::uuid
         AND embedding IS NOT NULL
         AND superseded_by IS NULL
         AND source_surface = ANY($4::string[])
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [params.projectId, vec, limit, surfaces],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      text: r.text,
      distance: Number(r.distance),
      sourceSurface: r.source_surface,
    }));
  }

  const { rows } = await params.db.query<{
    id: string;
    kind: MemoryKind;
    text: string;
    distance: number;
    source_surface: string;
  }>(
    `SELECT id, kind, text, source_surface,
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
    sourceSurface: r.source_surface,
  }));
}

/** List recent memory entries for a project (IDE FR-D10 view). */
export async function listProjectMemoryEntries(params: {
  db: DbClient;
  projectId: string;
  limit?: number;
  sourceSurfaces?: string[];
}): Promise<
  Array<{
    id: string;
    kind: MemoryKind;
    text: string;
    sourceSurface: string;
    createdAt: string;
  }>
> {
  const limit = params.limit ?? 50;
  const surfaces = params.sourceSurfaces?.filter(Boolean) ?? [];

  if (surfaces.length > 0) {
    const { rows } = await params.db.query<{
      id: string;
      kind: MemoryKind;
      text: string;
      source_surface: string;
      created_at: string;
    }>(
      `SELECT id, kind, text, source_surface, created_at
       FROM memory_entries
       WHERE project_id = $1::uuid
         AND superseded_by IS NULL
         AND source_surface = ANY($3::string[])
       ORDER BY created_at DESC
       LIMIT $2`,
      [params.projectId, limit, surfaces],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      text: r.text,
      sourceSurface: r.source_surface,
      createdAt: r.created_at,
    }));
  }

  const { rows } = await params.db.query<{
    id: string;
    kind: MemoryKind;
    text: string;
    source_surface: string;
    created_at: string;
  }>(
    `SELECT id, kind, text, source_surface, created_at
     FROM memory_entries
     WHERE project_id = $1::uuid
       AND superseded_by IS NULL
     ORDER BY created_at DESC
     LIMIT $2`,
    [params.projectId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    sourceSurface: r.source_surface,
    createdAt: r.created_at,
  }));
}

/** Update mirrored memory text and re-embed (IDE FR-D10 edit). */
export async function updateMemoryEntryText(params: {
  db: DbClient;
  entryId: string;
  projectId: string;
  text: string;
  /** When set, only update rows from this surface (IDE PATCH must stay on ide). */
  sourceSurface?: string;
}): Promise<boolean> {
  const embedding = await embedText(params.text);
  const vec = formatVector(embedding);
  const result = params.sourceSurface
    ? await params.db.query(
        `UPDATE memory_entries
         SET text = $3, embedding = $4::vector
         WHERE id = $1::uuid
           AND project_id = $2::uuid
           AND source_surface = $5
           AND superseded_by IS NULL`,
        [
          params.entryId,
          params.projectId,
          params.text,
          vec,
          params.sourceSurface,
        ],
      )
    : await params.db.query(
        `UPDATE memory_entries
         SET text = $3, embedding = $4::vector
         WHERE id = $1::uuid
           AND project_id = $2::uuid
           AND superseded_by IS NULL`,
        [params.entryId, params.projectId, params.text, vec],
      );
  return (result.rowCount ?? 0) > 0;
}
