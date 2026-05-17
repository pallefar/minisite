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
    // Phase 29 plan 29-03: added stripe-namespace-separation.test.ts (ORG-08 CI proof).
    include: [
      'e2e/rls-*.test.ts',
      'e2e/admin-impersonation-write-deny.test.ts',
      'e2e/cron-finalize-7day.test.ts',
      'src/lib/__tests__/rls-org-*.test.ts',
      'src/lib/__tests__/stripe-namespace-separation.test.ts',
    ],
    testTimeout: 30000,
  },
});
