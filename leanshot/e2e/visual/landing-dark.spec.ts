import { expect, test } from '@playwright/test';

import { seedThemeDark, seedUnauth, waitForReady } from './helpers/seed';

test('marketing landing — dark theme', async ({ page }) => {
  // Order: seedUnauth writes localStorage including theme=light; seedThemeDark
  // overrides to dark AND sets data-theme on <html> pre-paint. Both rely on
  // addInitScript — never goto/evaluate/reload (see helpers/seed.ts header).
  await seedUnauth(page);
  await seedThemeDark(page);
  await page.goto('/');
  await waitForReady(page);
  await expect(page).toHaveScreenshot('landing-dark.png', { fullPage: true });
});
