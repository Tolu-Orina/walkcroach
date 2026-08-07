import { ValidationError } from './errors.js';
import type { Transport } from './http.js';
import type {
  ImportResult,
  MemoryDiff,
  MemoryEntry,
  MemoryExport,
  MemoryKind,
  RecallHit,
  RememberResult,
} from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `projectId` is required on every read, and validated client-side.
 *
 * This is a correctness constraint, not ergonomics. The C-SPANN index is
 * prefixed on `(project_id, superseded_by)` and CockroachDB only uses a vector
 * index when every prefix column is constrained to a value. A recall that
 * omitted the project would still return correct rows — by scanning the whole
 * table. That failure is invisible until it is expensive, which is exactly how
 * it went unnoticed before migrations 026–032. Making it inexpressible is the
 * only durable fix.
 */
function assertProjectId(projectId: string | undefined): asserts projectId is string {
  if (!projectId || !UUID_RE.test(projectId)) {
    throw new ValidationError('projectId must be a uuid', 400, null, {
      field: 'projectId',
    });
  }
}

export type RecallOptions = {
  projectId: string;
  query: string;
  limit?: number;
  kinds?: MemoryKind[];
  surfaces?: string[];
};

/** Read-only view of memory at a past instant. */
export interface MemoryReader {
  recall(opts: RecallOptions): Promise<RecallHit[]>;
}

export class MemoryApi implements MemoryReader {
  constructor(
    private readonly transport: Transport,
    /** ISO instant when this is an `asOf` view; null for the present. */
    private readonly at: string | null = null,
  ) {}

  /**
   * Write a memory entry.
   *
   * Not available on an `asOf` view — see `asOf()`. The type system enforces
   * that: `MemoryReader` has no `remember`.
   */
  async remember(opts: {
    projectId: string;
    text: string;
    kind?: MemoryKind;
    surface?: string;
  }): Promise<RememberResult> {
    assertProjectId(opts.projectId);
    if (!opts.text?.trim()) {
      throw new ValidationError('text is required', 400, null, { field: 'text' });
    }
    return this.transport.request<RememberResult>('POST', '/v1/memory/entries', {
      body: {
        projectId: opts.projectId,
        text: opts.text,
        kind: opts.kind ?? 'decision',
        surface: opts.surface ?? 'sdk',
      },
    });
  }

  async recall(opts: RecallOptions): Promise<RecallHit[]> {
    assertProjectId(opts.projectId);
    if (!opts.query?.trim()) {
      throw new ValidationError('query is required', 400, null, { field: 'query' });
    }
    const res = await this.transport.request<{ hits: RecallHit[] }>(
      'POST',
      '/v1/memory/recall',
      {
        body: {
          projectId: opts.projectId,
          query: opts.query,
          limit: opts.limit ?? 5,
          kinds: opts.kinds,
          surfaces: opts.surfaces,
          asOf: this.at ?? undefined,
        },
      },
    );
    return res.hits ?? [];
  }

  async list(opts: {
    projectId: string;
    limit?: number;
    surfaces?: string[];
  }): Promise<MemoryEntry[]> {
    assertProjectId(opts.projectId);
    const res = await this.transport.request<{ entries: MemoryEntry[] }>(
      'GET',
      '/v1/memory/entries',
      {
        query: {
          projectId: opts.projectId,
          limit: opts.limit,
          surfaces: opts.surfaces?.join(','),
        },
      },
    );
    return res.entries ?? [];
  }

  /**
   * A read-only view of memory as it stood at `at`.
   *
   * Returns a `MemoryReader` rather than taking a parameter, so it is not
   * possible to accidentally pass a timestamp to a write.
   *
   * Bounded by the cluster's MVCC retention (`gc.ttlseconds`, currently 25h on
   * `memory_entries`). Past that, the server raises a ValidationError with code
   * `RETENTION_WINDOW_EXCEEDED` — the data is gone, not merely inaccessible.
   */
  asOf(at: Date | string): MemoryReader {
    // Validate before formatting: `toISOString()` THROWS a RangeError on an
    // invalid date rather than returning the string "Invalid Date", so checking
    // its output can never catch the bad input — it never gets that far.
    const date = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError(
        `asOf requires a valid timestamp, got ${JSON.stringify(String(at))}`,
        400,
        null,
        { field: 'at' },
      );
    }
    return new MemoryApi(this.transport, date.toISOString());
  }

  /**
   * Export everything this project remembers, as a portable JSON bundle.
   *
   * Includes superseded entries and their supersede links by default: those are
   * the provenance record, and an export of only current entries answers "what
   * do you believe now" but loses "what changed and why".
   *
   * Embeddings are included by default so the bundle can be imported exactly,
   * offline, without the destination needing the same inference provider. Pass
   * `embeddings: false` for a smaller, human-readable bundle that will be
   * re-embedded on import.
   */
  async export(opts: {
    projectId: string;
    embeddings?: boolean;
    superseded?: boolean;
  }): Promise<MemoryExport> {
    assertProjectId(opts.projectId);
    return this.transport.request<MemoryExport>('GET', '/v1/memory/export', {
      query: {
        projectId: opts.projectId,
        embeddings: opts.embeddings === false ? 'false' : undefined,
        superseded: opts.superseded === false ? 'false' : undefined,
      },
    });
  }

  /**
   * Import a bundle into a project.
   *
   * Idempotent: entries are matched on (kind, text), so re-importing the same
   * bundle skips rather than duplicates.
   */
  async import(opts: {
    projectId: string;
    bundle: MemoryExport | unknown;
    preserveSupersedes?: boolean;
  }): Promise<ImportResult> {
    assertProjectId(opts.projectId);
    return this.transport.request<ImportResult>('POST', '/v1/memory/import', {
      body: {
        projectId: opts.projectId,
        bundle: opts.bundle,
        preserveSupersedes: opts.preserveSupersedes,
      },
    });
  }

  /** What changed in the agent's beliefs between two instants. */
  async diff(opts: {
    projectId: string;
    from: Date | string;
    to?: Date | string | 'now';
  }): Promise<MemoryDiff> {
    assertProjectId(opts.projectId);
    // Same trap as asOf: toISOString throws rather than returning a sentinel.
    const iso = (v: Date | string, field: string): string => {
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) {
        throw new ValidationError(
          `${field} must be a valid timestamp, got ${JSON.stringify(String(v))}`,
          400,
          null,
          { field },
        );
      }
      return d.toISOString();
    };
    return this.transport.request<MemoryDiff>('POST', '/v1/memory/diff', {
      body: {
        projectId: opts.projectId,
        from: iso(opts.from, 'from'),
        to: opts.to && opts.to !== 'now' ? iso(opts.to, 'to') : undefined,
      },
    });
  }

  /**
   * Legal erase (ADR-0002): tombstone + redact. Never silent hard DELETE.
   * Requires `memory:write`.
   */
  async erase(opts: {
    projectId: string;
    reason: string;
    entryIds?: string[];
    exportFirst?: boolean;
  }): Promise<{
    projectId: string;
    erased: number;
    entryIds: string[];
    export: MemoryExport | null;
  }> {
    assertProjectId(opts.projectId);
    if (!opts.reason?.trim()) {
      throw new ValidationError('reason is required', 400, null, { field: 'reason' });
    }
    return this.transport.request('POST', '/v1/memory/erase', {
      body: {
        projectId: opts.projectId,
        reason: opts.reason,
        entryIds: opts.entryIds,
        exportFirst: opts.exportFirst,
      },
    });
  }

  /** Append-only control-plane audit for a project. Requires `memory:read`. */
  async audit(opts: {
    projectId: string;
    limit?: number;
  }): Promise<{
    projectId: string;
    events: Array<{
      id: string;
      action: string;
      entryId: string | null;
      actorKeyId: string | null;
      requestId: string | null;
      detail: unknown;
      createdAt: string;
    }>;
  }> {
    assertProjectId(opts.projectId);
    return this.transport.request('GET', '/v1/memory/audit', {
      query: {
        projectId: opts.projectId,
        limit: opts.limit,
      },
    });
  }
}
