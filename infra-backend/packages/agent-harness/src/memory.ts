import type { DbClient } from '@walkcroach/db';
import { embedText } from './bedrock.js';
import { memoryMetric, observeRecall } from './memory-metrics.js';
import type { MemoryHit, MemoryKind } from './types.js';

/** Format a float vector for CockroachDB VECTOR / array cast. */
export function formatVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Cosine distance below which a new entry is treated as *replacing* an existing
 * one rather than adding to it.
 *
 * Deliberately tight. `superseded_by` existed in the schema from 001 and was read
 * by every recall query but never written by anything, so memory was append-only:
 * restate a preference three times and all three come back as context, with no
 * signal about which is current.
 *
 * 0.15 collapses restatements and near-duplicates ("use dark mode" said twice in
 * different words). It will NOT catch a semantic contradiction that is lexically
 * distant ("use Postgres" → "use MySQL"), and that is the intended failure
 * direction: keeping a stale entry is recoverable, silently retiring a memory the
 * user still relies on is not. Widening this is a product decision that wants
 * eval data behind it, not a bigger constant.
 *
 * Set MEMORY_SUPERSEDE_THRESHOLD=0 to disable superseding entirely.
 */
export const DEFAULT_SUPERSEDE_DISTANCE = 0.15;

export function supersedeThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MEMORY_SUPERSEDE_THRESHOLD;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SUPERSEDE_DISTANCE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SUPERSEDE_DISTANCE;
}

/**
 * Write a memory entry, retiring the nearest same-kind entry it supersedes.
 *
 * The read-nearest / insert / mark-superseded sequence runs in one transaction so
 * a concurrent write cannot leave two live entries that both claim to be current,
 * or an entry superseded by a row that was never committed. The Bedrock embed
 * call is issued first, outside the transaction, because `withTransaction` may
 * replay `fn` on a serialization failure and re-embedding would be wasted spend.
 *
 * Returns the new entry id. `supersededId` is exposed for callers that want to
 * tell the user what was replaced.
 */
export async function writeMemoryEntryDetailed(params: {
  db: DbClient;
  projectId: string;
  sourceSurface: string;
  kind: MemoryKind;
  text: string;
}): Promise<{ id: string; supersededId: string | null }> {
  const embedStarted = Date.now();
  let embedding: number[];
  try {
    embedding = await embedText(params.text);
  } catch (err) {
    memoryMetric('EmbedFailure', 1, {
      surface: params.sourceSurface,
      operation: 'write',
      projectId: params.projectId,
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    throw err;
  }
  memoryMetric('EmbedLatencyMs', Date.now() - embedStarted, {
    surface: params.sourceSurface,
    operation: 'write',
  });

  const vec = formatVector(embedding);
  const threshold = supersedeThreshold();

  const result = await params.db.withTransaction(async (tx) => {
    // Nearest live neighbour of the same kind, read BEFORE the insert so the new
    // row cannot match itself at distance 0.
    let supersededId: string | null = null;
    if (threshold > 0) {
      const { rows: near } = await tx.query<{ id: string; distance: string }>(
        `SELECT id, embedding <=> $3::vector AS distance
           FROM memory_entries
          WHERE project_id = $1::uuid
            AND kind = $2
            AND embedding IS NOT NULL
            AND superseded_by IS NULL
          ORDER BY embedding <=> $3::vector
          LIMIT 1`,
        [params.projectId, params.kind, vec],
      );
      const candidate = near[0];
      if (candidate && Number(candidate.distance) <= threshold) {
        supersededId = candidate.id;
      }
    }

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO memory_entries (project_id, source_surface, kind, text, embedding)
       VALUES ($1::uuid, $2, $3, $4, $5::vector)
       RETURNING id`,
      [params.projectId, params.sourceSurface, params.kind, params.text, vec],
    );
    const id = rows[0]!.id;

    if (supersededId) {
      await tx.query(
        `UPDATE memory_entries
            SET superseded_by = $2::uuid
          WHERE id = $1::uuid
            AND superseded_by IS NULL`,
        [supersededId, id],
      );
    }

    return { id, supersededId };
  });

  memoryMetric('MemoryWrite', 1, {
    surface: params.sourceSurface,
    operation: 'write',
    projectId: params.projectId,
    kind: params.kind,
  });
  if (result.supersededId) {
    memoryMetric('MemorySuperseded', 1, {
      surface: params.sourceSurface,
      operation: 'supersede',
      projectId: params.projectId,
      kind: params.kind,
    });
  }

  return result;
}

/** Back-compatible wrapper — existing callers only need the new entry's id. */
export async function writeMemoryEntry(params: {
  db: DbClient;
  projectId: string;
  sourceSurface: string;
  kind: MemoryKind;
  text: string;
}): Promise<string> {
  const { id } = await writeMemoryEntryDetailed(params);
  return id;
}

/**
 * How much wider than `limit` to search before applying non-prefix filters.
 *
 * The C-SPANN index is prefixed on project_id (migration 027), so the tenant
 * filter prunes the search space. `superseded_by IS NULL` and `source_surface`
 * cannot — they are applied to the approximate-nearest-neighbour result set, so
 * a bare `LIMIT k` can come back with fewer than k rows once entries are
 * superseded or a surface filter is in play. Over-fetching and slicing in the
 * caller keeps recall at full strength; 4× is enough for the filter selectivity
 * seen here without turning an ANN lookup into a scan.
 */
export const RECALL_OVERFETCH = 4;
const MAX_RECALL_FETCH = 200;

/**
 * Semantic recall via cosine distance over the prefixed C-SPANN index.
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
  const surfaces = params.sourceSurfaces?.filter(Boolean) ?? [];

  return observeRecall(
    {
      projectId: params.projectId,
      surface: surfaces.length === 1 ? surfaces[0] : 'all',
    },
    async () => {
      const embedding = await embedText(params.query);
      const vec = formatVector(embedding);
      const fetch = Math.min(MAX_RECALL_FETCH, limit * RECALL_OVERFETCH);

      const { rows } =
        surfaces.length > 0
          ? await params.db.query<{
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
              [params.projectId, vec, fetch, surfaces],
            )
          : await params.db.query<{
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
              [params.projectId, vec, fetch],
            );

      return rows.slice(0, limit).map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        distance: Number(r.distance),
        sourceSurface: r.source_surface,
      }));
    },
  );
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
