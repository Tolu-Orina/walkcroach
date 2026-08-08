#!/usr/bin/env node
/**
 * Phase P0.2 — fail if OpenAPI path roots drift from SDK_ROOT_SEGMENTS /
 * handler surface.
 *
 * Run from packages/sdk: `node scripts/check-openapi-drift.mjs`
 * Or from repo via ide-api test script.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const openapiPath = join(here, '..', 'openapi', 'v1.yaml');
const contractPath = join(
  here,
  '..',
  '..',
  '..',
  'infra-backend',
  'modules',
  'lambda-ide',
  'codes',
  'src',
  'sdk-contract.ts',
);

const openapi = readFileSync(openapiPath, 'utf8');
const contract = readFileSync(contractPath, 'utf8');

const openapiRoots = new Set();
for (const line of openapi.split('\n')) {
  const m = line.match(/^  \/([a-z0-9-]+)/);
  if (m) openapiRoots.add(m[1]);
}

const segMatch = contract.match(
  /export const SDK_ROOT_SEGMENTS = \[([\s\S]*?)\] as const/,
);
if (!segMatch) {
  console.error('Could not parse SDK_ROOT_SEGMENTS from sdk-contract.ts');
  process.exit(1);
}
const contractRoots = new Set(
  [...segMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
);

// OpenAPI documents /health as ide-local alias; contract includes it.
// APIGW mounts /sdk-health instead of stealing agent /health.
const requiredInBoth = ['keys', 'memory', 'content', 'graphs', 'runs', 'sdk-health'];
const missingOpenapi = requiredInBoth.filter((r) => !openapiRoots.has(r));
const missingContract = requiredInBoth.filter((r) => !contractRoots.has(r));

let failed = false;
if (missingOpenapi.length) {
  console.error('OpenAPI missing roots:', missingOpenapi.join(', '));
  failed = true;
}
if (missingContract.length) {
  console.error('sdk-contract missing roots:', missingContract.join(', '));
  failed = true;
}
if (!openapiRoots.has('health')) {
  console.error('OpenAPI must document /health (ide-local alias)');
  failed = true;
}
if (!contractRoots.has('health')) {
  console.error('sdk-contract must include health');
  failed = true;
}

const retentionMatch = contract.match(
  /MEMORY_ASOF_RETENTION_SECONDS = ([\d_]+)/,
);
const openapiRetention = openapi.match(/asOfSeconds:[\s\S]*?enum: \[(\d+)\]/);
if (!retentionMatch || !openapiRetention) {
  console.error('Could not compare retention constants');
  failed = true;
} else {
  const contractSeconds = retentionMatch[1].replace(/_/g, '');
  if (contractSeconds !== openapiRetention[1]) {
    console.error(
      `Retention drift: contract=${contractSeconds} openapi=${openapiRetention[1]}`,
    );
    failed = true;
  }
}

if (!openapi.includes('/content/ensure-project:')) {
  console.error('OpenAPI missing /content/ensure-project');
  failed = true;
}
if (!openapi.includes('PublishContentRequest')) {
  console.error('OpenAPI missing PublishContentRequest schema');
  failed = true;
}

if (failed) {
  console.error('OpenAPI ↔ sdk-contract drift check FAILED');
  process.exit(1);
}

console.log('OpenAPI ↔ sdk-contract drift check OK');
console.log('  roots:', [...contractRoots].sort().join(', '));
console.log(
  '  retention seconds:',
  retentionMatch ? retentionMatch[1].replace(/_/g, '') : '?',
);
