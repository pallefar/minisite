import { expect, test } from '@playwright/test';

import { seedUnauth, waitForReady } from './helpers/seed';

test('marketing landing — light theme', async ({ page }) => {
  await seedUnauth(page);
  await page.goto('/');
  await waitForReady(page);
  await expect(page).toHaveScreenshot('landing-light.png', { fullPage: true });
});
