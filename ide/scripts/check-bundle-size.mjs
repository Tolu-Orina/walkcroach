#!/usr/bin/env node
/**
 * PA.10 — panel load budget regression (bundle size).
 * Webview JS must stay lean for ≤1s sidebar paint (NFR-D01).
 */
import { statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webview = join(root, 'media', 'webview.js');
const extension = join(root, 'dist', 'extension.cjs');

const limits = {
  webviewJs: 1.5 * 1024 * 1024, // 1.5 MiB
  extensionCjs: 3 * 1024 * 1024, // 3 MiB (includes AWS SDK)
};

function check(label, file, max) {
  if (!existsSync(file)) {
    console.error(`FAIL ${label}: missing ${file} (run npm run build first)`);
    process.exitCode = 1;
    return;
  }
  const size = statSync(file).size;
  const ok = size <= max;
  console.log(
    `${ok ? 'OK' : 'FAIL'} ${label}: ${(size / 1024).toFixed(1)} KiB (limit ${(max / 1024).toFixed(0)} KiB)`,
  );
  if (!ok) process.exitCode = 1;
}

check('webview.js', webview, limits.webviewJs);
check('extension.cjs', extension, limits.extensionCjs);

const skillsJson = join(root, 'dist', 'cockroachdb-official.generated.json');
if (!existsSync(skillsJson)) {
  console.error(
    `FAIL cockroach skills JSON: missing ${skillsJson} (esbuild must copy it beside extension.cjs)`,
  );
  process.exitCode = 1;
} else {
  const size = statSync(skillsJson).size;
  console.log(
    `OK cockroach skills JSON: ${(size / 1024).toFixed(1)} KiB`,
  );
  if (size < 1_000) {
    console.error('FAIL cockroach skills JSON: file looks empty/corrupt');
    process.exitCode = 1;
  }
}
