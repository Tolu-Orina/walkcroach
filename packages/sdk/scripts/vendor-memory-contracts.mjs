#!/usr/bin/env node
/**
 * Copy `@walkcroach/memory-contracts` sources into this package before tsc.
 *
 * memory-contracts stays private and in-repo (VERSIONING.md). The published
 * SDK must not declare a `file:` dependency — installers cannot resolve it —
 * so we vendor the pure contract modules into `src/vendor/memory-contracts`
 * and compile them as part of this package.
 *
 * Source of truth remains `packages/memory-contracts`. Do not edit the vendor
 * tree by hand; re-run this script (build/test/typecheck all invoke it).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, '..', 'memory-contracts', 'src');
const destDir = join(root, 'src', 'vendor', 'memory-contracts');

if (!existsSync(srcDir)) {
  console.error(`memory-contracts sources missing at ${srcDir}`);
  process.exit(1);
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });

for (const name of readdirSync(srcDir)) {
  if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
  const from = join(srcDir, name);
  if (!statSync(from).isFile()) continue;
  cpSync(from, join(destDir, name));
}

console.log(`vendored memory-contracts → ${destDir}`);
