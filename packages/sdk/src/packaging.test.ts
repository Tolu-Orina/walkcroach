/**
 * Publishability invariants for `@walkcroach/sdk`.
 *
 * The published package must not carry a private `file:` dependency —
 * `@walkcroach/memory-contracts` is vendored at build time instead.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>;
}

const pkg = readJson('package.json');

describe('package manifest', () => {
  it('is publishable at all', () => {
    expect(pkg.private).not.toBe(true);
    expect(pkg.publishConfig).toMatchObject({ access: 'public' });
  });

  it('declares no dependency npm cannot resolve from the registry', () => {
    const runtime = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.optionalDependencies as Record<string, string> | undefined),
      ...(pkg.peerDependencies as Record<string, string> | undefined),
    };
    for (const [name, range] of Object.entries(runtime)) {
      expect(range, name).not.toMatch(/^(file|link):/);
      expect(name).not.toMatch(/^@walkcroach\//);
    }
  });

  it('keeps memory-contracts out of published dependencies', () => {
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    expect(deps['@walkcroach/memory-contracts']).toBeUndefined();
  });

  it('vendors contracts before packing', () => {
    expect(pkg.scripts).toMatchObject({
      'vendor:contracts': 'node scripts/vendor-memory-contracts.mjs',
      prepack: 'npm run build',
    });
    expect(String((pkg.scripts as Record<string, string>).build)).toContain(
      'vendor:contracts',
    );
  });

  it('ships only dist, docs, and openapi', () => {
    expect(pkg.files).toEqual(['dist', 'README.md', 'openapi']);
  });
});

describe('vendor sync', () => {
  it('copies memory-contracts sources into src/vendor before tests run', () => {
    expect(existsSync(join(root, 'src/vendor/memory-contracts/index.ts'))).toBe(
      true,
    );
    expect(existsSync(join(root, 'src/vendor/memory-contracts/kinds.ts'))).toBe(
      true,
    );
  });
});
