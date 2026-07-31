#!/usr/bin/env node
/**
 * Production build (C2.2).
 *
 * ## Why bundle at all
 *
 * `cli/package.json` depends on `@walkcroach/agent-engine` via
 * `file:../packages/agent-engine`, and that package is `private: true`. A
 * `file:` dependency cannot be resolved by anyone installing from the
 * registry, so publishing is impossible until the engine is either published
 * or inlined. Inlining is the choice (see docs/walkcroach-cli-imp-plan.md
 * §C2.1): one artifact, one version, and the engine's interface stays free to
 * move without a release.
 *
 * ## What is *not* bundled, and why
 *
 * Only the private package needs inlining. Every published dependency stays
 * external and is declared in `package.json`, because bundling them would
 * mean:
 *   - shipping a copy of the AWS SDK that npm can neither dedupe nor patch,
 *   - a security update requiring a WalkCroach release rather than an
 *     `npm update`,
 *   - and, for `ink`/`react`, bundling a renderer whose behaviour the packaged
 *     smoke test cannot exercise without a TTY.
 *
 * Native modules must be external regardless: `node-pty` and `@napi-rs/keyring`
 * load platform binaries, and both are optional — the engine falls back to a
 * pipe terminal, and the CLI falls back to the 0600 file store.
 */
import { build } from 'esbuild';
import { readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'dist', 'bin.js');

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

/**
 * Externals are derived from package.json rather than hand-listed, so a new
 * dependency cannot be silently inlined by forgetting to update this file.
 * `@walkcroach/*` is deliberately excluded: those are the private packages
 * this build exists to inline.
 */
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  // Optional native terminal backends, pulled in dynamically by the engine.
  'node-pty',
  'node-pty-prebuilt-multiarch',
].filter((name) => !name.startsWith('@walkcroach/'));

/** Budget, in KB. A jump means something large was pulled in by accident. */
const MAX_BUNDLE_KB = 900;

await rm(join(root, 'dist'), { recursive: true, force: true });

const result = await build({
  entryPoints: [join(root, 'src', 'bin.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  // ESM because the source uses top-level await and the engine ships ESM.
  format: 'esm',
  target: 'node20',
  external,
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

// A shebang is what makes `walkcroach` runnable from a shell. esbuild keeps a
// leading one, but "usually keeps it" is not a property worth trusting in the
// artifact people install — assert it, and add it back if it is missing.
let code = await readFile(outfile, 'utf8');
if (!code.startsWith('#!')) {
  code = `#!/usr/bin/env node\n${code}`;
  await writeFile(outfile, code, 'utf8');
}
// npm sets the executable bit on bin entries at install time; doing it here
// keeps `node dist/bin.js` and `./dist/bin.js` equivalent in the repo too.
try {
  await chmod(outfile, 0o755);
} catch {
  // Windows has no executable bit.
}

const bytes = Buffer.byteLength(code, 'utf8');
const kb = Math.round(bytes / 1024);

// Fail the build rather than the install: a bundle that accidentally inlined
// a published dependency should never reach a tarball.
const inlinedExternal = external.filter((name) =>
  Object.keys(result.metafile.inputs).some((input) =>
    input.includes(`node_modules/${name}/`),
  ),
);
if (inlinedExternal.length > 0) {
  console.error(
    `Bundle inlined packages that must stay external: ${inlinedExternal.join(', ')}`,
  );
  process.exit(1);
}

if (kb > MAX_BUNDLE_KB) {
  console.error(`Bundle is ${kb}KB, over the ${MAX_BUNDLE_KB}KB budget.`);
  process.exit(1);
}

if (!existsSync(outfile)) {
  console.error('Build produced no output.');
  process.exit(1);
}

console.log(`dist/bin.js  ${kb}KB  (budget ${MAX_BUNDLE_KB}KB)`);
console.log(`external: ${external.join(', ')}`);
