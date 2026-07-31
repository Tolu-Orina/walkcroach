#!/usr/bin/env node
/**
 * Prove the published artifact works, from outside the repo (C2.7).
 *
 * Every other test in this package runs against `src/` with the workspace's
 * `node_modules` on hand. That is exactly the environment a user does not
 * have, and it is why the whole class of packaging defects — a `file:`
 * dependency nobody can resolve, a stripped `dist/`, a missing shebang, a
 * runtime import left out of `dependencies` — is invisible to unit tests and
 * obvious on first install.
 *
 * So: pack it, install the tarball into a scratch directory with no
 * relationship to this repo, and run the binary the way a user would.
 *
 * Network is required — installing the tarball resolves real dependencies
 * from the registry, which is the point.
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// 1. Static checks on the manifest, before spending time on a real install.
// ---------------------------------------------------------------------------
console.log('\nmanifest');

check('is not marked private', () => {
  assert(pkg.private !== true, 'package.json still has "private": true — npm will refuse to publish');
});

check('declares no file: or link: dependency', () => {
  // The defect that blocked publishing outright: `file:../packages/agent-engine`
  // cannot be resolved by anyone installing from the registry.
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      assert(
        !String(range).startsWith('file:') && !String(range).startsWith('link:'),
        `${field}.${name} = "${range}" cannot be installed from the registry`,
      );
    }
  }
});

check('does not depend on a private @walkcroach package at runtime', () => {
  const runtime = { ...pkg.dependencies, ...pkg.optionalDependencies };
  const priv = Object.keys(runtime).filter((n) => n.startsWith('@walkcroach/'));
  assert(priv.length === 0, `unpublished packages in dependencies: ${priv.join(', ')}`);
});

check('points bin at a file the build produces', () => {
  const bin = pkg.bin?.walkcroach;
  assert(bin, 'no walkcroach bin entry');
  assert(existsSync(join(root, bin)), `${bin} does not exist — run npm run build`);
});

check('exposes no entry point the build does not emit', () => {
  for (const field of ['main', 'module', 'types']) {
    if (pkg[field]) {
      assert(existsSync(join(root, pkg[field])), `${field} → ${pkg[field]} is missing from the build`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Pack, and inspect the tarball's contents.
// ---------------------------------------------------------------------------
console.log('\npack');

const scratch = mkdtempSync(join(tmpdir(), 'wc-pack-'));
let tarball;

try {
  check('npm pack succeeds', () => {
    const out = execSync(`npm pack --pack-destination "${scratch}" --silent`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    tarball = join(scratch, out.trim().split('\n').pop().trim());
    assert(existsSync(tarball), `tarball not found at ${tarball}`);
  });

  check('tarball ships the bundle and the docs, and nothing else', () => {
    // `--ignore-scripts` so the prepack build does not print into the JSON we
    // are about to parse; the tarball was already built by the pack above.
    const listing = execSync(`npm pack --dry-run --json --ignore-scripts`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const start = listing.indexOf('[');
    assert(start >= 0, `npm pack --json produced no JSON:\n${listing}`);
    const files = JSON.parse(listing.slice(start))[0].files.map((f) => f.path);
    assert(files.includes('dist/bin.js'), 'dist/bin.js missing from the tarball');
    assert(
      !files.some((f) => f.startsWith('src/')),
      'source files are in the tarball; `files` is not restricting it',
    );
    assert(
      !files.some((f) => f.endsWith('.map')),
      'source maps are in the tarball and would point outside it',
    );
  });

  // -------------------------------------------------------------------------
  // 3. Install it somewhere with no connection to this repo, and run it.
  // -------------------------------------------------------------------------
  console.log('\ninstall + run (network)');

  const consumer = join(scratch, 'consumer');
  execSync(`mkdir "${consumer}"`, { stdio: 'ignore', shell: true });
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'wc-packaged-smoke', version: '1.0.0', private: true }, null, 2),
  );

  check('installs from the tarball with no workspace present', () => {
    execSync(`npm install --no-audit --no-fund --loglevel=error "${tarball}"`, {
      cwd: consumer,
      stdio: ['ignore', 'ignore', 'inherit'],
      timeout: 300_000,
    });
  });

  const binPath = join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'walkcroach.cmd' : 'walkcroach');
  const installed = join(consumer, 'node_modules', '@walkcroach', 'cli', 'dist', 'bin.js');

  check('installs an executable named walkcroach', () => {
    assert(existsSync(binPath), `no bin shim at ${binPath}`);
  });

  check('the installed entry point keeps its shebang', () => {
    const code = readFileSync(installed, 'utf8');
    assert(code.startsWith('#!'), 'shebang was stripped — the shim would not run');
  });

  // Run through node against the installed path: identical module resolution
  // to the shim, without depending on how the platform spells it.
  const run = (args, env = {}) =>
    execFileSync(process.execPath, [installed, ...args], {
      cwd: consumer,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, WALKCROACH_HOME: join(scratch, 'home'), ...env },
    });

  check('--version matches the packed version', () => {
    const out = run(['--version']).trim();
    assert(out === pkg.version, `reported ${out}, packed ${pkg.version}`);
  });

  check('--help lists the commands', () => {
    const out = run(['--help']);
    for (const cmd of ['run', 'auth', 'revert', 'memory', 'skills', 'secrets', 'doctor']) {
      assert(out.includes(cmd), `--help does not mention ${cmd}`);
    }
  });

  check('doctor runs and resolves the production API', () => {
    // The real proof that every runtime import survived: doctor touches
    // config, diagnostics, the credential store and the API client.
    const out = run(['--json', 'doctor']);
    const payload = JSON.parse(out.trim().split('\n').pop());
    assert(payload.name === 'doctor', 'unexpected doctor payload');
    assert(
      payload.data.apiBaseUrl.startsWith('https://'),
      `a published CLI must not default to ${payload.data.apiBaseUrl}`,
    );
    assert(payload.data.version === pkg.version, 'doctor reports a different version');
  });

  check('secrets list works, proving the optional native dep is optional', () => {
    // If @napi-rs/keyring failed to install on this platform, the CLI must
    // still run on the file backend rather than crash at import time.
    const out = run(['--json', 'secrets', 'list']);
    const payload = JSON.parse(out.trim().split('\n').pop());
    assert(['keychain', 'file'].includes(payload.data.backend), 'no credential backend reported');
  });

  check('a signed-out command still exits with the documented code', () => {
    try {
      run(['--json', 'projects']);
      throw new Error('expected a non-zero exit');
    } catch (err) {
      assert(err.status === 2, `expected exit 2 (auth required), got ${err.status}`);
    }
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('');
if (failures > 0) {
  console.error(`${failures} packaging check(s) failed.`);
  process.exit(1);
}
console.log('Packaged artifact verified.');
