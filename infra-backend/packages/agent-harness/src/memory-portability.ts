/**
 * Memory export and import — user-owned, provenance-preserving portability.
 *
 * Every incumbent agent-memory system in this category monetises lock-in: there
 * is no documented way to take your memory elsewhere. That is also becoming a
 * regulatory problem (EU Data Act switching provisions, in force since
 * 2025-09-12) and a standards one (a W3C AI Agent Memory Interoperability
 * community group was proposed 2026-05-18; there is an IETF draft on persistent
 * agent memory architecture). Nobody has shipped an export.
 *
 * The format below is deliberately boring: a flat JSON envelope with a version,
 * the provenance chain, and optionally the raw vectors.
 *
 * **Why embeddings are included by default.** Re-embedding on import needs the
 * same model and costs an inference call per entry. Carrying the vectors makes
 * import exact, offline-capable, and independent of whether the destination even
 * has Bedrock access — while `embeddingModel` records what produced them so a
 * destination using a different model knows it must re-embed rather than
 * silently mixing vector spaces.
 */
import type { DbClient } from '@walkcroach/db';
import { getTitanEmbedModelId, embedText } from './bedrock.js';
import { formatVector } from './memory.js';
import type { MemoryKind } from './types.js';

export const EXPORT_FORMAT = 'walkcroach-memory-export';
export const EXPORT_VERSION = '1.0';
export const EMBEDDING_DIMENSIONS = 1024;

export type ExportedEntry = {
  id: string;
  kind: MemoryKind;
  text: string;
  sourceSurface: string;
  createdAt: string;
  /**
   * The entry that replaced this one, or null if this is current.
   * Retained so the supersede chain survives the round trip — an export that
   * dropped it would turn a corrected memory into a contradictory one.
   */
  supersededBy: string | null;
  embedding?: number[];
};

export type MemoryExport = {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  projectId: string;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  entryCount: number;
  entries: ExportedEntry[];
};

const MAX_EXPORT_ENTRIES = 10_000;

/**
 * Export a project's memory, including superseded entries.
 *
 * Superseded entries are included on purpose: they are the provenance record.
 * An export of only live entries would answer "what do you believe now" but not
 * "what did you believe, and what changed" — and the second is the part that
 * cannot be reconstructed later.
 */
export async function exportProjectMemory(params: {
  db: DbClient;
  projectId: string;
  includeEmbeddings?: boolean;
  includeSuperseded?: boolean;
}): Promise<MemoryExport> {
  const includeEmbeddings = params.includeEmbeddings ?? true;
  const includeSuperseded = params.includeSuperseded ?? true;

  const { rows } = await params.db.query<{
    id: string;
    kind: MemoryKind;
    text: string;
    source_surface: string;
    created_at: Date;
    superseded_by: string | null;
    embedding: string | null;
  }>(
    `SELECT id, kind, text, source_surface, created_at, superseded_by,
            ${includeEmbeddings ? 'embedding::string AS embedding' : 'NULL AS embedding'}
       FROM memory_entries
      WHERE project_id = $1::uuid
        ${includeSuperseded ? '' : 'AND superseded_by IS NULL'}
      ORDER BY created_at ASC
      LIMIT ${MAX_EXPORT_ENTRIES}`,
    [params.projectId],
  );

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    projectId: params.projectId,
    embeddingModel: includeEmbeddings ? getTitanEmbedModelId() : null,
    embeddingDimensions: includeEmbeddings ? EMBEDDING_DIMENSIONS : null,
    entryCount: rows.length,
    entries: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      text: r.text,
      sourceSurface: r.source_surface,
      createdAt: new Date(r.created_at).toISOString(),
      supersededBy: r.superseded_by,
      ...(includeEmbeddings && r.embedding
        ? { embedding: parseVector(r.embedding) }
        : {}),
    })),
  };
}

/** CockroachDB renders VECTOR as `[1,2,3]`. */
export function parseVector(raw: string): number[] {
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(Number);
}

export class ImportFormatError extends Error {
  readonly code = 'IMPORT_FORMAT_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

export type ImportResult = {
  imported: number;
  skipped: number;
  reEmbedded: number;
  /** Entries whose supersede target was not in the bundle. */
  danglingSupersedes: number;
};

/**
 * Validate a bundle without touching the database.
 *
 * Split out so a caller can check a file before committing to a write, and so
 * the error messages are testable without a cluster.
 */
export function validateExport(bundle: unknown): MemoryExport {
  if (!bundle || typeof bundle !== 'object') {
    throw new ImportFormatError('bundle must be an object');
  }
  const b = bundle as Partial<MemoryExport>;
  if (b.format !== EXPORT_FORMAT) {
    throw new ImportFormatError(
      `unrecognised format "${String(b.format)}" (expected "${EXPORT_FORMAT}")`,
    );
  }
  // Major-version gate. 1.x stays readable; 2.0 would not be.
  const major = String(b.version ?? '').split('.')[0];
  if (major !== '1') {
    throw new ImportFormatError(
      `unsupported export version "${String(b.version)}" (this build reads 1.x)`,
    );
  }
  if (!Array.isArray(b.entries)) {
    throw new ImportFormatError('entries must be an array');
  }
  for (const [i, e] of b.entries.entries()) {
    if (!e || typeof e !== 'object') {
      throw new ImportFormatError(`entries[${i}] is not an object`);
    }
    if (typeof (e as ExportedEntry).text !== 'string' || !(e as ExportedEntry).text) {
      throw new ImportFormatError(`entries[${i}].text is required`);
    }
  }
  return b as MemoryExport;
}

/**
 * Import a bundle into a project.
 *
 * Entries are matched on `(kind, text)` rather than id: ids are per-cluster, and
 * re-importing the same bundle must not duplicate. Existing matches are skipped,
 * which makes import idempotent and safe to retry.
 *
 * Embeddings are reused when the bundle's model matches this deployment's;
 * otherwise each entry is re-embedded, because mixing vector spaces would make
 * cosine distance meaningless without failing loudly.
 */
export async function importProjectMemory(params: {
  db: DbClient;
  projectId: string;
  bundle: unknown;
  /** Rewrite provenance links to the newly-inserted ids. Default true. */
  preserveSupersedes?: boolean;
}): Promise<ImportResult> {
  const bundle = validateExport(params.bundle);
  const preserve = params.preserveSupersedes ?? true;

  const localModel = getTitanEmbedModelId();
  const canReuse =
    bundle.embeddingModel === localModel &&
    bundle.embeddingDimensions === EMBEDDING_DIMENSIONS;

  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    reEmbedded: 0,
    danglingSupersedes: 0,
  };

  /** old bundle id -> new row id, for rewriting the supersede chain. */
  const idMap = new Map<string, string>();

  for (const entry of bundle.entries) {
    const { rows: existing } = await params.db.query<{ id: string }>(
      `SELECT id FROM memory_entries
        WHERE project_id = $1::uuid AND kind = $2 AND text = $3
        LIMIT 1`,
      [params.projectId, entry.kind, entry.text],
    );
    if (existing[0]) {
      idMap.set(entry.id, existing[0].id);
      result.skipped++;
      continue;
    }

    let vector: number[] | null = null;
    if (canReuse && entry.embedding?.length === EMBEDDING_DIMENSIONS) {
      vector = entry.embedding;
    } else {
      // Costs one Bedrock call per entry. Counted so the caller can see it.
      vector = await embedText(entry.text);
      result.reEmbedded++;
    }

    const { rows: inserted } = await params.db.query<{ id: string }>(
      `INSERT INTO memory_entries (project_id, source_surface, kind, text, embedding, created_at)
       VALUES ($1::uuid, $2, $3, $4, $5::vector, $6)
       RETURNING id`,
      [
        params.projectId,
        entry.sourceSurface || 'imported',
        entry.kind,
        entry.text,
        formatVector(vector),
        // Original timestamp is kept: an import that stamped everything "now"
        // would destroy the ordering the memory layer reasons about.
        entry.createdAt ?? new Date().toISOString(),
      ],
    );
    idMap.set(entry.id, inserted[0]!.id);
    result.imported++;
  }

  if (preserve) {
    for (const entry of bundle.entries) {
      if (!entry.supersededBy) continue;
      const from = idMap.get(entry.id);
      const to = idMap.get(entry.supersededBy);
      if (!from || !to) {
        result.danglingSupersedes++;
        continue;
      }
      await params.db.query(
        `UPDATE memory_entries SET superseded_by = $2
          WHERE id = $1 AND project_id = $3::uuid AND superseded_by IS NULL`,
        [from, to, params.projectId],
      );
    }
  }

  return result;
}
