import type { MemoryKind } from './kinds.js';

/** Listed / asOf memory row (SDK + harness list shapes). */
export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  text: string;
  surface: string;
  createdAt: string;
};

/**
 * SDK recall hit. `relevance` is 0–1 ordinal (not raw cosine).
 * Harness internally uses cosine distance; bridges convert.
 */
export type RecallHit = {
  id: string;
  kind: MemoryKind;
  text: string;
  surface: string;
  relevance: number | null;
};

/** Core write result — supersede visibility is mandatory for honest UX. */
export type SupersedeWriteResult = {
  id: string;
  supersededId: string | null;
};

/** Full remember response returned by `/v1/memory/remember`. */
export type RememberResult = SupersedeWriteResult & {
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
