/**
 * Dual-loop memory contracts (Phase 4).
 *
 * Shared by `@walkcroach/sdk` (public client), `@walkcroach/agent-harness`
 * (Web/Chrome SoR), and optionally `@walkcroach/agent-engine` (IDE/CLI bridge).
 * Types-only + pure validators — no Bedrock, DB, or vscode imports.
 *
 * One broken memory semantic must not be fixable on only one loop: both
 * consume these definitions; drift CI asserts OpenAPI + fixtures stay aligned.
 */
export {
  MEMORY_KINDS,
  type MemoryKind,
  isMemoryKind,
  normalizeMemoryKind,
} from './kinds.js';

export {
  MEMORY_SURFACES,
  type MemorySurface,
  isMemorySurface,
} from './surfaces.js';

export {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  EXPORT_VERSION_MAJOR,
  EMBEDDING_DIMENSIONS,
  type ExportedEntry,
  type MemoryExport,
  type ImportResult,
  ImportFormatError,
  validateExport,
} from './export.js';

export {
  type MemoryEntry,
  type RecallHit,
  type RememberResult,
  type SupersedeWriteResult,
  type MemoryDiff,
} from './memory.js';

export {
  type SharedMemoryUiEvent,
} from './ui-events.js';
