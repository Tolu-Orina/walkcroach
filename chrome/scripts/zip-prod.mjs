#!/usr/bin/env node
/**
 * Production Chrome Web Store zip.
 * Bakes live API + privacy URLs; refuses localhost; verifies the artifact.
 *
 * Usage (from chrome/):
 *   npm run zip:prod
 *
 * Override defaults:
 *   WALKCROACH_API_BASE=... WALKCROACH_PRIVACY_URL=... npm run zip:prod
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

const DEFAULT_API =
  'https://api.walkcroach.rinegansolutions.com/v1';
const DEFAULT_PRIVACY =
  'https://walkcroach.rinegansolutions.com/chrome-privacy.html';
const DEFAULT_WEB = 'https://walkcroach.rinegansolutions.com';

const apiBase = (process.env.WALKCROACH_API_BASE ?? DEFAULT_API).replace(
  /\/$/,
  '',
);
const privacyUrl = process.env.WALKCROACH_PRIVACY_URL ?? DEFAULT_PRIVACY;
const webUrl = (process.env.WALKCROACH_WEB_URL ?? DEFAULT_WEB).replace(
  /\/$/,
  '',
);

function fail(msg) {
  console.error(`zip:prod error: ${msg}`);
  process.exit(1);
}

function assertHttpsUrl(label, value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail(`${label} is not a valid URL: ${value}`);
  }
  if (u.protocol !== 'https:') {
    fail(`${label} must be https (got ${u.protocol}): ${value}`);
  }
  if (
    u.hostname === 'localhost' ||
    u.hostname === '127.0.0.1' ||
    u.hostname.endsWith('.local')
  ) {
    fail(`${label} must not point at localhost: ${value}`);
  }
}

assertHttpsUrl('WALKCROACH_API_BASE', apiBase);
assertHttpsUrl('WALKCROACH_PRIVACY_URL', privacyUrl);
assertHttpsUrl('WALKCROACH_WEB_URL', webUrl);

if (!apiBase.includes('/v1')) {
  console.warn(
    'zip:prod warning: WALKCROACH_API_BASE usually ends with /v1 (API Gateway stage)',
  );
}

console.log('zip:prod API     =', apiBase);
console.log('zip:prod privacy =', privacyUrl);
console.log('zip:prod web     =', webUrl);

const env = {
  ...process.env,
  WALKCROACH_API_BASE: apiBase,
  WALKCROACH_PRIVACY_URL: privacyUrl,
  WALKCROACH_WEB_URL: webUrl,
  WALKCROACH_REQUIRE_PROD_ENV: 'true',
};

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(' ')} exited ${r.status}`);
  }
}

run('npm', ['run', 'typecheck']);
run('npm', ['run', 'test']);
run('npm', ['run', 'zip']);

const outputDir = join(root, '.output');
if (!existsSync(outputDir)) fail('.output missing after zip');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = walk(outputDir);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const expectedZipName = `walkcroachchrome-${pkg.version}-chrome.zip`;
const zip =
  files.find((f) => f.replace(/\\/g, '/').endsWith(expectedZipName)) ??
  files
    .filter((f) => f.endsWith('.zip'))
    .sort(
      (a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs,
    )[0];
if (!zip) fail('no .zip found under .output');
if (!zip.replace(/\\/g, '/').endsWith(expectedZipName)) {
  console.warn(
    `zip:prod warning: expected ${expectedZipName}, using ${zip}`,
  );
}

const manifestPath = join(outputDir, 'chrome-mv3', 'manifest.json');
if (!existsSync(manifestPath)) fail('chrome-mv3/manifest.json missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const apiOrigin = `${new URL(apiBase).protocol}//${new URL(apiBase).host}/*`;
const hosts = Array.isArray(manifest.host_permissions)
  ? manifest.host_permissions
  : [];
if (!hosts.includes(apiOrigin)) {
  fail(
    `manifest host_permissions must include API origin ${apiOrigin} (got ${JSON.stringify(hosts)})`,
  );
}
if (hosts.some((h) => h === 'https://*/*' || h === 'http://*/*' || h === '<all_urls>')) {
  fail('manifest must not include broad page host permissions');
}
if (manifest.content_scripts) {
  fail('manifest must not include content_scripts (path B)');
}
/**
 * `optional_host_permissions` is deliberately broad, and must stay that way.
 *
 * This check previously refused the broad http/https wildcard patterns here —
 * the same rule as the `host_permissions` check above, applied to the wrong
 * field. That made a store build impossible: it rejected the exact pattern
 * `wxt.config.ts` sets on purpose and `store/PERMISSION_JUSTIFICATIONS.md`
 * justifies to reviewers.
 *
 * The distinction the install-time check is protecting is real, and the reason
 * both fields cannot share a rule:
 *
 *   host_permissions           granted at INSTALL. Broad here means Chrome shows
 *                              "read and change all your data on all websites",
 *                              and the extension holds it whether used or not.
 *   optional_host_permissions  granted at USE, one origin at a time, via
 *                              chrome.permissions.request, revocable per site.
 *                              Broad here means "may ask about any site", not
 *                              "has access to any site".
 *
 * A side panel cannot rely on `activeTab` — Chrome does not grant it for clicks
 * inside the panel — so per-origin optional permissions are the documented
 * alternative. Narrowing this field would not make the extension safer; it would
 * limit it to a fixed site list while leaving the trust model unchanged.
 *
 * What genuinely must never appear is `<all_urls>`, which is not equivalent:
 * it additionally covers ftp:, file: and other schemes the panel has no business
 * touching, and reviewers read it as a much broader ask.
 */
const optionalHosts = Array.isArray(manifest.optional_host_permissions)
  ? manifest.optional_host_permissions
  : [];
if (optionalHosts.includes('<all_urls>')) {
  fail('manifest must not include <all_urls> in optional_host_permissions');
}

const textFiles = files.filter((f) =>
  /\.(js|html|json|css|mjs)$/i.test(f),
);
let sawApi = false;
let sawPrivacy = false;
let sawWeb = false;
for (const f of textFiles) {
  const body = readFileSync(f, 'utf8');
  if (
    body.includes('localhost:3002') ||
    body.includes('localhost:5173') ||
    body.includes('http://localhost')
  ) {
    fail(`localhost still present in ${f}`);
  }
  if (body.includes(apiBase)) sawApi = true;
  if (body.includes(privacyUrl)) sawPrivacy = true;
  if (body.includes(webUrl)) sawWeb = true;
}

if (!sawApi) {
  fail(`baked API base not found in build output: ${apiBase}`);
}
if (!sawPrivacy) {
  fail(`baked privacy URL not found in build output: ${privacyUrl}`);
}
if (!sawWeb) {
  fail(`baked Web URL not found in build output: ${webUrl}`);
}

const chromeMv3 = join(outputDir, 'chrome-mv3');
for (const icon of [
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png',
]) {
  if (!existsSync(join(chromeMv3, 'icon', icon)) && !existsSync(join(chromeMv3, icon))) {
    // WXT may nest under icon/ or flatten into the root — accept either.
    const found = files.some((f) => f.replace(/\\/g, '/').endsWith(`/${icon}`));
    if (!found) fail(`store icon missing from build output: ${icon}`);
  }
}

if (!existsSync(join(chromeMv3, 'auth.html'))) {
  fail('auth.html missing from chrome-mv3 (required for tab sign-in fallback)');
}

if (!(process.env.WALKCROACH_PROFILES_PUBLIC_KEY ?? '').trim()) {
  console.warn(
    'zip:prod warning: WALKCROACH_PROFILES_PUBLIC_KEY unset — remote site profiles remain disabled (packaged profiles only).',
  );
}

console.log(`zip:prod OK — version ${pkg.version}`);
console.log(`zip:prod artifact: ${zip}`);
