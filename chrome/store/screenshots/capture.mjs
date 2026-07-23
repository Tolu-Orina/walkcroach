/**
 * Capture Chrome Web Store screenshots from the UI fixture (1280×800).
 * Uses Playwright from tests/node_modules.
 *
 *   node chrome/store/screenshots/capture.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '..', '..', '..');
const require = createRequire(join(repoRoot, 'tests', 'package.json'));
const { chromium } = require('@playwright/test');

const fixture = pathToFileURL(join(dir, '_fixture.html')).href;

const shots = [
  ['summarize', '01-summarize.png'],
  ['trust', '02-trust.png'],
  ['workspaces', '03-workspaces.png'],
  ['sector', '04-sector.png'],
  ['recall', '05-recall.png'],
];

mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});

for (const [scene, file] of shots) {
  await page.goto(`${fixture}?scene=${scene}`, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const out = join(dir, file);
  await page.screenshot({
    path: out,
    type: 'png',
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  console.log('wrote', out);
}

await browser.close();
console.log('done — 5 screenshots at 1280×800');
