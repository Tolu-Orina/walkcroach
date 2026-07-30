import { chromium, expect, test, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * Page-access pipeline against real Chrome (Phase A/B verification).
 *
 * What this covers that unit tests cannot: that `extractor.js` actually runs in
 * a page and returns Readability output, that `chrome.permissions.contains`
 * agrees with the manifest, that the session cache round-trips, and that
 * restricted pages genuinely reject injection.
 *
 * What it deliberately does not cover: Chrome's optional-permission prompt is
 * native browser UI that Playwright cannot click. This suite therefore runs a
 * fixture build with the fixture server pre-granted in `host_permissions`
 * (WALKCROACH_TEST_GRANT_ORIGINS), exercising everything downstream of the
 * grant. The prompt itself, and the live OAuth round-trip, stay in the manual
 * gate in chrome/VERSIONING.md.
 *
 * Setup:
 *   cd chrome && WALKCROACH_TEST_GRANT_ORIGINS="http://localhost:39271/*" npm run build
 *   cd tests && npx playwright test e2e/chrome/page-access.spec.ts
 */

/** Must match the port baked into the fixture build's host_permissions. */
const FIXTURE_PORT = 39271;

const ARTICLE_HTML = `<!doctype html>
<html><head><title>Supplier quote Q-4471</title></head>
<body>
  <nav>Home About Contact Careers Privacy</nav>
  <main>
    <article>
      <h1>Supplier quote Q-4471</h1>
      <p>Northwind Components has quoted 2,400 units of the M4 bracket at
      GBP 3.15 per unit, delivered, with a lead time of eighteen working days
      from receipt of a purchase order.</p>
      <p>The quote is held for thirty days. Payment terms are net thirty on
      approved credit, and tooling costs are waived for orders above two
      thousand units.</p>
    </article>
  </main>
  <footer>Copyright Northwind Components. All rights reserved.</footer>
</body></html>`;

function extensionPath(): string {
  const fromEnv = process.env.WALKCROACH_CHROME_EXTENSION_PATH?.trim();
  if (fromEnv) return fromEnv;
  return resolve(process.cwd(), '..', 'chrome', '.output', 'chrome-mv3');
}

type Extract = {
  url: string;
  title: string;
  extractedText: string;
  contentHash: string;
} | null;

test.describe('page access pipeline (real Chrome)', () => {
  let server: Server;
  let origin: string;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ARTICLE_HTML.replace('Q-4471', `Q-4471${req.url === '/b' ? 'B' : ''}`));
    });
    await new Promise<void>((done) => server.listen(FIXTURE_PORT, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    origin = `http://localhost:${port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  /** Launch the extension and return its worker plus a helper to run in it. */
  async function launch() {
    const path = extensionPath();
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    });
    let worker: Worker | undefined = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    }
    return { context, worker };
  }

  test('fixture build has the fixture origin granted', async () => {
    const path = extensionPath();
    test.skip(!existsSync(path), `Extension build missing at ${path}`);

    const { context, worker } = await launch();
    try {
      const granted = await worker.evaluate(
        async (o: string) =>
          await chrome.permissions.contains({ origins: [`${o}/*`] }),
        origin,
      );
      test.skip(
        !granted,
        'Build is not a fixture build — rebuild with WALKCROACH_TEST_GRANT_ORIGINS',
      );
      expect(granted).toBe(true);

      // An origin we never granted must still be absent.
      const other = await worker.evaluate(
        async () =>
          await chrome.permissions.contains({
            origins: ['https://never-granted.example/*'],
          }),
      );
      expect(other).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('extractor.js returns Readability content from a real page', async () => {
    const path = extensionPath();
    test.skip(!existsSync(path), 'extension build missing');

    const { context, worker } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: 'domcontentloaded' });

      const extract = await worker.evaluate(async (): Promise<Extract> => {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) return null;
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['extractor.js'],
        });
        return (injected[0]?.result as Extract) ?? null;
      });

      expect(extract, 'executeScript({files}) returned no result').not.toBeNull();
      expect(extract!.title).toContain('Supplier quote');
      expect(extract!.extractedText).toContain('Northwind Components');
      expect(extract!.extractedText).toContain('eighteen working days');
      // Readability strips chrome; the old heuristic kept nav/footer text.
      expect(extract!.extractedText).not.toContain('All rights reserved');
      expect(extract!.extractedText).not.toContain('Careers');
      expect(extract!.contentHash).toMatch(/^fnv:[0-9a-f]+$/);
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('session cache round-trips and is keyed per tab and URL', async () => {
    const path = extensionPath();
    test.skip(!existsSync(path), 'extension build missing');

    const { context, worker } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: 'domcontentloaded' });

      const result = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tabId = tab!.id!;
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          files: ['extractor.js'],
        });
        const extract = injected[0]?.result as { url: string } | null;
        const key = `extract:${tabId}`;
        await chrome.storage.session.set({
          [key]: { extract, url: extract?.url, capturedAt: Date.now() },
        });
        const read = await chrome.storage.session.get(key);
        const otherTab = await chrome.storage.session.get(`extract:${tabId + 1}`);
        return {
          hit: Boolean((read[key] as { extract?: unknown })?.extract),
          cachedUrl: (read[key] as { url?: string })?.url,
          otherTabEmpty: Object.keys(otherTab).length === 0,
        };
      });

      expect(result.hit).toBe(true);
      expect(result.cachedUrl).toContain(`localhost:${FIXTURE_PORT}`);
      expect(result.otherTabEmpty).toBe(true);
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('injection is impossible on a restricted browser page', async () => {
    const path = extensionPath();
    test.skip(!existsSync(path), 'extension build missing');

    const { context, worker } = await launch();
    try {
      const page = await context.newPage();
      await page.goto('chrome://settings/', { waitUntil: 'domcontentloaded' });

      // This is why 'restricted' is a terminal state with no retry button:
      // no permission grant can ever make it succeed.
      const rejected = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) return 'no-tab';
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['extractor.js'],
          });
          return 'unexpectedly-succeeded';
        } catch {
          return 'rejected';
        }
      });

      expect(rejected).toBe('rejected');
      await page.close();
    } finally {
      await context.close();
    }
  });

  /**
   * The API host is an install-time (required) permission, and Chrome rejects
   * `permissions.remove` for those outright — "You cannot remove required
   * permissions." So the Sites list can never revoke the extension's own
   * lifeline, whatever the UI does. `revokeOrigin` guards this in code too, and
   * this test confirms the browser backs that guard up.
   *
   * Revoking a genuine *optional* site grant is not reachable here: acquiring
   * one requires Chrome's native permission prompt, which Playwright cannot
   * click. That single step remains in the manual gate (chrome/VERSIONING.md).
   */
  test('the install-time API host cannot be revoked', async () => {
    const path = extensionPath();
    test.skip(!existsSync(path), 'extension build missing');

    const { context, worker } = await launch();
    try {
      const outcome = await worker.evaluate(async () => {
        const all = await chrome.permissions.getAll();
        const apiHost = (all.origins ?? []).find((o) => o.includes(':3002'));
        if (!apiHost) return { apiHost: null, refused: false, stillThere: false };
        let refused = false;
        try {
          const removed = await chrome.permissions.remove({
            origins: [apiHost],
          });
          refused = removed === false;
        } catch {
          refused = true;
        }
        const stillThere = await chrome.permissions.contains({
          origins: [apiHost],
        });
        return { apiHost, refused, stillThere };
      });

      expect(
        outcome.apiHost,
        'no API host in the build — is WALKCROACH_API_BASE set?',
      ).not.toBeNull();
      expect(outcome.refused).toBe(true);
      expect(outcome.stillThere).toBe(true);
    } finally {
      await context.close();
    }
  });
});
