/**
 * Phase 42 Plan 04 (POLISH-07) — e2e: offline banner + offline logging gate.
 *
 * Behavior (Plan 42-04 Task 3 <behavior>):
 *   e2e-1: With page online → no OfflineBanner present. After
 *          context.setOffline(true) → OfflineBanner appears with verbatim
 *          D-13 copy.
 *   e2e-2: While offline, the offline-store disableLogging() invariant is
 *          true (logging surfaces gate on this in Wave 3). Verified by
 *          asserting the banner is visible AND a synthetic call to the
 *          exposed disableLogging() flag (window probe) returns true.
 *
 * Per [[reference_playwright_state_seeding]]: use page.addInitScript so the
 * pre-paint state is deterministic.
 */
import { expect, test } from '@playwright/test';

test.describe('@phase42 PWA offline banner (D-13)', () => {
  test('e2e-1: banner hidden when online, visible after context.setOffline', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    // Wait for the PWA bootstrap useEffect to install the offline listeners.
    await page.waitForFunction(
      () =>
        (window as unknown as { __leanshot_pwa_ready?: boolean }).__leanshot_pwa_ready === true,
      undefined,
      { timeout: 10_000 },
    );
    // Banner not visible while online.
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);

    await context.setOffline(true);
    // Wait for the offline event to propagate to the store + React subscriber.
    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('offline-banner')).toContainText(
      "You’re offline — logging resumes when reconnected.",
    );

    // Reset for next test.
    await context.setOffline(false);
  });

  test('e2e-2: while offline, disableLogging() returns true (logging UI gate)', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await page.waitForFunction(
      () =>
        (window as unknown as { __leanshot_pwa_ready?: boolean }).__leanshot_pwa_ready === true,
      undefined,
      { timeout: 10_000 },
    );

    // Online: disableLogging is false.
    const initiallyOnline = await page.evaluate(async () => {
      const mod = (await import('/src/lib/pwa/offline-store.ts')) as typeof import(
        '/src/lib/pwa/offline-store.ts'
      );
      return mod.disableLogging();
    });
    expect(initiallyOnline).toBe(false);

    await context.setOffline(true);
    // Wait for the 'offline' event listener to update the store.
    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 5_000 });

    const offline = await page.evaluate(async () => {
      const mod = (await import('/src/lib/pwa/offline-store.ts')) as typeof import(
        '/src/lib/pwa/offline-store.ts'
      );
      return mod.disableLogging();
    });
    expect(offline).toBe(true);

    await context.setOffline(false);
  });
});
