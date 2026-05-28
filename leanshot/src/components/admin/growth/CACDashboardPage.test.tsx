/**
 * Phase 33 Plan 33-05 — CACDashboardPage unit tests (ADETL-04, ADETL-05).
 *
 * SETUP NEEDED TO RUN:
 * This project does not have a vitest config for component unit tests.
 * CLAUDE.md confirms no vitest.config.ts exists for the leanshot/ SPA.
 * To enable these tests, add vitest + jsdom + @testing-library/react:
 *
 *   npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom
 *
 * And create leanshot/vitest.config.ts:
 *   import { defineConfig } from 'vitest/config';
 *   import react from '@vitejs/plugin-react';
 *   import { fileURLToPath, URL } from 'node:url';
 *   export default defineConfig({
 *     plugins: [react()],
 *     resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
 *     test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
 *   });
 *
 * Track this in: .planning/deferred-tests.md (Phase 33, CACDashboardPage unit tests).
 */

import { describe, expect, it } from 'vitest';

describe('CACDashboardPage [DEFERRED — needs vitest+jsdom setup]', () => {
  // see deferred-tests.md#cac-dashboard-vitest-jsdom-setup
  it.skip('renders "Credentials missing" badge when health row has credentials_present=false [DEFERRED — see deferred-tests.md]', () => {
    // TODO: render <CACDashboardPage /> with mocked supabase returning
    // healthRows: [{ network: 'meta', credentials_present: false, ... }]
    // expect(screen.getByText('Credentials missing')).toBeInTheDocument();
    expect(true).toBe(true);
  });

  // see deferred-tests.md#cac-dashboard-vitest-jsdom-setup
  it.skip('renders CAC value when cacRows has data [DEFERRED — see deferred-tests.md]', () => {
    // TODO: render <CACDashboardPage /> with mocked supabase returning
    // cacRows: [{ network: 'meta', spend_usd_at_spend_date: 100, attributed_conversions: 10, ... }]
    // expect(screen.getByText('$10.00')).toBeInTheDocument();
    expect(true).toBe(true);
  });

  // see deferred-tests.md#cac-dashboard-vitest-jsdom-setup
  it.skip('renders "No spend data" EmptyState when cacRows is empty [DEFERRED — see deferred-tests.md]', () => {
    // TODO: render <CACDashboardPage /> with mocked supabase returning cacRows: []
    // expect(screen.getByText('No spend data')).toBeInTheDocument();
    expect(true).toBe(true);
  });

  // see deferred-tests.md#cac-dashboard-vitest-jsdom-setup
  it.skip('CSV export button click triggers download [DEFERRED — see deferred-tests.md]', () => {
    // TODO: render <CACDashboardPage /> with cacRows data, mock window.open,
    // click 'Export CSV' button, expect URL.createObjectURL to have been called.
    expect(true).toBe(true);
  });
});
