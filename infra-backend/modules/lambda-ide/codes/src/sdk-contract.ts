/**
 * Public SDK contract constants (Phase P0).
 *
 * Kept in one module so OpenAPI drift checks, /v1/health, and docs cannot
 * silently disagree about retention or advertised capabilities.
 *
 * `MEMORY_ASOF_RETENTION_SECONDS` must match migration
 * `034_memory_retention.sql` (`gc.ttlseconds = 90000`).
 */

/** MVCC window on `memory_entries` — past this, AS OF data is GC'd, not hidden. */
export const MEMORY_ASOF_RETENTION_SECONDS = 90_000;

export const SDK_PROTOCOL_VERSION = 'v1';

/**
 * Capabilities advertised by GET /v1/health (and /v1/sdk-health).
 * Order is stable for prompt-cache / drift-check friendliness.
 */
export const SDK_CAPABILITIES = [
  'memory:read',
  'memory:write',
  'memory:asOf',
  'memory:diff',
  'memory:export',
  'memory:import',
  'memory:erase',
  'memory:audit',
  'keys:manage',
  'content:publish',
  'content:run',
  'graphs:run',
  'runs:read',
  'projects:ensure',
] as const;

export type SdkCapability = (typeof SDK_CAPABILITIES)[number];

/** Paths that belong to the public SDK surface after stage/v1 normalization. */
export const SDK_ROOT_SEGMENTS = [
  'memory',
  'keys',
  'health',
  'sdk-health',
  'content',
  'graphs',
  'runs',
] as const;
