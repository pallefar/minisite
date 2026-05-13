import { expect, test } from '@playwright/test';

import { seedOnboarded, waitForReady } from './helpers/seed';

test('home tab — light theme', async ({ page }) => {
  await seedOnboarded(page, { currentTab: 'home' });
  await page.goto('/');
  await waitForReady(page);
  await expect(page).toHaveScreenshot('home-light.png', { fullPage: true });
});
