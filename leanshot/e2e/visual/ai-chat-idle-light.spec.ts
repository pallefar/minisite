import { expect, test } from '@playwright/test';

import { seedOnboarded, waitForReady } from './helpers/seed';

test('AI chat panel idle — light theme (AIAvatar v2 organic mesh)', async ({ page }) => {
  await seedOnboarded(page, { aiPanelOpen: true });
  await page.goto('/');
  await waitForReady(page);
  // AIChatPanel open state lives in App.tsx useState. Open via Topbar
  // "Ask AI" button (aria-label="Ask AI"; see Topbar.tsx).
  await page.getByRole('button', { name: 'Ask AI' }).first().click();
  // Wait for the panel's aria-label to mount.
  await page.waitForSelector('[aria-label="LeanShot AI coach"]', { state: 'visible' });
  await waitForReady(page);
  await expect(page).toHaveScreenshot('ai-chat-idle-light.png', { fullPage: true });
});
