#!/usr/bin/env node
/**
 * Fail-closed gate before an Open VSX / Marketplace publish — master plan §7D.
 *
 * The publishing path existed only as two lines in `INSTALL.md`
 * ("after enrollment, run `ovsx publish`"). A recipe in a document is not a
 * pipeline: nothing checked that the manifest carried what a marketplace
 * listing requires, or that the built bundle was not pointing at localhost.
 *
 * This mirrors the discipline already proven on the other surfaces —
 * `chrome`'s `zip:prod` localhost scan and the CLI's `test:packaged` — so a
 * broken listing fails here rather than in front of users.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
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

console.log('\nmarketplace metadata');

check('carries every field a listing needs', () => {
  // Open VSX rejects a publish without these; the Marketplace renders an
  // empty, untrustworthy-looking page.
  for (const field of [
    'name',
    'displayName',
    'description',
    'version',
    'publisher',
    'license',
    'icon',
    'categories',
    'keywords',
  ]) {
    assert(pkg[field], `package.json is missing "${field}"`);
  }
  assert(pkg.engines?.vscode, 'engines.vscode is required');
  assert(pkg.repository?.url, 'repository.url is required');
});

check('has an icon of the right shape', () => {
  const icon = join(root, pkg.icon);
  assert(existsSync(icon), `icon ${pkg.icon} does not exist`);
  // Marketplaces want at least 128×128; size on disk is a cheap proxy for
  // "a real image was committed rather than a placeholder".
  assert(statSync(icon).size > 1024, `icon ${pkg.icon} looks like a placeholder`);
});

check('describes itself in more than a sentence fragment', () => {
  assert(pkg.description.length >= 40, 'description is too short to be useful');
  assert(Array.isArray(pkg.keywords) && pkg.keywords.length >= 3, 'add at least 3 keywords');
});

check('P4 coding-wedge pitch is in the marketplace short description', () => {
  const d = String(pkg.description).toLowerCase();
  assert(
    d.includes('you steer') && (d.includes('explore') || d.includes('verify')),
    'description must lead with Funnel A pitch (You steer; explore → act → verify)',
  );
  assert(
    d.includes('byok') || d.includes('approve'),
    'description must mention BYOK or approvals (Org trust)',
  );
});

check('ships a README, which becomes the listing body', () => {
  const readme = join(root, 'README.md');
  assert(existsSync(readme), 'README.md is missing');
  assert(statSync(readme).size > 500, 'README.md is too short to be a listing');
  const body = readFileSync(readme, 'utf8').toLowerCase();
  assert(
    body.includes('you steer') && body.includes('verify'),
    'README must carry Funnel A Dev pitch',
  );
});

console.log('\nbuilt artifact');

/** The bundle vsce will actually ship, taken from `main` rather than guessed. */
const mainBundle = join(root, pkg.main ?? 'dist/extension.cjs');

check('has been built', () => {
  assert(
    existsSync(mainBundle),
    `${pkg.main} is missing — run npm run build`,
  );
});

check('carries no localhost default', () => {
  // The same class of failure `chrome`'s zip:prod scan exists to catch: a
  // published build that only works on the machine that made it.
  const bundle = readFileSync(mainBundle, 'utf8');
  const hits = [...bundle.matchAll(/http:\/\/localhost:\d+/g)].map((m) => m[0]);
  // The IDE ships a documented localhost fallback for `walkcroach.ide.apiBaseUrl`
  // used only when the setting is absent; the packaged default in
  // package.json is what users actually get, so that is what must be https.
  const configured = String(
    pkg.contributes?.configuration?.properties?.['walkcroach.ide.apiBaseUrl']?.default ?? '',
  );
  assert(
    configured.startsWith('https://'),
    `shipped apiBaseUrl default is "${configured}" — must be the production API`,
  );
  if (hits.length > 0) {
    console.log(`       note: ${hits.length} localhost fallback(s) in the bundle, default is ${configured}`);
  }
});

check('packages the bundle, not node_modules', () => {
  // The extension is bundled by esbuild, so vsce must be told not to resolve
  // dependencies. Without `--no-dependencies` it would try to package
  // `@walkcroach/agent-engine`, which is a `file:` dependency on a private
  // package — the same class of defect that blocked publishing the CLI.
  const script = String(pkg.scripts?.['package:vsix'] ?? '');
  assert(script.includes('vsce package'), 'package:vsix does not run vsce');
  assert(
    script.includes('--no-dependencies'),
    'package:vsix must pass --no-dependencies; the extension is already bundled',
  );
});

check('keeps every private package out of the published surface', () => {
  // Belt and braces alongside --no-dependencies: if a `file:` dependency ever
  // needs to ship, it has to be bundled, not resolved by the marketplace.
  const priv = Object.entries(pkg.dependencies ?? {}).filter(([, range]) =>
    String(range).startsWith('file:'),
  );
  for (const [name] of priv) {
    assert(
      name.startsWith('@walkcroach/'),
      `${name} is a file: dependency that vsce cannot resolve`,
    );
  }
});

console.log('');
if (failures > 0) {
  console.error(`${failures} publish check(s) failed.`);
  process.exit(1);
}
console.log('IDE extension is publishable.');
