import { expect, test } from '@playwright/test';

import { gotoTab, seedOnboarded, seedThemeDark, waitForReady } from './helpers/seed';

test('medication tab — dark theme', async ({ page }) => {
  await seedOnboarded(page, { currentTab: 'medication' });
  await seedThemeDark(page);
  await page.goto('/');
  await waitForReady(page);
  await gotoTab(page, 'medication');
  await page.waitForSelector('canvas', { state: 'visible', timeout: 5000 });
  await waitForReady(page);
  await expect(page).toHaveScreenshot('medication-dark.png', { fullPage: true });
});
