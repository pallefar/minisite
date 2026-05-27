import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 69 Plan 69-04 — v1.4 Visual-Review (VR) snapshot suite.
 *
 * Separate config (NOT the main `playwright.config.ts`) to isolate VR runs
 * for v1.4 surfaces (Phases 65/66/68) from the existing e2e + visual suites.
 *
 * Scope:
 *   - `tests/vr/v1.4/baseline.spec.ts` only (testDir below points there).
 *   - 7 routes × 4 variants (light/dark × desktop-1280 / mobile-375) = 28 snapshots.
 *
 * Operator usage (see `tests/vr/v1.4/README.md` for full guide):
 *
 *   # First-time baseline capture (against staging):
 *   PLAYWRIGHT_BASE_URL=https://staging.leanshot.app \
 *     npx playwright test --config playwright.config.vr.ts --update-snapshots
 *
 *   # Regression run:
 *   PLAYWRIGHT_BASE_URL=https://staging.leanshot.app \
 *     npx playwright test --config playwright.config.vr.ts
 *
 *   # Local dev (Vite must already be running on :5173):
 *   npx playwright test --config playwright.config.vr.ts
 *
 * Baselines are NOT committed in Phase 69-04. The operator captures them
 * against the post-deploy staging build and commits the approved PNGs in a
 * follow-up commit (see README "Baseline-capture procedure").
 */

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  // Scoped to the v1.4 VR spec — does NOT pick up anything in `e2e/` or
  // sibling test trees. The main config in `playwright.config.ts` continues
  // to own those.
  testDir: './tests/vr/v1.4',

  // Reasonable VR defaults: serial within file (themes share a Page worker),
  // retries off (a flaky VR snapshot should fail loudly), fullyParallel across
  // files (each route gets its own worker). One worker locally to keep
  // snapshot disk-writes deterministic during --update-snapshots; CI override
  // via `--workers=N`.
  fullyParallel: true,
  retries: 0,
  workers: process.env.CI ? 2 : 1,

  // Tolerate sub-pixel font/AA noise without masking real regressions. 0.5%
  // pixel-diff is the Playwright VR default — keep it explicit for review
  // clarity.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
      // Animations must be off so motion-y components (framer-motion sheets,
      // CSS transitions) render to a deterministic frame. The app respects
      // `prefers-reduced-motion` via `useReducedMotion`.
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  // Single baseline tree under tests/vr/v1.4/__screenshots__/<file>/<arg>
  // mirrors the main e2e suite's convention (see playwright.config.ts:420).
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFilePath}-{arg}{ext}',

  use: {
    baseURL: BASE_URL,
    // Disable animations + prefers-reduced-motion at the browser level (the
    // toHaveScreenshot `animations: 'disabled'` flag handles the
    // assertion-time pause; this hardens the app's runtime path too).
    reducedMotion: 'reduce',
    // Capture context on failure so reviewers can compare diff + trace.
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
  },

  // Two viewports × spec drives the theme dimension via seedThemeDark.
  // 4 variants per page = 2 viewports × {light, dark} themes encoded inside
  // the spec file. We DO NOT use `emulateMedia({ colorScheme })` here — the
  // app sets `data-theme` on `<html>` from `localStorage['leanshot_theme_v4']`
  // BEFORE React mounts (see src/main.tsx pre-paint), so OS color-scheme is
  // ignored. The spec uses `seedThemeDark()` (addInitScript) to drive theme.
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 667 },
      },
    },
  ],

  // No webServer — operator is expected to run against either staging
  // (PLAYWRIGHT_BASE_URL) or a locally-running `npm run dev` instance. Wiring
  // a webServer here would conflict with the staging-first workflow.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
});
