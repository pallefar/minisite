/**
 * Phase 62 Plan 62-07 — Dedicated vitest config for ResearchConsentSection unit tests.
 * Uses jsdom environment + @testing-library/react.
 * Run: npx vitest run --config vitest.62-07.config.ts
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'src/components/dashboard/settings/__tests__/ResearchConsentSection.test.tsx',
    ],
    setupFiles: [],
  },
});
