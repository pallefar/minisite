/**
 * Phase 16 Plan 16-08 -- ASO multi-viewport capture (EN-only per R4)
 *
 * Deterministic Playwright screenshot capture for App Store + Play Store
 * marketing assets. Iterates the 6 store-required viewports from CONTEXT D-19
 * across 3 key marketing screens and writes PNGs into:
 *   - apps/ios/marketing/screenshots/en-US/
 *   - apps/android/marketing/screenshots/en-US/
 *
 * Locale scope (R4 explicit split, see DEFERRED-LOCALES doc):
 *   .planning/phases/16-capacitor-mobile-shells-ios-android/16-08-DEFERRED-LOCALES.md
 *   EN ships in P16. DE/ES/FR are deferred to v1.2.1 as a store-listing-only
 *   update (no binary re-submission needed). DO NOT add other locales here --
 *   instead add aso-capture-<locale>.spec.ts OR generalize VIEWPORTS x LOCALES.
 *
 * Project wiring:
 *   This spec runs under the opt-in `aso` Playwright project
 *   (testDir: e2e/aso). It is NOT in the default-run set; invoke explicitly:
 *     cd leanshot && npx playwright test --project=aso
 *
 * Maintenance contract:
 *   - Any new D-19 viewport added in v1.2.1 MUST be appended to VIEWPORTS here.
 *   - Any new locale MUST be added as a separate aso-capture-<locale>.spec.ts
 *     OR generalize VIEWPORTS x LOCALES in a single spec.
 *   - SCREENS is the marketing surface set; coordinate any change with the
 *     store-listing-en.md description so the asset count + caption order match.
 *
 * Threat note (T-16-08-01):
 *   Captured PNGs must NOT contain real-account PII. Plan 16-08 Task 4(A)
 *   gates this on a non-PII demo account; the spec itself does not enforce
 *   PII checks beyond what the seed fixture provides.
 */

import { test } from '@playwright/test';

// CONTEXT D-19 -- six store-required marketing viewports.
// Width / height match Apple + Google current ASO requirements (2025).
type StoreSurface = 'ios' | 'android';

interface Viewport {
  name: string;
  width: number;
  height: number;
  store: StoreSurface;
}

const VIEWPORTS: readonly Viewport[] = [
  { name: 'iphone-15-pro-max', width: 430, height: 932, store: 'ios' },
  { name: 'iphone-14', width: 390, height: 844, store: 'ios' },
  { name: 'ipad-pro-12.9', width: 1024, height: 1366, store: 'ios' },
  { name: 'pixel-phone', width: 393, height: 873, store: 'android' },
  { name: 'pixel-tablet', width: 1600, height: 2560, store: 'android' },
  { name: 'wear-os', width: 384, height: 384, store: 'android' },
];

// Three key marketing surfaces.
//
// Note: leanshot does NOT currently support `?tab=` deep-links (verified
// against src/App.tsx -- only `#/settings?upgrade=` is parsed, tab state lives
// in the Zustand store and is driven by setTab actions). So we navigate to '/'
// and click the relevant nav button via aria-label / role.
interface Screen {
  slug: string;
  // Tab id matching MobileNav / Sidebar entries in src/lib/store.ts. 'home' is
  // the default landing tab; the other two require an in-app click after navigation.
  tab: 'home' | 'body' | 'medication';
}

const SCREENS: readonly Screen[] = [
  { slug: 'home', tab: 'home' },
  { slug: 'photo-gallery', tab: 'body' },
  { slug: 'med-level', tab: 'medication' },
];

/**
 * Navigate to the LeanShot dashboard at the given tab. For 'home' this is the
 * default landing surface; for body/medication we click the matching nav
 * button. Falls back to setting Zustand state directly via window if the UI
 * button cannot be located (e.g., onboarding interstitial blocks the dashboard).
 */
async function gotoTab(
  page: import('@playwright/test').Page,
  tab: Screen['tab'],
): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  if (tab === 'home') return;

  // Try the bottom-nav button by accessible name first.
  const navButton = page.getByRole('button', { name: new RegExp(tab, 'i') });
  const count = await navButton.count();
  if (count > 0) {
    await navButton.first().click();
    // Allow any lazy chunk to resolve + framer-motion transition to settle.
    await page.waitForLoadState('networkidle');
    return;
  }

  // Fallback: drive the store directly. This is opt-in only when the nav
  // button is not in the DOM (e.g., dashboard not yet mounted because the user
  // is on marketing/onboarding). The capture spec is best-effort -- a missing
  // tab surface will simply produce a home-screen PNG and the human reviewer
  // in Plan 16-08 Task 4(A) step 6 will catch it.
  await page.evaluate((targetTab) => {
    type StoreShape = { setTab?: (t: string) => void };
    type UseStore = { getState: () => StoreShape };
    const w = window as unknown as { useStore?: UseStore };
    if (w.useStore && typeof w.useStore.getState === 'function') {
      const state = w.useStore.getState();
      state.setTab?.(targetTab);
    }
  }, tab);
  await page.waitForLoadState('networkidle');
}

for (const vp of VIEWPORTS) {
  test(`${vp.name} -- capture key screens`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const screen of SCREENS) {
      await gotoTab(page, screen.tab);
      await page.screenshot({
        path: `apps/${vp.store}/marketing/screenshots/en-US/${vp.name}-${screen.slug}.png`,
        fullPage: false,
      });
    }
  });
}
