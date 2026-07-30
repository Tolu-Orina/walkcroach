#!/usr/bin/env node
/**
 * Build the Chrome extension as an e2e *fixture*: identical to a dev build
 * except the local fixture server origin is pre-granted in `host_permissions`.
 *
 * Why: Chrome's optional-permission prompt is native browser UI that Playwright
 * cannot click. Pre-granting lets `e2e/chrome/page-access.spec.ts` exercise
 * everything downstream of the grant against real Chrome APIs.
 *
 * The port here must match FIXTURE_PORT in that spec. `chrome/wxt.config.ts`
 * refuses this variable for production builds.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const FIXTURE_PORT = 39271;
const chromeDir = resolve(import.meta.dirname, '..', '..', 'chrome');

const result = spawnSync('npm', ['run', 'build'], {
  cwd: chromeDir,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    WALKCROACH_TEST_GRANT_ORIGINS: `http://localhost:${FIXTURE_PORT}/*`,
    WALKCROACH_REQUIRE_PROD_ENV: 'false',
  },
});

if (result.status !== 0) {
  console.error('\nFixture build failed.');
  process.exit(result.status ?? 1);
}

console.log(
  `\nFixture build ready with http://localhost:${FIXTURE_PORT}/* pre-granted.\n` +
    'This artifact must NOT be uploaded to the Chrome Web Store —\n' +
    'rebuild with `cd chrome && npm run build` to clear the pre-grant.',
);
