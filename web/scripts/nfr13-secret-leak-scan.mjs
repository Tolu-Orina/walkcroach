#!/usr/bin/env node
/**
 * NFR-13 / P2.16 — secret-leak CI gate for generated-app client bundles.
 *
 * Builds the template fixture (proxy-only DB/secrets pattern), then scans dist/
 * for credential patterns and canary values that must never be inlined.
 */
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { scanBundleContent } from './lib/secret-bundle-scan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'nfr13-fixture');

/** Session proxy token — allowed to appear when referenced via VITE_WALKCROACH_TOKEN. */
const ALLOWED_INLINED = {
  proxy: 'https://api.walkcroach.test/proxy/nfr13-fixture-project',
  token: 'wc-session-nfr13-allowed-proxy-token',
};

/** Env vars present at build time that must NOT be imported by generated app source. */
const FORBIDDEN_CANARIES = {
  VITE_STRIPE_SECRET_KEY: 'sk_live_NFR13_CANARY_STRIPE_LEAK_TEST',
  VITE_DATABASE_URL:
    'postgresql://wc_app:CANARY_NFR13_DB_PASSWORD@prod-crdb.example:26257/wc_app_nfr13?sslmode=require',
  VITE_OPENAI_API_KEY: 'sk-NFR13_CANARY_OPENAI_LEAK_TEST',
  GITHUB_TOKEN: 'ghp_NFR13_CANARY_GITHUB_LEAK_TEST',
  AWS_SECRET_ACCESS_KEY: 'CANARY_NFR13_AWS_SECRET_ACCESS_KEY_VALUE',
};

async function copyDir(src, dest) {
  await cp(src, dest, { recursive: true });
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

function isTextBundle(filePath) {
  return /\.(js|mjs|cjs|css|html|json|map|txt)$/i.test(filePath);
}

function scanContent(content, filePath) {
  return scanBundleContent(content, {
    allowedValues: Object.values(ALLOWED_INLINED),
    forbiddenCanaries: Object.values(FORBIDDEN_CANARIES),
  }).map((f) => ({ ...f, file: filePath }));
}

async function writeEnvLocal(workDir) {
  const lines = [
    `VITE_WALKCROACH_PROXY=${ALLOWED_INLINED.proxy}`,
    `VITE_WALKCROACH_TOKEN=${ALLOWED_INLINED.token}`,
    ...Object.entries(FORBIDDEN_CANARIES).map(([k, v]) => `${k}=${v}`),
  ];
  await writeFile(join(workDir, '.env.production'), `${lines.join('\n')}\n`);
}

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), 'walkcroach-nfr13-'));
  console.log(`NFR-13: building fixture in ${workDir}`);

  try {
    await copyDir(FIXTURE_DIR, workDir);
    await writeEnvLocal(workDir);

    execSync('npm ci --include=dev', {
      cwd: workDir,
      stdio: 'inherit',
    });

    execSync('npm run build', {
      cwd: workDir,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });

    const distDir = join(workDir, 'dist');
    const bundleFiles = (await listFiles(distDir)).filter(isTextBundle);
    if (bundleFiles.length === 0) {
      console.error('NFR-13 FAILED: no bundle files in dist/');
      process.exit(1);
    }

    const allFindings = [];
    for (const file of bundleFiles) {
      const content = await readFile(file, 'utf8');
      const rel = relative(distDir, file);
      allFindings.push(...scanContent(content, rel));
    }

    if (allFindings.length > 0) {
      console.error('\nNFR-13 FAILED: secret patterns found in generated client bundle:\n');
      for (const f of allFindings) {
        console.error(`  [${f.rule}] ${f.file}: ${f.detail}`);
      }
      console.error(
        '\nGenerated apps must use the WalkCroach proxy (lib/db.ts, lib/walkcroach.ts) — never inline API keys or DB credentials.',
      );
      process.exit(1);
    }

    console.log(
      `NFR-13 PASSED: scanned ${bundleFiles.length} bundle file(s); no secret leaks detected.`,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('NFR-13 scan error:', err);
  process.exit(1);
});
