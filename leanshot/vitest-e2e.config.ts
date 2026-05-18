import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Phase 22 plan 22-12: extended to include admin-impersonation-write-deny
    // + cron-finalize-7day (vitest live-DB tests not prefixed with `rls-`).
    // Phase 28 plan 28-01: extended to include P28 org-scoped RLS suites
    // (in src/lib/__tests__/rls-org-*.test.ts per plan spec).
    // Phase 29 plan 29-01: extended to include count-active-patients D-01 invariant tests.
    // Phase 29 plan 29-03: added stripe-namespace-separation.test.ts (ORG-08 CI proof).
    // Phase 30 plan 30-05: added P30 unit/invariant test files (CLIN-01/04/05).
    //   - rank-org-patients-weights: SECDEF custom weights + NULL-fallback parity.
    //   - clinician-alert-debounce: debounce_key UNIQUE constraint invariant (CLIN-04).
    //   - clinician-alert-auto-resolve: auto-resolve cron status transition (D-10).
    //   - mv-clinic-alert-metrics: matview CONCURRENTLY refresh + shape (CLIN-05).
    // Phase 27 plan 27-04: funnel-anomaly detection + 4h suppression integration
    //   tests (TAXO-05 + SC#5). Live-DB; auto-skip absent service-role key.
    include: [
      'e2e/rls-*.test.ts',
      'e2e/admin-impersonation-write-deny.test.ts',
      'e2e/cron-finalize-7day.test.ts',
      'src/lib/__tests__/rls-org-*.test.ts',
      'src/lib/__tests__/count-active-patients.test.ts',
      'src/lib/__tests__/stripe-namespace-separation.test.ts',
      'src/lib/__tests__/rank-org-patients-weights.test.ts',
      'src/lib/__tests__/clinician-alert-debounce.test.ts',
      'src/lib/__tests__/clinician-alert-auto-resolve.test.ts',
      'src/lib/__tests__/mv-clinic-alert-metrics.test.ts',
      'tests/integration/funnel-anomaly-detection.test.ts',
      'tests/integration/anomaly-suppression.test.ts',
    ],
    testTimeout: 30000,
  },
});
