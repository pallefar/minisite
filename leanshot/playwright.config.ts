import { defineConfig, devices } from '@playwright/test';

// Phase 16 16-08: the `aso` ASO-capture project is opt-in via either
// `--project=aso` on the CLI or `PLAYWRIGHT_RUN_ASO=1` in the env. Without
// this gate, the bare `playwright test` invocation in `npm run test` would
// pull in 6 viewport tests for marketing-asset generation (not a regression
// gate). Including it only when explicitly requested keeps the default CI
// suite lean while preserving discoverability via `--project=aso --list`.
const ASO_OPT_IN =
  process.env.PLAYWRIGHT_RUN_ASO === '1' ||
  process.argv.some((a) => a === '--project=aso' || a === 'aso');

// Phase 30 30-05: the `p30` project is opt-in via `PLAYWRIGHT_RUN_P30=1`.
// Owns the 2 Phase 30 realtime e2e specs (SC#1 roster reorder + SC#3 alerts).
// Per [[reference_playwright_conditional_project_argv]]: env-var gate is the
// source of truth; CLI argv detection fails in worker subprocesses.
// The default `chromium` project excludes these specs via testIgnore so they
// only execute under the conditional project.
const P30_OPT_IN = process.env.PLAYWRIGHT_RUN_P30 === '1';

// Phase 31 Plan 31-03: the `p31` project is opt-in via `PLAYWRIGHT_RUN_P31=1`.
// Owns the 3-test first-paint smoke that proves --brand-* CSS custom properties
// land on <html> before React renders branded content (ORG-11 SC#1 contract).
// The spec uses addInitScript to seed localStorage before navigation — it does
// NOT require live Supabase credentials (RPC calls are mocked via the warm-paint
// localStorage path). Gate: PLAYWRIGHT_RUN_P31=1 env var ONLY (never process.argv
// per [[reference_playwright_conditional_project_argv]]).
// The default chromium project excludes this spec via testIgnore so it never
// runs unintentionally in the standard CI suite.
const P31_OPT_IN = process.env.PLAYWRIGHT_RUN_P31 === '1';

// Phase 27 Plan 27-03: opt-in admin command-palette spec via PLAYWRIGHT_RUN_P27=1.
// The spec uses addInitScript-only state seeding (no live Supabase required) but
// the full UI mount is owned by Plan 27-04 (AdminGlobals), so this spec is scoped
// to behaviors that don't require the live mount. Gate by env var per
// [[reference_playwright_conditional_project_argv]].
const P27_OPT_IN = process.env.PLAYWRIGHT_RUN_P27 === '1';

// Phase 32 Plan 32-04: opt-in admin locale-overrides e2e via
// PLAYWRIGHT_RUN_P32_I18N=1. Requires live Supabase service-role + anon key
// to exercise the locale_overrides table + Realtime broadcast + RLS isolation.
// Excluded from the default chromium project via testIgnore so a bare
// `npx playwright test` does not flake on missing creds.
const P32_I18N_OPT_IN = process.env.PLAYWRIGHT_RUN_P32_I18N === '1';

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
      // Phase 16 16-08: exclude the ASO capture spec from the default run so
      // it stays opt-in via `--project=aso`. Without this, chromium (which has
      // no testMatch override) sweeps e2e/aso/** because the root testMatch
      // accepts every *.spec.ts.
      // Phase 30 30-05: exclude Phase 30 realtime e2e specs from the default
      // chromium run. These require PLAYWRIGHT_RUN_P30=1 + live Supabase creds
      // to execute against the realtime channel + deliver-cron Edge Function.
      testIgnore: [
        /e2e\/aso\/.*\.spec\.ts$/,
        /e2e\/clinic-ranking-weights-roster-reorder\.spec\.ts$/,
        /e2e\/clinician-alerts-realtime\.spec\.ts$/,
        /e2e\/clinic-brand-first-paint\.spec\.ts$/,
        /e2e\/patient-org-onboarding\.spec\.ts$/,
        /e2e\/admin-palette\.spec\.ts$/,
        // Phase 32 Plan 32-04: admin locale-overrides e2e requires live
        // Supabase Realtime + service-role; gated by PLAYWRIGHT_RUN_P32_I18N=1.
        /e2e\/i18n-admin-override\.spec\.ts$/,
        // Phase 26 plan 26-01: AFFTIER-01/02 are VITEST live-DB specs (not Playwright).
        // They use vitest globals + supabase-js and run via `npm run test:e2e:rls`.
        // Plan body mandated the .spec.ts filename — exclude here so playwright
        // doesn't try to load them.
        /e2e\/affiliate-tier-stamping\.spec\.ts$/,
        /e2e\/affiliate-tier-promotion\.spec\.ts$/,
      ],
      use: { ...devices['Desktop Chrome'] },
    },
    // Phase 16 16-00: mobile-only Playwright project for IAP flow + 200-photo soak + ASO viewport capture.
    // Filters by e2e/mobile/** so it never picks up chromium specs.
    {
      name: 'mobile',
      testMatch: /e2e\/mobile\/.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 } },
    },
    // Phase 16 16-08: opt-in ASO multi-viewport capture project. Invoke via
    // `npx playwright test --project=aso` OR `PLAYWRIGHT_RUN_ASO=1 npx playwright test`.
    // Per-test setViewportSize handles the 6 D-19 viewports; we don't bake a
    // single viewport into `use` here because each test rewrites it. The
    // project is conditionally included (see ASO_OPT_IN above) so the default
    // CI suite stays lean.
    ...(ASO_OPT_IN
      ? [
          {
            name: 'aso',
            testMatch: /e2e\/aso\/.*\.spec\.ts$/,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    // Phase 30 30-05: opt-in realtime e2e specs for SC#1 (roster reorder) and
    // SC#3 (alert realtime panel). Invoke via `PLAYWRIGHT_RUN_P30=1 npx playwright test --project=p30`.
    // The `testMatch` restricts the project to only the 2 Phase 30 specs so the
    // standard CI run (chromium project) stays unaffected.
    ...(P30_OPT_IN
      ? [
          {
            name: 'p30',
            testMatch: [
              /e2e\/clinic-ranking-weights-roster-reorder\.spec\.ts$/,
              /e2e\/clinician-alerts-realtime\.spec\.ts$/,
            ],
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    // Phase 31 Plan 31-03: opt-in first-paint smoke for path-based white-label.
    // Invoke via `PLAYWRIGHT_RUN_P31=1 npx playwright test --project=p31`.
    // The spec uses addInitScript-seeded localStorage so it does NOT require
    // live Supabase credentials — the warm-paint path is what we're proving.
    // Excluded from default chromium project via testIgnore above.
    ...(P31_OPT_IN
      ? [
          {
            name: 'p31',
            testMatch: [
              /e2e\/clinic-brand-first-paint\.spec\.ts$/,
              /e2e\/patient-org-onboarding\.spec\.ts$/,
            ],
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    // Phase 27 Plan 27-03: opt-in admin command-palette spec.
    // Invoke via `PLAYWRIGHT_RUN_P27=1 npx playwright test --project=p27`.
    // Spec is addInitScript-driven (no live Supabase needed). Full UI mount
    // verification deferred to Plan 27-04 which owns AdminGlobals.
    ...(P27_OPT_IN
      ? [
          {
            name: 'p27',
            testMatch: [/e2e\/admin-palette\.spec\.ts$/],
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    // Phase 32 Plan 32-04 — opt-in admin locale-overrides e2e (Realtime + RLS).
    // Invoke via `PLAYWRIGHT_RUN_P32_I18N=1 npx playwright test --project=p32-i18n`.
    ...(P32_I18N_OPT_IN
      ? [
          {
            name: 'p32-i18n',
            testMatch: [/e2e\/i18n-admin-override\.spec\.ts$/],
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
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
      // Phase 26 26-04 (AFFTIER-06): hard ceiling of 100 diff pixels regardless
      // of ratio so a tight crop (gold premium badge / hero CTA) cannot drift
      // ~50 px without tripping the regression gate. Both bounds apply jointly.
      maxDiffPixels: 100,
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
