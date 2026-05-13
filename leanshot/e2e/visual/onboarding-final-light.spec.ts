import { expect, test } from '@playwright/test';

import { seedOnboardingFinal, waitForReady } from './helpers/seed';

test('onboarding final step — light theme', async ({ page }) => {
  // OnboardingFlow holds `step` in local React state (no Zustand seam), so
  // we drive it via click sequence. seedOnboardingFinal seeds an unauth
  // localStorage so the App view selector lands on `'onboarding'`.
  await seedOnboardingFinal(page);
  await page.goto('/');
  await waitForReady(page);

  // Step 0: disclaimer. Click "I understand" to advance to step 1.
  await page.getByRole('button', { name: /I understand|Continue/i }).first().click();
  // Step 1: name + units.
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('button', { name: /Continue/i }).click();
  // Step 2: medication + dose + start date.
  await page.getByLabel('GLP-1 medication').selectOption('mounjaro');
  await page.getByLabel('Current dose').fill('5');
  await page.getByRole('button', { name: /Continue/i }).click();
  // Step 3: starting weight — required.
  await page.getByLabel(/weight/i).first().fill('92');
  await page.getByRole('button', { name: /Continue/i }).click();
  // Steps 4-6: optional fields; just advance.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /Continue/i }).click();
  }
  // Step 7: OnboardReady summary — the FINAL step. The advance button is
  // "Open dashboard" (Check icon), not "Continue".
  await waitForReady(page);
  await expect(page.getByRole('button', { name: /Open dashboard/i })).toBeVisible();
  await expect(page).toHaveScreenshot('onboarding-final-light.png', { fullPage: true });
});
