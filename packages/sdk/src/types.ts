/** Kinds accepted by the memory layer. Mirrors the server-side `MemoryKind`. */
export type MemoryKind =
  | 'decision'
  | 'preference'
  | 'convention'
  | 'summary'
  | 'capture'
  | 'qa';

export type WalkCroachConfig = {
  /** Service-account key (`wc_live_…`). Server-side only. */
  apiKey?: string;
  /** Cognito token, for user-context calls. Mutually exclusive with apiKey. */
  accessToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
  retry?: { attempts?: number };
  /** Injectable for tests and for runtimes without a global fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Escape hatch for non-browser runtimes that define `window`. Leave unset in
   * anything served to end users.
   */
  allowBrowserApiKey?: boolean;
};

export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  text: string;
  surface: string;
  createdAt: string;
};

export type RecallHit = {
  id: string;
  kind: MemoryKind;
  text: string;
  surface: string;
  /**
   * 0–1, higher is closer. Deliberately not the raw cosine distance: that is an
   * index implementation detail and the opclass has already had to change once
   * (migrations 028/029). Treat it as ordinal, not as a calibrated probability.
   */
  relevance: number | null;
};

export type RememberResult = {
  id: string;
  /**
   * Set when this write retired a near-duplicate of the same kind.
   *
   * Surface it to your user — "noted, this replaces your earlier note about X".
   * The supersede threshold is a judgement call rather than an eval-backed
   * constant, so a visible supersede is correctable and a silent one is not.
   */
  supersededId: string | null;
  projectId: string;
  kind: MemoryKind;
  surface: string;
};

export type MemoryDiff = {
  from: string;
  to: string;
  added: MemoryEntry[];
  /** Live at `from`, not live at `to`. */
  retired: MemoryEntry[];
  unchanged: number;
};

/** One entry in a portable bundle. Mirrors the on-disk format exactly. */
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
 * `walkcroach-memory-export/1.0`.
 *
 * A documented, self-describing envelope. `embeddingModel` records what produced
 * the vectors so a destination on a different model knows it must re-embed
 * rather than silently mixing incompatible vector spaces.
 */
export type MemoryExport = {
  format: 'walkcroach-memory-export';
  version: string;
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

/**
 * What a run may change in the target repository.
 *
 * Required, with no default. Publishing into a customer's production repo is
 * `additive`; an app builder that owns its workspace is `full`. A safe default
 * would be silent, a permissive one dangerous — so you choose.
 */
export type WriteScope =
  | { mode: 'additive' }
  | { mode: 'scoped'; allow: string[] }
  | { mode: 'full' };

export type PublishSource = {
  kind: 'markdown' | 'docx' | 'pdf' | 'html';
  /** Raw bytes (base64) or already-extracted text. */
  content: string;
  encoding?: 'utf8' | 'base64';
  filename?: string;
  title?: string;
};

export type PublishResult = {
  ok: boolean;
  pullRequest?: { number: number; url: string; branch: string; commitSha: string };
  filesWritten: string[];
  /** Prompt-injection heuristics that matched the source document. */
  signals: Array<{ pattern: string; excerpt: string }>;
  /** Patterns in generated files that warrant a closer look. */
  flags: Array<{ rule: string; path: string; excerpt: string }>;
  /** Anything policy or write-scope refused. */
  refusals: Array<{ rule: string; reason: string; subject: string }>;
  /** House-style conventions newly written to memory. */
  learned: string[];
  reason: string;
  error?: string;
};

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type RunEvent = {
  seq: number;
  at: string;
  type: string;
  payload: Record<string, unknown>;
};

export type RunSnapshot = {
  runId: string;
  status: RunStatus;
  kind: string;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: PublishResult | null;
  error: string | null;
  events: RunEvent[];
  lastSeq: number;
  /** Server-chosen backoff, so clients need not invent one. */
  pollAfterMs: number;
};

export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};
