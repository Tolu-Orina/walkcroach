/**
 * Provenance surfaces recorded on memory_entries.source_surface.
 * Matches the six product surfaces (plus `imported` / `sdk` callers may use).
 */
export const MEMORY_SURFACES = [
  'web',
  'chrome',
  'ide',
  'cli',
  'desktop',
  'sdk',
] as const;

export type MemorySurface = (typeof MEMORY_SURFACES)[number];

const SURFACE_SET = new Set<string>(MEMORY_SURFACES);

export function isMemorySurface(value: unknown): value is MemorySurface {
  return typeof value === 'string' && SURFACE_SET.has(value);
}
