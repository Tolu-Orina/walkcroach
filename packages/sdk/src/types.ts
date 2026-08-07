/**
 * SDK public types. Memory kinds / export / remember shapes come from
 * `@walkcroach/memory-contracts` (Phase 4) — do not redefine them here.
 */
export {
  MEMORY_KINDS,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  EMBEDDING_DIMENSIONS,
  type MemoryKind,
  type MemoryEntry,
  type RecallHit,
  type RememberResult,
  type SupersedeWriteResult,
  type MemoryDiff,
  type ExportedEntry,
  type MemoryExport,
  type ImportResult,
  type MemorySurface,
  type SharedMemoryUiEvent,
  normalizeMemoryKind,
  isMemoryKind,
  validateExport,
  ImportFormatError,
} from '@walkcroach/memory-contracts';

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

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type { InterruptKind, RunInterrupt, ResumeRequest } from './interrupt.js';

export type RunEvent = {
  seq: number;
  at: string;
  type: string;
  payload: Record<string, unknown>;
};

export type RunSnapshot = {
  runId: string;
  /** LangGraph-style alias — equals runId for content runs. */
  threadId: string;
  status: RunStatus;
  kind: string;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: PublishResult | null;
  error: string | null;
  /** Present when status === 'interrupted'. */
  interrupt: import('./interrupt.js').RunInterrupt | null;
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
