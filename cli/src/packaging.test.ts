/**
 * Publishability invariants (C2).
 *
 * `npm run test:packaged` is the real proof — it installs a tarball outside
 * the repo and runs it — but it needs a network and takes a minute. These are
 * the same invariants asserted statically, so the mistake that would break an
 * install fails in the fast suite, in the commit that made it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

function readJson(rel: string): any {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

const pkg = readJson('package.json');

describe('package manifest', () => {
  it('is publishable at all', () => {
    expect(pkg.private).not.toBe(true);
    expect(pkg.publishConfig?.access).toBe('public');
  });

  it('declares no dependency npm cannot resolve from the registry', () => {
    // The defect that blocked publishing: `@walkcroach/agent-engine` was a
    // `file:` dependency on a private package. It is bundled now, and lives
    // in devDependencies where it cannot reach an installer.
    const runtime = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    } as Record<string, string>;
    for (const [name, range] of Object.entries(runtime)) {
      expect(range, name).not.toMatch(/^(file|link):/);
      expect(name).not.toMatch(/^@walkcroach\//);
    }
  });

  it('keeps every private package as a bundled devDependency', () => {
    // Both are inlined by the build, so neither may reach an installer.
    expect(pkg.devDependencies['@walkcroach/agent-engine']).toMatch(/^file:/);
    expect(pkg.devDependencies['@walkcroach/templates']).toMatch(/^file:/);
  });

  it('declares the engine runtime imports it no longer inherits', () => {
    // Bundling the engine makes its imports ours. Leaving them undeclared
    // would install cleanly and crash on first run.
    const engine = readJson('../packages/agent-engine/package.json');
    for (const dep of Object.keys(engine.dependencies ?? {})) {
      expect(pkg.dependencies[dep], `${dep} is imported by the bundled engine`).toBeTruthy();
    }
  });

  it('treats every native module as optional', () => {
    // A platform with no prebuilt binary must still install and run — on the
    // pipe terminal backend and the file credential store.
    expect(pkg.optionalDependencies['@napi-rs/keyring']).toBeTruthy();
    expect(pkg.dependencies['@napi-rs/keyring']).toBeUndefined();
    expect(pkg.dependencies['node-pty']).toBeUndefined();
  });

  it('ships only the bundle and its docs', () => {
    expect(pkg.files).toEqual(['dist', 'README.md', 'CHANGELOG.md']);
    expect(pkg.files).not.toContain('src');
  });

  it('advertises no entry point beyond the binary', () => {
    // A `main` pointing at a file esbuild does not emit would be a broken
    // manifest that only fails for whoever imports it.
    //
    // No leading `./`: npm rewrites `./dist/bin.js` to `dist/bin.js` during
    // publish and warns that it "cleaned" the name. Pinning the pre-normalised
    // form meant the published manifest differed from this one and the warning
    // recurred on every release, so the normalised form is the one to hold.
    expect(pkg.bin.walkcroach).toBe('dist/bin.js');
    expect(pkg.main).toBeUndefined();
    expect(pkg.exports).toBeUndefined();
  });

  it('carries the metadata a registry listing needs', () => {
    expect(pkg.description).toBeTruthy();
    expect(pkg.license).toBeTruthy();
    expect(pkg.repository?.url).toContain('github.com');
    expect(pkg.repository?.directory).toBe('cli');
    expect(pkg.homepage).toMatch(/^https:/);
    expect(pkg.engines.node).toBe('>=20');
  });

  it('rebuilds before packing, so a stale bundle cannot ship', () => {
    expect(pkg.scripts.prepack).toBe('npm run build');
  });
});

describe('release wiring', () => {
  it('publishes over OIDC rather than a stored token', () => {
    const workflow = readFileSync(
      join(root, '..', '.github', 'workflows', 'publish-cli.yml'),
      'utf8',
    );
    expect(workflow).toContain('id-token: write');
    // A long-lived automation token is the credential trusted publishing
    // exists to remove. Asserting on `${{ secrets.` rather than on token
    // *names* is what distinguishes using one from explaining why we do not:
    // the prose in this workflow names NODE_AUTH_TOKEN precisely to say it is
    // absent.
    expect(workflow).not.toContain('${{ secrets.');
  });

  it('runs the packaged-artifact gate in CI, not just locally', () => {
    const buildspec = readFileSync(join(root, 'buildspec.yml'), 'utf8');
    expect(buildspec).toContain('npm run test:packaged');
    expect(buildspec).toContain('localhost:3003');
  });

  it('builds every bundled private package before the CLI, in both CI paths', () => {
    // A stale `dist/` in one of these ships stale code with no error anywhere,
    // which is the least debuggable failure in this whole pipeline.
    const buildspec = readFileSync(join(root, 'buildspec.yml'), 'utf8');
    const workflow = readFileSync(
      join(root, '..', '.github', 'workflows', 'publish-cli.yml'),
      'utf8',
    );
    for (const name of Object.keys(pkg.devDependencies as Record<string, string>).filter(
      (n) => n.startsWith('@walkcroach/'),
    )) {
      const dir = name.replace('@walkcroach/', '');
      expect(buildspec, `buildspec does not build ${name}`).toContain(dir);
      expect(workflow, `publish workflow does not build ${name}`).toContain(dir);
    }
  });
});
