#!/usr/bin/env node
/**
 * Phase P4.2 — fail if OpenAPI MemoryKind enum drifts from memory-contracts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kindsSrc = readFileSync(join(here, '..', 'src', 'kinds.ts'), 'utf8');
const exportSrc = readFileSync(join(here, '..', 'src', 'export.ts'), 'utf8');
const openapi = readFileSync(
  join(here, '..', '..', 'sdk', 'openapi', 'v1.yaml'),
  'utf8',
);

const kindsMatch = kindsSrc.match(
  /export const MEMORY_KINDS = \[([\s\S]*?)\] as const/,
);
if (!kindsMatch) {
  console.error('Could not parse MEMORY_KINDS from kinds.ts');
  process.exit(1);
}
const contractKinds = [...kindsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const enumMatch = openapi.match(
  /MemoryKind:\s*\n\s*type: string\s*\n\s*enum: \[([^\]]+)\]/,
);
if (!enumMatch) {
  console.error('Could not parse MemoryKind enum from openapi/v1.yaml');
  process.exit(1);
}
const openapiKinds = enumMatch[1]
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let failed = false;
if (openapiKinds.join(',') !== contractKinds.join(',')) {
  console.error('MemoryKind drift:');
  console.error('  contracts:', contractKinds.join(', '));
  console.error('  openapi:  ', openapiKinds.join(', '));
  failed = true;
}

const formatMatch = exportSrc.match(
  /export const EXPORT_FORMAT = '([^']+)'/,
);
const versionMatch = exportSrc.match(
  /export const EXPORT_VERSION = '([^']+)'/,
);
if (!formatMatch || !versionMatch) {
  console.error('Could not parse EXPORT_FORMAT / EXPORT_VERSION');
  failed = true;
} else if (formatMatch[1] !== 'walkcroach-memory-export' || versionMatch[1] !== '1.0') {
  console.error(
    `Unexpected export constants: ${formatMatch[1]}/${versionMatch[1]}`,
  );
  failed = true;
}

// Harness must re-export contracts (no local EXPORT_FORMAT string literal).
const portability = readFileSync(
  join(
    here,
    '..',
    '..',
    '..',
    'infra-backend',
    'packages',
    'agent-harness',
    'src',
    'memory-portability.ts',
  ),
  'utf8',
);
if (!portability.includes("@walkcroach/memory-contracts")) {
  console.error('agent-harness memory-portability must import @walkcroach/memory-contracts');
  failed = true;
}
if (/export const EXPORT_FORMAT = 'walkcroach-memory-export'/.test(portability)) {
  console.error('agent-harness must not redefine EXPORT_FORMAT locally');
  failed = true;
}

const sdkTypes = readFileSync(
  join(here, '..', '..', 'sdk', 'src', 'types.ts'),
  'utf8',
);
if (!sdkTypes.includes("@walkcroach/memory-contracts")) {
  console.error('sdk types.ts must re-export from @walkcroach/memory-contracts');
  failed = true;
}
if (/export type MemoryKind =/.test(sdkTypes)) {
  console.error('sdk must not redefine MemoryKind locally');
  failed = true;
}

if (failed) process.exit(1);
console.log(
  `memory-contracts drift OK: kinds=[${contractKinds.join(',')}] export=${formatMatch[1]}/${versionMatch[1]}`,
);
