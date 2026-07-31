/**
 * Chrome Web Store screenshots, captured from the REAL built extension.
 *
 *   cd chrome && npm run build && npm run screenshots
 *
 * The previous version of this script rendered `_fixture.html`, a hand-written
 * mock of the panel. That mock had already drifted from the shipped UI — which is
 * the failure mode store screenshots are most prone to, and the one a reviewer
 * notices fastest. This loads the actual `.output/chrome-mv3` build in Chromium,
 * so a screenshot cannot show something the extension does not do.
 *
 * Two things are stubbed, and only two:
 *   - The BFF, so captures do not depend on a deployed backend or a real account.
 *     Responses are representative, never inventing a capability.
 *   - `chrome.runtime.sendMessage`, so a page-access state can be posed. Chrome
 *     will not grant a real site permission to an automated run.
 *
 * Everything visual — layout, tokens, fonts, copy — is the shipped code.
 *
 * Output is 1280×800, the Chrome Web Store size. The panel renders at its real
 * width and is composited onto a branded backdrop with a caption, because a
 * 420px column centred in a 1280px frame reads as a mistake.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const chromeRoot = join(dir, '..', '..');
const repoRoot = join(chromeRoot, '..');
const require = createRequire(join(repoRoot, 'tests', 'package.json'));
const { chromium } = require('@playwright/test');

const extensionPath = join(chromeRoot, '.output', 'chrome-mv3');

/**
 * Height matches the frame exactly. Capturing taller and cropping cut the panel
 * mid-composer, which read as a broken screenshot rather than a deliberate
 * frame — and hid the bottom rail, which is part of the product's identity.
 */
const PANEL = { width: 420, height: 700 };
const STORE = { width: 1280, height: 800 };

const PAGE = {
  url: 'https://northwind-components.test/quotes/4471',
  title: 'Supplier quote Q-4471 — M4 bracket, 2,400 units',
  origin: 'https://northwind-components.test/*',
};

const readyAccess = {
  status: 'ready',
  tabId: 1,
  url: PAGE.url,
  title: PAGE.title,
  origin: PAGE.origin,
};

const SUMMARY = `Northwind Components quoted 2,400 units of the M4 bracket at GBP 3.15 per unit, delivered.

Lead time is eighteen working days from receipt of a purchase order. The quote holds for thirty days, payment is net thirty on approved credit, and tooling costs are waived above two thousand units.`;

const RECALL_ANSWER = `You saved the Northwind quote on Tuesday [1]. It prices the M4 bracket at GBP 3.15 delivered, with an eighteen working day lead time.

The Fenwick quote [2] is GBP 3.40 for the same part but ships in five days.`;

/**
 * Ordered the way a reviewer should read them: what it is, how access works,
 * what a write looks like, what memory gives back, what you control.
 */
const SCENES = [
  {
    file: '01-page.png',
    caption: 'Act on the page you are already on',
    sub: 'One clear action, and nothing is read until you ask for it.',
    access: readyAccess,
  },
  {
    file: '02-grant.png',
    caption: 'Permission, one site at a time',
    sub: 'No site-wide access at install. Allow a site, or withdraw it later.',
    access: { ...readyAccess, status: 'needs-grant' },
  },
  {
    file: '03-confirm.png',
    caption: 'Nothing is saved without showing you first',
    sub: 'Every write is a confirmation, not a side effect.',
    access: readyAccess,
    async pose(page) {
      await page.getByRole('button', { name: /^Save/ }).click();
      await page.waitForTimeout(600);
    },
  },
  {
    file: '04-recall.png',
    caption: 'Ask what you saved, get the sources',
    sub: 'Answers cite the captures they came from.',
    access: readyAccess,
    async pose(page) {
      await page.getByRole('tab', { name: 'Recall' }).click();
      await page.waitForTimeout(300);
      await page.getByLabel('Search your saved captures').fill('what did the supplier quote?');
      await page.getByRole('button', { name: 'Recall' }).click();
      await page.waitForTimeout(900);
    },
  },
  {
    file: '05-account.png',
    caption: 'You control every site and connection',
    sub: 'Withdraw access in one click; it clears anything cached for that site.',
    access: readyAccess,
    async pose(page) {
      await page.getByRole('tab', { name: 'Account' }).click();
      await page.waitForTimeout(400);
    },
  },
];

const json = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const ndjson = (lines) => ({
  status: 200,
  contentType: 'application/x-ndjson',
  body: lines.map((l) => JSON.stringify(l)).join('\n'),
});

/** Representative BFF responses — the same shapes the real API returns. */
function routeApi(route) {
  const url = route.request().url();
  if (url.includes('/health')) return route.fulfill(json({ ok: true }));
  if (url.includes('/device/session')) {
    return route.fulfill(
      json({
        accessToken: 'demo',
        ownerId: 'demo-owner',
        deviceKey: 'demo',
        expiresIn: 99999,
      }),
    );
  }
  if (url.includes('/workspaces')) {
    return route.fulfill(
      json({
        workspaces: [
          { id: 'w1', name: 'Suppliers', linked_project_id: null },
          { id: 'w2', name: 'Leads', linked_project_id: null },
        ],
      }),
    );
  }
  if (url.includes('/me/projects')) return route.fulfill(json({ projects: [] }));
  if (url.includes('/credits')) {
    return route.fulfill(
      json({ remaining: 412, allowance: 500, plan: 'Free', resetsAt: '2026-09-01' }),
    );
  }
  if (url.includes('/connectors')) {
    // Empty on purpose: connectors are inert until an OAuth app exists, and a
    // screenshot must not imply otherwise (SUBMISSION_CHECKLIST §1).
    return route.fulfill(
      json({ requiresSignIn: false, providers: [], connectUrl: '' }),
    );
  }
  if (url.includes('/recall')) {
    return route.fulfill(
      ndjson([
        { type: 'memory_recalled', count: 2 },
        {
          type: 'recall_sources',
          sources: [
            {
              captureId: 'c1',
              url: PAGE.url,
              title: 'Supplier quote Q-4471',
              captureType: 'general',
              workspace: 'Suppliers',
              inWebProject: true,
              capturedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
              distance: 0.08,
            },
            {
              captureId: 'c2',
              url: 'https://fenwick-parts.test/q/8812',
              title: 'Fenwick Parts quote 8812',
              captureType: 'general',
              workspace: 'Suppliers',
              inWebProject: false,
              capturedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
              distance: 0.19,
            },
          ],
        },
        { type: 'token', text: RECALL_ANSWER },
        { type: 'done', reason: 'complete' },
      ]),
    );
  }
  if (url.includes('/summarize')) {
    return route.fulfill(
      ndjson([
        { type: 'token', text: SUMMARY },
        { type: 'done', reason: 'complete' },
      ]),
    );
  }
  if (url.includes('/captures')) return route.fulfill(json({ captures: [] }));
  return route.fulfill(json({}));
}

/** Compositor: the panel capture on a Graphite Lumen backdrop, with a caption. */
function frameHtml(pngBase64, caption, sub) {
  return `<!doctype html><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${STORE.width}px; height: ${STORE.height}px;
    display: grid; grid-template-columns: 1fr auto; align-items: center;
    gap: 72px; padding: 0 88px;
    background:
      radial-gradient(760px 420px at 8% -10%, #1a2440 0%, transparent 58%),
      radial-gradient(620px 360px at 96% 4%, #2a2218 0%, transparent 52%),
      linear-gradient(180deg, #0e1014 0%, #0b0c0f 46%);
    color: #f2f3f5;
    font-family: ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .copy { max-width: 520px; }
  .mark { font-weight: 700; font-size: 26px; letter-spacing: -.035em; margin-bottom: 28px; }
  .mark span { color: #f0b429; }
  h1 { font-weight: 700; font-size: 44px; line-height: 1.12; letter-spacing: -.035em; }
  p { margin-top: 18px; font-size: 19px; line-height: 1.5; color: #9198a4; }
  .panel {
    width: ${PANEL.width}px; height: 700px; overflow: hidden;
    border: 1px solid #2e333c; border-radius: 14px;
    box-shadow: 0 40px 90px rgb(0 0 0 / 55%);
  }
  .panel img { display: block; width: 100%; }
</style>
<div class="copy">
  <div class="mark">WalkCroach<span>.</span></div>
  <h1>${caption}</h1>
  <p>${sub}</p>
</div>
<div class="panel"><img src="data:image/png;base64,${pngBase64}"></div>`;
}

mkdirSync(dir, { recursive: true });

const context = await chromium.launchPersistentContext('', {
  // Extensions require a headed context.
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
const extensionId = worker.url().split('/')[2];
console.log('extension', extensionId);

const composer = await context.newPage();
await composer.setViewportSize(STORE);

for (const scene of SCENES) {
  const page = await context.newPage();
  await page.setViewportSize(PANEL);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/chrome/v1/**', routeApi);

  await page.addInitScript((access) => {
    // Pose the page-access state: Chrome will not grant a real site permission
    // to an automated run, and the worker has no tab to read.
    chrome.runtime.sendMessage = (msg, cb) => {
      const res = { ok: true, access };
      if (msg?.type === 'GET_ACTIVE_EXTRACT') {
        res.extract = {
          url: access.url,
          title: access.title,
          extractedText: 'x'.repeat(8421),
          contentHash: 'fnv:demo',
        };
      }
      if (msg?.type === 'TAKE_PENDING_SELECTION') res.selection = null;
      if (cb) return void cb(res);
      return Promise.resolve(res);
    };
    chrome.storage.local.set({ wc_coach_seen_v1: true });
  }, scene.access);

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForSelector('.wc-shell');
  await page.waitForTimeout(1200);
  if (scene.pose) await scene.pose(page);
  await page.waitForTimeout(300);

  const panelPng = await page.screenshot({ type: 'png' });
  await page.close();

  await composer.setContent(
    frameHtml(panelPng.toString('base64'), scene.caption, scene.sub),
    { waitUntil: 'load' },
  );
  await composer.waitForTimeout(250);
  await composer.screenshot({
    path: join(dir, scene.file),
    type: 'png',
    clip: { x: 0, y: 0, ...STORE },
  });
  console.log('wrote', scene.file);
}

await context.close();

// A store screenshot of an empty panel means the stubs drifted from the app.
const undersized = SCENES.filter(
  (s) => readFileSync(join(dir, s.file)).length < 40_000,
);
if (undersized.length) {
  console.error(
    'Suspiciously small captures — the panel likely failed to render:',
    undersized.map((s) => s.file).join(', '),
  );
  process.exit(1);
}
console.log('all captures populated');
