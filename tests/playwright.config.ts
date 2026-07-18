import { defineConfig, devices } from '@playwright/test';

const webBase =
  process.env.WALKCROACH_WEB_URL?.replace(/\/$/, '') ||
  'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'e2e-junit.xml' }]] : 'list',
  timeout: 90_000,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'web-smoke',
      testMatch: /e2e\/web\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: webBase,
      },
    },
    {
      name: 'chrome-extension',
      testMatch: /e2e\/chrome\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
