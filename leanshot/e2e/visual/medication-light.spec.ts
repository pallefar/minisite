import { expect, test } from '@playwright/test';

import { gotoTab, seedOnboarded, waitForReady } from './helpers/seed';

test('medication tab — light theme', async ({ page }) => {
  await seedOnboarded(page, { currentTab: 'medication' });
  await page.goto('/');
  await waitForReady(page);
  // Store hydrates with currentTab='home' by default; navigate via sidebar.
  await gotoTab(page, 'medication');
  // Chart.js canvas needs an extra paint frame after data feed-in. Wait for
  // the canvas element to mount before the diff is taken.
  await page.waitForSelector('canvas', { state: 'visible', timeout: 5000 });
  await waitForReady(page);
  await expect(page).toHaveScreenshot('medication-light.png', { fullPage: true });
});
