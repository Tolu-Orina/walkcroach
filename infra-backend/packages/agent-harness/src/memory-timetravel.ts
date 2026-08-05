/**
 * Point-in-time reads over the memory layer, backed by CockroachDB MVCC.
 *
 * This is the capability no other agent-memory system has: not "what was true and
 * when" modelled in application data, but "what did the agent actually believe at
 * the moment it acted", read straight off the storage engine with no extra tables.
 *
 * Two things were verified against the live cluster on 2026-08-04 by
 * `infra-backend/scripts/spike-asof-vector.mjs`, and both are load-bearing:
 *
 *  1. The C-SPANN index stays eligible under AS OF SYSTEM TIME. The plan shows
 *     `• vector search … prefix spans: [/'<project_id>'/NULL - …]`, so historical
 *     recall is real semantic search rather than a full scan.
 *  2. Retention is bounded by `gc.ttlseconds`, which migration 034 set to 90000
 *     (25h) on `memory_entries`. Past that horizon CockroachDB cannot answer at
 *     all, so the window is a hard product limit, not a tuning knob.
 */
import type { DbClient } from '@walkcroach/db';
import { embedText } from './bedrock.js';
import { formatVector, RECALL_OVERFETCH } from './memory.js';
import type { MemoryHit, MemoryKind } from './types.js';

/** Matches migration 034. Kept here so the error message can name the real limit. */
export const MEMORY_GC_TTL_SECONDS = 90_000;

export class RetentionWindowError extends Error {
  readonly code = 'RETENTION_WINDOW_EXCEEDED';
  constructor(
    readonly requested: string,
    readonly maxLookbackSeconds: number,
  ) {
    super(
      `timestamp ${requested} is outside the MVCC retention window ` +
        `(gc.ttlseconds=${maxLookbackSeconds}, max lookback ` +
        `${(maxLookbackSeconds / 3600).toFixed(1)}h). Older state has been garbage collected ` +
        `and cannot be recovered.`,
    );
    this.name = 'RetentionWindowError';
  }
}

/**
 * Render a caller-supplied instant as a SQL literal.
 *
 * CockroachDB requires a constant expression in AS OF SYSTEM TIME, so this cannot
 * be a bound parameter. Rather than escaping caller input, the input is parsed to
 * a Date and re-serialised by `toISOString()` — the output charset is fixed
 * (digits, `-`, `:`, `.`, `T`, `Z`), so no input can survive into the SQL text.
 * That makes injection structurally impossible instead of filtered.
 */
export function toSystemTimeLiteral(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`invalid timestamp: ${String(at)}`);
  }
  if (d.getTime() > Date.now()) {
    throw new RangeError('cannot read the future: timestamp is ahead of now');
  }
  const ageSeconds = (Date.now() - d.getTime()) / 1000;
  if (ageSeconds > MEMORY_GC_TTL_SECONDS) {
    throw new RetentionWindowError(d.toISOString(), MEMORY_GC_TTL_SECONDS);
  }
  return `'${d.toISOString()}'`;
}

/** Translate CockroachDB's GC error into something a caller can act on. */
function rethrowRetention(err: unknown, requested: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (/must be after replica GC threshold|batch timestamp .* must be after/i.test(msg)) {
    throw new RetentionWindowError(requested, MEMORY_GC_TTL_SECONDS);
  }
  throw err;
}

/**
 * Semantic recall as of a past instant.
 *
 * Query shape is deliberately identical to `recallProjectMemory` — both prefix
 * columns pinned, nothing else in the WHERE clause — because the index contract
 * from migrations 031/032 applies here exactly as it does at present time. A
 * single extra predicate would silently drop the index.
 */
export async function recallProjectMemoryAsOf(params: {
  db: DbClient;
  projectId: string;
  query: string;
  at: Date | string;
  limit?: number;
  sourceSurfaces?: string[];
}): Promise<MemoryHit[]> {
  const limit = params.limit ?? 5;
  const surfaces = params.sourceSurfaces?.filter(Boolean) ?? [];
  const literal = toSystemTimeLiteral(params.at);

  const embedding = await embedText(params.query);
  const vec = formatVector(embedding);
  const fetch = Math.min(200, limit * RECALL_OVERFETCH);

  try {
    const { rows } = await params.db.query<{
      id: string;
      kind: MemoryKind;
      text: string;
      distance: number | null;
      source_surface: string;
    }>(
      `SELECT id, kind, text, source_surface,
              embedding <=> $2::vector AS distance
         FROM memory_entries AS OF SYSTEM TIME ${literal}
        WHERE project_id = $1::uuid
          AND superseded_by IS NULL
        ORDER BY embedding <=> $2::vector
        LIMIT $3`,
      [params.projectId, vec, fetch],
    );

    const surfaceSet = surfaces.length > 0 ? new Set(surfaces) : null;
    return rows
      .filter((r) => r.distance !== null)
      .filter((r) => !surfaceSet || surfaceSet.has(r.source_surface))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        distance: Number(r.distance),
        sourceSurface: r.source_surface,
      }));
  } catch (err) {
    rethrowRetention(err, literal);
  }
}

type Snapshot = {
  id: string;
  kind: MemoryKind;
  text: string;
  sourceSurface: string;
  createdAt: string;
};

/** All live entries for a project at an instant (or now, when `at` is null). */
async function snapshot(
  db: DbClient,
  projectId: string,
  at: Date | string | null,
): Promise<Map<string, Snapshot>> {
  const clause = at === null ? '' : ` AS OF SYSTEM TIME ${toSystemTimeLiteral(at)}`;
  try {
    const { rows } = await db.query<{
      id: string;
      kind: MemoryKind;
      text: string;
      source_surface: string;
      created_at: Date;
    }>(
      `SELECT id, kind, text, source_surface, created_at
         FROM memory_entries${clause}
        WHERE project_id = $1::uuid
          AND superseded_by IS NULL
        LIMIT 1000`,
      [projectId],
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          kind: r.kind,
          text: r.text,
          sourceSurface: r.source_surface,
          createdAt: new Date(r.created_at).toISOString(),
        },
      ]),
    );
  } catch (err) {
    rethrowRetention(err, clause);
  }
}

export type MemoryDiff = {
  from: string;
  to: string;
  added: Snapshot[];
  /** Live at `from`, no longer live at `to` — superseded or edited away. */
  retired: Snapshot[];
  unchanged: number;
};

/**
 * What changed in the agent's beliefs between two instants.
 *
 * Computed by set-differencing two snapshots rather than in SQL. Two reasons:
 * the diff is over live-entry identity (which `superseded_by IS NULL` already
 * expresses cleanly at each timestamp), and keeping each side to the exact query
 * shape the index expects matters more than saving a round trip.
 *
 * `to` accepts `'now'` (or null) to diff against the present.
 */
export async function diffProjectMemory(params: {
  db: DbClient;
  projectId: string;
  from: Date | string;
  to?: Date | string | 'now' | null;
}): Promise<MemoryDiff> {
  const toArg = params.to === 'now' || params.to == null ? null : params.to;

  const [before, after] = await Promise.all([
    snapshot(params.db, params.projectId, params.from),
    snapshot(params.db, params.projectId, toArg),
  ]);

  const added: Snapshot[] = [];
  const retired: Snapshot[] = [];
  let unchanged = 0;

  for (const [id, entry] of after) {
    if (before.has(id)) unchanged++;
    else added.push(entry);
  }
  for (const [id, entry] of before) {
    if (!after.has(id)) retired.push(entry);
  }

  const toIso =
    toArg === null ? new Date().toISOString() : new Date(toArg as string).toISOString();

  return {
    from: new Date(params.from as string).toISOString(),
    to: toIso,
    added,
    retired,
    unchanged,
  };
}
