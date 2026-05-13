import { expect, test } from '@playwright/test';

import { seedUnauth, waitForReady } from './helpers/seed';

test('split-screen login (auth/signin) — light theme', async ({ page }) => {
  await seedUnauth(page);
  // Phase 5 D-01 + 13-04 split-screen: `#/auth/signin` forces the `'auth'`
  // view in selectViewLogged (see src/App.tsx and src/components/auth/AuthView.tsx).
  // Hero is on the LEFT, form is on the RIGHT (13-04).
  await page.goto('/#/auth/signin');
  await waitForReady(page);
  await expect(page).toHaveScreenshot('auth-login-light.png', { fullPage: true });
});
