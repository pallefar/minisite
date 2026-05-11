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
});
