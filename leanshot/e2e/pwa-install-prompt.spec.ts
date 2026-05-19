/**
 * Phase 42 Plan 04 (POLISH-07 / D-16 / Pitfall 2) — e2e: install-prompt
 * deferral, state machine, and standalone-mode gating.
 *
 * Behavior (Plan 42-04 Task 3 <behavior>):
 *   e2e-3: Fresh localStorage + 1 visit → card NOT visible. 3 visits + a
 *          synthesized beforeinstallprompt → card visible. Click "Maybe
 *          later" → card hidden + localStorage state.snoozed_until ~30d
 *          in the future.
 *   e2e-4: localStorage state === 'installed' → card never shown.
 *          matchMedia('(display-mode: standalone)') matches → also never
 *          shown.
 *
 * Per [[reference_playwright_state_seeding]]: localStorage seeded via
 * page.addInitScript before navigation so the React mount sees the
 * intended state. The TEST HOOK
 * `window.__leanshot_simulate_install_prompt` (declared in
 * src/lib/pwa/install-prompt.ts) replaces a real beforeinstallprompt
 * event which Chromium will not let Playwright synthesize.
 */
import { expect, test } from '@playwright/test';

const STATE_KEY = 'leanshot_install_state_v1';
const VISIT_KEY = 'leanshot_dashboard_visit_count_v1';

test.describe('@phase42 PWA install prompt (D-16, Pitfall 2)', () => {
  test('e2e-3: visits<3 hides card; visits>=3 + prompt captured shows card; Maybe later snoozes 30d', async ({
    page,
  }) => {
    // Pre-seed: 1 visit (gate is >=3).
    await page.addInitScript(
      ({ visitKey, stateKey }) => {
        try {
          localStorage.removeItem(stateKey);
          localStorage.setItem(visitKey, '1');
          // Install the test hook BEFORE any module loads it.
          (window as unknown as { __leanshot_simulate_install_prompt: unknown }).__leanshot_simulate_install_prompt =
            {
              prompt: () => Promise.resolve(),
              userChoice: Promise.resolve({ outcome: 'dismissed' }),
            };
        } catch {
          // private-mode noop
        }
      },
      { visitKey: VISIT_KEY, stateKey: STATE_KEY },
    );
    await page.goto('/');
    await expect(page.getByTestId('install-prompt-card')).toHaveCount(0);

    // Bump visit count to 3 directly (simulating two more HomeTab mounts).
    await page.evaluate((key) => localStorage.setItem(key, '3'), VISIT_KEY);
    // Fire the tick event so the hook re-evaluates.
    await page.evaluate(() =>
      window.dispatchEvent(new Event('leanshot:install-prompt-tick')),
    );
    await expect(page.getByTestId('install-prompt-card')).toBeVisible({ timeout: 5_000 });

    // Click "Maybe later".
    const before = Date.now();
    await page.getByTestId('install-prompt-later').click();
    await expect(page.getByTestId('install-prompt-card')).toHaveCount(0);

    // localStorage snoozed_until ~30d in the future.
    const stateRaw = await page.evaluate((key) => localStorage.getItem(key), STATE_KEY);
    expect(stateRaw).not.toBeNull();
    const parsed = JSON.parse(stateRaw as string) as {
      state: string;
      snoozed_until?: string;
    };
    expect(parsed.state).toBe('snoozed');
    expect(parsed.snoozed_until).toBeDefined();
    const snoozedMs = new Date(parsed.snoozed_until!).getTime();
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    // Allow ±5s test-run drift.
    expect(Math.abs(snoozedMs - expected)).toBeLessThan(5_000);
  });

  test('e2e-4: state=installed in localStorage → card never shown, even with visits>=3 + prompt', async ({
    page,
  }) => {
    await page.addInitScript(
      ({ visitKey, stateKey }) => {
        try {
          localStorage.setItem(visitKey, '5');
          localStorage.setItem(
            stateKey,
            JSON.stringify({ state: 'installed', last_event_at: new Date().toISOString() }),
          );
          (window as unknown as { __leanshot_simulate_install_prompt: unknown }).__leanshot_simulate_install_prompt =
            {
              prompt: () => Promise.resolve(),
              userChoice: Promise.resolve({ outcome: 'dismissed' }),
            };
        } catch {
          // private-mode noop
        }
      },
      { visitKey: VISIT_KEY, stateKey: STATE_KEY },
    );
    await page.goto('/');
    await page.evaluate(() =>
      window.dispatchEvent(new Event('leanshot:install-prompt-tick')),
    );
    // Give the React effect a tick.
    await page.waitForTimeout(500);
    await expect(page.getByTestId('install-prompt-card')).toHaveCount(0);
  });
});
