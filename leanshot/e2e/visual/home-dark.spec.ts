import { expect, test } from '@playwright/test';

import { seedOnboarded, seedThemeDark, waitForReady } from './helpers/seed';

test('home tab — dark theme', async ({ page }) => {
  await seedOnboarded(page, { currentTab: 'home' });
  await seedThemeDark(page);
  await page.goto('/');
  await waitForReady(page);
  await expect(page).toHaveScreenshot('home-dark.png', { fullPage: true });
});
