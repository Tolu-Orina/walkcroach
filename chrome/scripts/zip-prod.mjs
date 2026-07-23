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
  'https://awbcf4clij.execute-api.eu-west-2.amazonaws.com/v1';
const DEFAULT_PRIVACY =
  'https://walkcroach.conquerorfoundation.com/chrome-privacy.html';

const apiBase = (process.env.WALKCROACH_API_BASE ?? DEFAULT_API).replace(
  /\/$/,
  '',
);
const privacyUrl = process.env.WALKCROACH_PRIVACY_URL ?? DEFAULT_PRIVACY;

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

if (!apiBase.includes('/v1')) {
  console.warn(
    'zip:prod warning: WALKCROACH_API_BASE usually ends with /v1 (API Gateway stage)',
  );
}

console.log('zip:prod API     =', apiBase);
console.log('zip:prod privacy =', privacyUrl);

const env = {
  ...process.env,
  WALKCROACH_API_BASE: apiBase,
  WALKCROACH_PRIVACY_URL: privacyUrl,
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
const zip = files.find((f) => f.endsWith('.zip'));
if (!zip) fail('no .zip found under .output');

const textFiles = files.filter((f) =>
  /\.(js|html|json|css|mjs)$/i.test(f),
);
let sawApi = false;
let sawPrivacy = false;
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
}

if (!sawApi) {
  fail(`baked API base not found in build output: ${apiBase}`);
}
if (!sawPrivacy) {
  fail(`baked privacy URL not found in build output: ${privacyUrl}`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
console.log(`zip:prod OK — version ${pkg.version}`);
console.log(`zip:prod artifact: ${zip}`);
