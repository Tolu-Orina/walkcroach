import type { DbClient } from '@walkcroach/db';
import { embedText } from './bedrock.js';
import { memoryMetric, observeRecall } from './memory-metrics.js';
import type { MemoryHit, MemoryKind } from './types.js';
import type { SupersedeWriteResult } from '@walkcroach/memory-contracts';

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
  /** Tenant principal that authored the write (Cognito sub / key owner). */
  actorOwnerId?: string | null;
  /** API key id when the caller authenticated with a key. */
  actorKeyId?: string | null;
  /** Optional request / event id for lineage (Oracle/Attestor pattern). */
  sourceEventId?: string | null;
}): Promise<SupersedeWriteResult> {
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
      /**
       * Same index contract as recall: pin both prefix columns and add nothing
       * else. `kind` is deliberately NOT in the WHERE clause — it is not a
       * prefix column of `memory_entries_recall_idx` (recall does not pin it,
       * so it cannot be one), and including it here would make CockroachDB
       * refuse the index for this query too.
       *
       * Fetching a small neighbourhood and picking the nearest same-kind row
       * costs one extra round of comparison and keeps the index in play. If all
       * of the nearest rows are a different kind, nothing is superseded — which
       * is the conservative outcome the threshold already aims for.
       */
      const { rows: near } = await tx.query<{
        id: string;
        kind: string;
        distance: string | null;
        erased_at: Date | null;
      }>(
        `SELECT id, kind, erased_at, embedding <=> $2::vector AS distance
           FROM memory_entries
          WHERE project_id = $1::uuid
            AND superseded_by IS NULL
          ORDER BY embedding <=> $2::vector
          LIMIT 20`,
        [params.projectId, vec],
      );
      const candidate = near.find(
        (r) =>
          r.kind === params.kind &&
          r.distance !== null &&
          r.erased_at == null,
      );
      if (candidate && Number(candidate.distance) <= threshold) {
        supersededId = candidate.id;
      }
    }

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO memory_entries
         (project_id, source_surface, kind, text, embedding,
          actor_owner_id, actor_key_id, source_event_id)
       VALUES ($1::uuid, $2, $3, $4, $5::vector, $6, $7::uuid, $8)
       RETURNING id`,
      [
        params.projectId,
        params.sourceSurface,
        params.kind,
        params.text,
        vec,
        params.actorOwnerId ?? null,
        params.actorKeyId ?? null,
        params.sourceEventId ?? null,
      ],
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
 * How much wider than `limit` to search before applying caller-side filters.
 *
 * The index (migration 032) is prefixed on `(project_id, superseded_by)`, so
 * both of those are pinned in SQL and cost nothing here. What remains
 * caller-side is the OPTIONAL `source_surface` filter, which cannot be a prefix
 * column: a query that omits it would stop constraining that column and lose
 * the index entirely.
 *
 * 4× covers a surface filter that matches roughly a quarter of a project's
 * memories. Beyond that the tail is truncated rather than wrong — recall
 * returns fewer than `limit`, never something incorrect.
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

      /**
       * One query shape, always. Both prefix columns of
       * `memory_entries_recall_idx` are pinned and NOTHING else appears in the
       * WHERE clause, because a single extra predicate on a non-prefix column
       * makes CockroachDB refuse the index outright — the whole point of
       * migrations 031/032.
       *
       * Two predicates that used to live here are gone:
       *   `embedding IS NOT NULL`  redundant — a NULL embedding is not in the
       *                            vector index, and the null-distance guard
       *                            below covers the exact-scan fallback.
       *   `source_surface = ANY()` optional, so it cannot be a prefix column;
       *                            applied caller-side over the over-fetch.
       */
      const { rows } = await params.db.query<{
        id: string;
        kind: MemoryKind;
        text: string;
        distance: number | null;
        source_surface: string;
        created_at: Date | string;
        erased_at: Date | null;
      }>(
        `SELECT id, kind, text, source_surface, created_at, erased_at,
                embedding <=> $2::vector AS distance
           FROM memory_entries
          WHERE project_id = $1::uuid
            AND superseded_by IS NULL
          ORDER BY embedding <=> $2::vector
          LIMIT $3`,
        [params.projectId, vec, fetch],
      );

      const surfaceSet = surfaces.length > 0 ? new Set(surfaces) : null;

      return rows
        .filter((r) => r.distance !== null)
        .filter((r) => r.erased_at == null)
        .filter((r) => !surfaceSet || surfaceSet.has(r.source_surface))
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          text: r.text,
          distance: Number(r.distance),
          sourceSurface: r.source_surface,
          createdAt:
            r.created_at instanceof Date
              ? r.created_at.toISOString()
              : String(r.created_at),
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
         AND erased_at IS NULL
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
       AND erased_at IS NULL
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
           AND superseded_by IS NULL
           AND erased_at IS NULL`,
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
           AND superseded_by IS NULL
           AND erased_at IS NULL`,
        [params.entryId, params.projectId, params.text, vec],
      );
  return (result.rowCount ?? 0) > 0;
}
