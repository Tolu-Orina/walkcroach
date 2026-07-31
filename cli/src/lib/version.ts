/**
 * The single source of truth for the CLI version (C0.4).
 *
 * `bin.ts` used to carry a hardcoded `'0.1.0'` alongside `package.json`'s own
 * version, which is a copy that silently goes stale — the same drift already
 * found between the Chrome store packet and its manifest. There is now one
 * value, and `surface.test.ts` asserts `--version` still equals it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@walkcroach/cli';

/**
 * Walk up from this module looking for our own `package.json`.
 *
 * Deliberately not a fixed `../../package.json`: that holds for `src/lib/` and
 * for `dist/lib/`, but breaks the moment the build is bundled to a single
 * `dist/bin.js` (planned in C2.2). Searching by package *name* keeps this
 * correct across both layouts, and refuses to read a neighbouring package's
 * version if the search ever wanders.
 */
function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version;
    } catch {
      // Not here, or not readable — keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Reaching here means the package metadata is missing from the install.
  // `0.0.0-unknown` is a valid semver that no release will ever equal, so it
  // shows up as obviously wrong rather than impersonating a real version.
  return '0.0.0-unknown';
}

export const CLI_VERSION = readVersion();
