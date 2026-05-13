import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Phase 5 05-01: e2e/rls-*.test.ts are VITEST cross-tenant RLS proofs (not
  // Playwright). They use vitest globals + the supabase-js client and run via
  // `npm run test:e2e:rls`. Restrict Playwright to *.spec.ts so it doesn't
  // crash trying to load vitest expect helpers (pre-existing Phase 4 issue).
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  // Retry once on CI to tolerate flake; never locally
  retries: process.env.CI ? 1 : 0,
  // Sequential in CI for stability; parallel locally
  workers: process.env.CI ? 1 : undefined,
  // Chromium only (D-06; full cross-browser is Phase 2+)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // CI uses preview build (matches production); local reuses dev server
  webServer: process.env.CI
    ? {
        command: 'npm run preview',
        port: 4173,
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : {
        command: 'npm run dev',
        port: 5173,
        reuseExistingServer: true,
        timeout: 60_000,
      },
  use: {
    baseURL: process.env.CI ? 'http://localhost:4173' : 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  // Phase 13 Plan 13-06 D-04/D-05/D-06 — visual regression defaults.
  // - maxDiffPixelRatio 0.01 = 1% tolerance for font subpixel + GPU drift between
  //   CI Linux baselines and local macOS dev runs.
  // - animations 'disabled' freezes framer-motion / CSS transitions at frame 0 so
  //   sidebar indicator + AIAvatar pulse render deterministically.
  // - snapshotPathTemplate consolidates ALL 12 VR baselines under one
  //   __screenshots__ folder regardless of which spec produces them.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: 'disabled',
    },
  },
  snapshotPathTemplate: '{testDir}/visual/__screenshots__/{testFilePath}-{arg}{ext}',
  // Phase 7 diagnostic: emit HTML report so the CI failure-upload step actually
  // has files to upload. Without an html reporter Playwright defaults to list
  // and never creates leanshot/playwright-report/, so the upload step warns
  // "No files were found" and we lose trace evidence.
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ]
    : 'list',
});
