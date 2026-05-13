import { expect, test } from '@playwright/test';

import { seedOnboarded, stubAiThinking, waitForReady } from './helpers/seed';

// File-level: force reduced-motion so the AIAvatar pulse + thinking dots
// render at their static frame for a deterministic snapshot.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('AI chat panel thinking — light theme (reduced-motion fallback)', async ({ page }) => {
  await seedOnboarded(page, { aiPanelOpen: true, aiThinking: true });
  // Stub the ai-chat Edge Function / Anthropic call to never resolve, so
  // the panel sits in `busy=true` state forever.
  await stubAiThinking(page);
  await page.goto('/');
  await waitForReady(page);
  await page.getByRole('button', { name: 'Ask AI' }).first().click();
  await page.waitForSelector('[aria-label="LeanShot AI coach"]', { state: 'visible' });
  // Type a message and send to enter the thinking state.
  const composer = page.getByPlaceholder(/Ask|message|coach/i).first();
  await composer.fill('How am I doing this week?');
  await page.getByRole('button', { name: 'Send' }).click();
  // Wait long enough for the busy state + thinking dots to render.
  await page.waitForTimeout(200);
  await waitForReady(page);
  await expect(page).toHaveScreenshot('ai-chat-thinking-light.png', { fullPage: true });
});
