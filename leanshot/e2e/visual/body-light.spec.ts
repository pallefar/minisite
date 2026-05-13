import { expect, test } from '@playwright/test';

import { gotoTab, seedOnboarded, waitForReady } from './helpers/seed';

test('body tab — light theme (weight chart + photos empty-state)', async ({ page }) => {
  // Seed photos=[] in seed.ts so the empty-state illustration renders.
  await seedOnboarded(page, { currentTab: 'body' });
  await page.goto('/');
  await waitForReady(page);
  await gotoTab(page, 'body');
  await waitForReady(page);
  await expect(page).toHaveScreenshot('body-light.png', { fullPage: true });
});
