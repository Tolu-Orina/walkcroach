import { expect, test } from '@playwright/test';

/**
 * NFR-26 smoke (partial): landing loads, hero CTA present, auth affordances visible.
 * Full template→prompt→preview→deploy requires a long-lived WebContainer session and
 * is gated behind WALKCROACH_E2E_FULL=1.
 */
test.describe('WalkCroach Web smoke', () => {
  test('landing hero renders brand + start CTA', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Build apps that remember you/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel(/Describe your app/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Start building/i }),
    ).toBeVisible();
  });

  test('prompt chip + start navigates when guest/dev auth is available', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Build apps that remember you/i }),
    ).toBeVisible({ timeout: 30_000 });

    const guest = page.getByRole('button', {
      name: /Try without signing in/i,
    });
    const signup = page.getByRole('link', { name: /Create account/i });
    const dev = page.getByRole('button', { name: /Dev sign-in/i });

    if (await guest.isVisible().catch(() => false)) {
      await page.getByLabel(/Describe your app/i).fill(
        'Todo app with localStorage persistence',
      );
      await page.getByRole('button', { name: /Start building/i }).click();
      await expect(page).toHaveURL(/\/(try|welcome|project|signup)/, {
        timeout: 20_000,
      });
      return;
    }

    if (await signup.isVisible().catch(() => false)) {
      await signup.click();
      await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });
      return;
    }

    if (await dev.isVisible().catch(() => false)) {
      await dev.click();
      await expect(page).toHaveURL(/\/welcome/, { timeout: 15_000 });
      return;
    }

    test.skip(true, 'No guest/dev/cognito CTA visible on this deploy');
  });
});

test.describe('WalkCroach Web full flow', () => {
  test.skip(
    !process.env.WALKCROACH_E2E_FULL,
    'Set WALKCROACH_E2E_FULL=1 to run template→builder smoke',
  );

  test('guest start reaches builder shell', async ({ page }) => {
    await page.goto('/');
    const guest = page.getByRole('button', {
      name: /Try without signing in/i,
    });
    test.skip(!(await guest.isVisible().catch(() => false)), 'guest auth off');
    await guest.click();
    await expect(page).toHaveURL(/\/try/, { timeout: 20_000 });
    await page.getByLabel(/Describe your app/i).fill(
      'Muted landing page with a contact CTA',
    );
    // On /try the builder may already be up — assert shell chrome exists.
    await expect(page.locator('body')).toContainText(/WalkCroach|Build|Preview/i, {
      timeout: 60_000,
    });
  });
});
