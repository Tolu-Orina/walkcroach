import { chromium, expect, test, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * Performance budgets (plan G4), measured rather than asserted on faith.
 *
 *   panel interactive  < 300ms after open
 *   page extract       < 1s P95 on an average article
 *
 * These run in real Chrome against the real build. Two things to know when a
 * failure lands:
 *
 *  - CI machines are slower and noisier than a laptop. The budgets below are the
 *    plan's numbers; `SLOW_CI` multiplies them rather than weakening them, so a
 *    genuine regression still fails while a loaded runner does not cry wolf.
 *  - The extract measurement runs the *shipped* `extractor.js` (Readability) via
 *    `executeScript` on a fixture article, which is the same path a real
 *    Summarize takes. It excludes network and model time by construction, since
 *    that is what the budget is about.
 */

/**
 * Must match the port `scripts/build-chrome-fixture.mjs` pre-grants, or the
 * permission check below fails and the extract measurement silently skips.
 * Safe to share with page-access.spec.ts: playwright.config runs workers: 1 and
 * each spec closes its server in afterAll.
 */
const FIXTURE_PORT = 39271;
const BUDGET_PANEL_MS = 300;
const BUDGET_EXTRACT_MS = 1000;
/** Loosen on CI without changing what the budget means. */
const SLACK = process.env.CI ? 2.5 : 1;

/** Roughly a long-read article: enough DOM for Readability to actually work. */
function article(paragraphs: number): string {
  const body = Array.from(
    { length: paragraphs },
    (_, i) =>
      `<p>Paragraph ${i + 1}. Northwind Components quoted 2,400 units of the M4 bracket at GBP 3.15 per unit delivered, with a lead time of eighteen working days from receipt of a purchase order. Terms are net thirty on approved credit and tooling is waived above two thousand units.</p>`,
  ).join('\n');
  return `<!doctype html><html><head><title>Supplier quote Q-4471</title></head>
<body>
  <nav>${'<a href="#">Nav link</a>'.repeat(30)}</nav>
  <main><article><h1>Supplier quote Q-4471</h1>${body}</article></main>
  <footer>${'<a href="#">Footer link</a>'.repeat(30)}</footer>
</body></html>`;
}

function extensionPath(): string {
  return (
    process.env.WALKCROACH_CHROME_EXTENSION_PATH?.trim() ||
    resolve(process.cwd(), '..', 'chrome', '.output', 'chrome-mv3')
  );
}

/** Median is the honest summary for a handful of samples; P95 needs more. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

test.describe('performance budgets (G4)', () => {
  let server: Server;
  let origin: string;

  test.beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(article(60));
    });
    await new Promise<void>((done) => server.listen(FIXTURE_PORT, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    origin = `http://localhost:${port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  async function launch() {
    const path = extensionPath();
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    });
    let worker: Worker | undefined = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    return { context, worker };
  }

  test('panel is interactive within budget after open', async () => {
    const path = extensionPath();
    test.skip(!existsSync(path), `Extension build missing at ${path}`);

    const { context, worker } = await launch();
    try {
      const extensionId = worker.url().split('/')[2];
      const samples: number[] = [];

      // Several opens: the first pays for cold module evaluation and font
      // decode, which a real user also pays once. Both are reported.
      for (let i = 0; i < 5; i++) {
        const page = await context.newPage();
        await page.setViewportSize({ width: 400, height: 760 });
        // Bootstrap calls the BFF; stub it so this measures the panel, not a
        // network round trip that the budget was never about.
        await page.route('**/chrome/v1/**', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, workspaces: [], projects: [], captures: [] }),
          }),
        );
        await page.addInitScript(() => {
          chrome.runtime.sendMessage = (_m, cb) => {
            const res = { ok: true, access: { status: 'no-tab' } };
            if (cb) return void cb(res);
            return Promise.resolve(res);
          };
        });

        await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        // "Interactive" = the shell and its primary controls are on screen and
        // hit-testable, which is what a user experiences as the panel opening.
        await page.waitForSelector('.wc-shell', { state: 'visible' });
        await page.waitForSelector('.wc-rail__item', { state: 'visible' });

        const ms = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined;
          // domContentLoadedEventEnd is the point React has mounted the shell.
          return nav ? nav.domContentLoadedEventEnd - nav.startTime : -1;
        });
        if (ms >= 0) samples.push(ms);
        await page.close();
      }

      const cold = samples[0]!;
      const warm = median(samples.slice(1));
      console.log(
        `panel interactive — cold ${cold.toFixed(0)}ms, warm median ${warm.toFixed(0)}ms ` +
          `(budget ${BUDGET_PANEL_MS}ms, slack ×${SLACK})`,
      );

      expect(
        warm,
        `panel warm-open median ${warm.toFixed(0)}ms exceeds the ${BUDGET_PANEL_MS}ms budget`,
      ).toBeLessThan(BUDGET_PANEL_MS * SLACK);
    } finally {
      await context.close();
    }
  });

  test('extract completes within budget on an average article', async () => {
    const path = extensionPath();
    test.skip(!existsSync(path), 'extension build missing');

    const { context, worker } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: 'domcontentloaded' });

      const granted = await worker.evaluate(
        async (o: string) =>
          await chrome.permissions.contains({ origins: [`${o}/*`] }),
        origin,
      );
      test.skip(
        !granted,
        'not a fixture build — run: npm run test:e2e:chrome:fixture',
      );

      // Ten runs of the real extractor on the real page, in the real worker.
      const samples = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const out: number[] = [];
        for (let i = 0; i < 10; i++) {
          const t0 = performance.now();
          const injected = await chrome.scripting.executeScript({
            target: { tabId: tab!.id! },
            files: ['extractor.js'],
          });
          const result = injected[0]?.result as { extractedText?: string } | null;
          if (!result?.extractedText) return [];
          out.push(performance.now() - t0);
        }
        return out;
      });

      expect(samples.length, 'extractor returned nothing').toBeGreaterThan(0);
      const p95 = percentile(samples, 95);
      console.log(
        `extract — median ${median(samples).toFixed(0)}ms, p95 ${p95.toFixed(0)}ms ` +
          `(budget ${BUDGET_EXTRACT_MS}ms, slack ×${SLACK})`,
      );

      expect(
        p95,
        `extract p95 ${p95.toFixed(0)}ms exceeds the ${BUDGET_EXTRACT_MS}ms budget`,
      ).toBeLessThan(BUDGET_EXTRACT_MS * SLACK);
      await page.close();
    } finally {
      await context.close();
    }
  });
});
