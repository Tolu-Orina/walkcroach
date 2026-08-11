import { expect, test } from '@playwright/test';

/**
 * NFR-26 smoke (partial): landing loads, dual-funnel CTAs present.
 * Full template→prompt→preview→deploy requires a long-lived WebContainer session and
 * is gated behind WALKCROACH_E2E_FULL=1.
 */
test.describe('WalkCroach Web smoke', () => {
  test('landing hero renders brand + dual-funnel CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Your one memory layer/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /^Get started$/i }).first()).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^Coding agents$/i }).first(),
    ).toBeVisible();
  });

  test('get started navigates when guest/dev auth is available', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Your one memory layer/i }),
    ).toBeVisible({ timeout: 30_000 });

    const guest = page.getByRole('link', { name: /Try guest/i });
    const getStarted = page.getByRole('link', { name: /^Get started$/i }).first();
    const signup = page.getByRole('link', { name: /Create account/i });
    const dev = page.getByRole('button', { name: /Dev sign-in/i });

    if (await guest.isVisible().catch(() => false)) {
      await guest.click();
      await expect(page).toHaveURL(/\/(try|welcome|project|signup)/, {
        timeout: 20_000,
      });
      return;
    }

    if (await getStarted.isVisible().catch(() => false)) {
      await getStarted.click();
      await expect(page).toHaveURL(/\/(signup|app|try|welcome)/, {
        timeout: 15_000,
      });
      return;
    }

    if (await signup.isVisible().catch(() => false)) {
      await signup.click();
      await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });
      return;
    }

    if (await dev.isVisible().catch(() => false)) {
      await expect(dev).toBeVisible();
      return;
    }

    test.skip(true, 'No guest/signup/dev auth affordance on this env');
  });

  test('coding agents CTA scrolls to IDE/CLI section', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^Coding agents$/i }).first().click();
    await expect(page.locator('#pair-ide-cli')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('heading', {
        name: /You steer\. We explore, act, and verify/i,
      }),
    ).toBeVisible();
  });
});

test.describe('WalkCroach Web full flow', () => {
  test.skip(
    !process.env.WALKCROACH_E2E_FULL,
    'Set WALKCROACH_E2E_FULL=1 to run template→builder smoke',
  );

  test('guest start reaches builder shell', async ({ page }) => {
    await page.goto('/');
    const guest = page.getByRole('link', { name: /Try guest/i });
    test.skip(!(await guest.isVisible().catch(() => false)), 'guest auth off');
    await guest.click();
    await expect(page).toHaveURL(/\/try/, { timeout: 20_000 });
    await expect(page.locator('body')).toContainText(/WalkCroach|Build|Preview/i, {
      timeout: 60_000,
    });
  });
});
