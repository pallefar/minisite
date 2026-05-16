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
    include: [
      'e2e/rls-*.test.ts',
      'e2e/admin-impersonation-write-deny.test.ts',
      'e2e/cron-finalize-7day.test.ts',
    ],
    testTimeout: 30000,
  },
});
