import type { MemoryKind } from './kinds.js';
import { isMemoryKind } from './kinds.js';

/** Portable envelope name — never change without a major version bump. */
export const EXPORT_FORMAT = 'walkcroach-memory-export' as const;

/** Current export document version (`walkcroach-memory-export/1.0`). */
export const EXPORT_VERSION = '1.0' as const;

/** Major gate for validateExport — 1.x stays readable. */
export const EXPORT_VERSION_MAJOR = '1' as const;

/** Titan Embeddings V2 dimensions for this deployment. */
export const EMBEDDING_DIMENSIONS = 1024 as const;

export type ExportedEntry = {
  id: string;
  kind: MemoryKind;
  text: string;
  sourceSurface: string;
  createdAt: string;
  /** The entry that replaced this one, or null if current. */
  supersededBy: string | null;
  embedding?: number[];
};

/**
 * Self-describing portable bundle.
 * `embeddingModel` records what produced vectors so a different destination
 * knows it must re-embed rather than silently mixing spaces.
 */
export type MemoryExport = {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION | string;
  exportedAt: string;
  projectId: string;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  entryCount: number;
  entries: ExportedEntry[];
};

export type ImportResult = {
  imported: number;
  /** Already present, matched on (kind, text). Import is idempotent. */
  skipped: number;
  /** Needed a fresh inference call because the source model differed. */
  reEmbedded: number;
  /** Supersede links whose target was not in the bundle. */
  danglingSupersedes: number;
};

export class ImportFormatError extends Error {
  readonly code = 'IMPORT_FORMAT_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

/**
 * Validate a bundle without touching the database.
 * Shared by harness import and SDK-side preflight / drift fixtures.
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
  const major = String(b.version ?? '').split('.')[0];
  if (major !== EXPORT_VERSION_MAJOR) {
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
    const entry = e as Partial<ExportedEntry>;
    if (typeof entry.text !== 'string' || !entry.text) {
      throw new ImportFormatError(`entries[${i}].text is required`);
    }
    if (entry.kind !== undefined && !isMemoryKind(entry.kind)) {
      throw new ImportFormatError(
        `entries[${i}].kind "${String(entry.kind)}" is not a MemoryKind`,
      );
    }
  }
  return b as MemoryExport;
}
