import { expect, test } from '@playwright/test';

import { seedOnboarded, waitForReady } from './helpers/seed';

test('settings drawer — light theme', async ({ page }) => {
  await seedOnboarded(page, { settingsOpen: true });
  await page.goto('/');
  await waitForReady(page);
  // SettingsPage open state lives in App.tsx useState (NOT Zustand). Open via
  // sidebar "Open settings" icon button (see Sidebar.tsx aria-label).
  await page.getByRole('button', { name: 'Open settings' }).first().click();
  await waitForReady(page);
  await expect(page).toHaveScreenshot('settings-light.png', { fullPage: true });
});
