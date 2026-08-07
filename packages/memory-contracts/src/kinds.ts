/**
 * Canonical memory kinds — single source for SDK, harness, OpenAPI, bridges.
 * Order matches OpenAPI `MemoryKind` enum (do not reshuffle without updating
 * openapi/v1.yaml and the drift test).
 */
export const MEMORY_KINDS = [
  'decision',
  'preference',
  'convention',
  'summary',
  'capture',
  'qa',
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

const KIND_SET = new Set<string>(MEMORY_KINDS);

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

/**
 * Coerce model / client input to a known kind.
 * Unknown values fall back to `fallback` (default `decision`) — shared policy
 * so harness and SDK bridges cannot diverge on garbage kinds.
 */
export function normalizeMemoryKind(
  raw: unknown,
  fallback: MemoryKind = 'decision',
): MemoryKind {
  if (typeof raw !== 'string') return fallback;
  const k = raw.trim().toLowerCase();
  return isMemoryKind(k) ? k : fallback;
}
