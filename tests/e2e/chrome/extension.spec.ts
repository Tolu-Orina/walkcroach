import { chromium, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads the unpacked WXT Chromium build and asserts the background service
 * worker is alive. Requires a prior `cd chrome && npm run build`.
 *
 * Path override: WALKCROACH_CHROME_EXTENSION_PATH
 */
function extensionPath(): string {
  const fromEnv = process.env.WALKCROACH_CHROME_EXTENSION_PATH?.trim();
  if (fromEnv) return fromEnv;
  return resolve(
    process.cwd(),
    '..',
    'chrome',
    '.output',
    'chrome-mv3',
  );
}

test.describe('Chrome extension (unpacked)', () => {
  test('service worker starts for unpacked build', async () => {
    const path = extensionPath();
    test.skip(
      !existsSync(path),
      `Extension build missing at ${path} — run: cd chrome && npm run build`,
    );

    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${path}`,
        `--load-extension=${path}`,
      ],
    });

    try {
      // MV3: wait for service worker
      let worker = context.serviceWorkers()[0];
      if (!worker) {
        worker = await context.waitForEvent('serviceworker', {
          timeout: 30_000,
        });
      }
      expect(worker).toBeTruthy();
      expect(worker.url()).toMatch(/chrome-extension:\/\//);

      // Side panel HTML is part of the package
      const extensionId = worker.url().split('/')[2];
      expect(extensionId).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test('privacy policy URL is https in production builds', async () => {
    const path = extensionPath();
    test.skip(!existsSync(path), 'extension build missing');
    // Production builds must set WALKCROACH_PRIVACY_URL to https — asserted at build time.
    // This test documents the contract for CI zip builds.
    if (process.env.WALKCROACH_REQUIRE_PROD_ENV === 'true') {
      expect(process.env.WALKCROACH_PRIVACY_URL ?? '').toMatch(/^https:\/\//);
    }
  });
});
