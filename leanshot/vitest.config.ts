/**
 * Phase 38 Plan 38-10 — top-level vitest config that registers the
 * `phase38-eval` Vitest project for the AI-SPEC §5 evaluation harness.
 * Phase 60 Plan 60-03 — adds the `phase60-eval` sibling project for the
 * Phase 60 RAG evaluation harness (all 13 AI-SPEC §5 dimensions).
 * Phase 62 Plan 62-02 — adds the `phase62-eval` sibling project for the
 * Phase 62 Insights & Research Engine privacy + SECDEF invariant tests.
 *
 * Other test surfaces continue to use their dedicated configs:
 *   - vitest-mobile.config.ts  (mobile-unit)
 *   - vitest-e2e.config.ts     (RLS + integration)
 *
 * Per project memory `reference_minisite_monorepo_layout`: git root lives
 * at `/Users/karstenhaldan/minisite`; this file lives at `leanshot/`. The
 * Phase 38 eval tests live at git-root `tests/eval/phase38/**` per
 * 38-10-PLAN.md `files_modified`. The Phase 60 eval tests live at
 * git-root `tests/eval/phase60/**` per 60-03-PLAN.md `files_modified`.
 * The Phase 62 eval tests live at git-root `eval/phase62/**` per
 * 62-02-PLAN.md `files_modified`.
 * Paths below are resolved relative to this config file → `..` walks up
 * to git root.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // vite-plugin-pwa's virtual module — VitePWA plugin isn't loaded
      // under vitest, so register.test.ts can't resolve the import otherwise.
      'virtual:pwa-register': fileURLToPath(
        new URL('./src/lib/pwa/__mocks__/virtual-pwa-register.ts', import.meta.url),
      ),
    },
  },
  test: {
    // Default project: src/ unit tests (matches the default `npm run test:unit`
    // surface; vitest CLI without `--project` picks this up).
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Phase 70-07 cascade-15 — native bridge tests are owned by
    // vitest-mobile.config.ts (which aliases @capacitor/* + @revenuecat/*
    // to vi.fn() mocks under src/lib/native/__mocks__/). Without those
    // aliases the real modules load and every test fails with
    // `Capacitor.getPlatform.mockReturnValue is not a function`.
    // Excluded here AND on the `src-lib-unit` / `src-ui-unit` projects
    // below so the multi-project default run skips them too. See
    // [[reference-multiple-vitest-configs-include-overlap]].
    exclude: [
      'e2e/**',
      'node_modules/**',
      'dist/**',
      'src/lib/native/**',
      'src/components/BiometricGate.test.tsx',
    ],
    projects: [
      {
        // Phase 38 evaluation harness — AI-SPEC §5 dimension tests.
        // Skips locally when STAGING_BASE_URL unset; gates CI in
        // .github/workflows/phase38-eval-nightly.yml.
        test: {
          name: 'phase38-eval',
          environment: 'node',
          globals: true,
          include: ['../tests/eval/phase38/**/*.test.ts'],
          testTimeout: 60_000,
          // JUnit XML output for CI parsing (Slack alert artifact).
          reporters: process.env.CI
            ? ['default', ['junit', { outputFile: '../tests/eval/phase38-junit.xml' }]]
            : ['default'],
        },
      },
      {
        // Phase 60 RAG evaluation harness — all 13 AI-SPEC §5 dimension tests.
        // RED state by design until 60-04..07 deploy the RAG Edge Fns.
        // Run: npm run test:eval:phase60
        // Gate: .github/workflows/eval-phase60.yml
        test: {
          name: 'phase60-eval',
          environment: 'node',
          globals: true,
          include: ['../tests/eval/phase60/**/*.test.ts'],
          testTimeout: 60_000,
          // JUnit XML output for CI parsing (Slack alert artifact).
          reporters: process.env.CI
            ? ['default', ['junit', { outputFile: '../tests/eval/phase60-junit.xml' }]]
            : ['default'],
        },
      },
      {
        // Phase 62 Insights & Research Engine eval harness — k-anonymity, Laplace
        // noise, consent schema, and 2-person review invariant tests.
        // Source-level tests are GREEN immediately; live SQL test (laplace-noise)
        // requires SUPABASE_DB_URL and is it.skip'd without it.
        // Run: cd leanshot && npx vitest run --project=phase62-eval
        test: {
          name: 'phase62-eval',
          environment: 'node',
          globals: true,
          include: ['../eval/phase62/**/*.test.ts'],
          testTimeout: 60_000,
          // JUnit XML output for CI parsing.
          reporters: process.env.CI
            ? ['default', ['junit', { outputFile: '../eval/phase62-junit.xml' }]]
            : ['default'],
        },
      },
      {
        // Edge Function unit tests (Vitest, no Deno runtime).
        // handler.ts files use DI — no Deno.* imports — so they run cleanly here.
        // Run: npx vitest run --project=functions-unit
        // Phase 61 protocol-ai-assist + Phase 62 research-publish handlers.
        test: {
          name: 'functions-unit',
          environment: 'node',
          globals: true,
          include: ['../supabase/functions/**/__tests__/*.test.ts'],
        },
      },
      {
        // Pure src/lib utility unit tests (no React, no DOM needed).
        // Includes markdown renderers, pure logic libs, etc.
        // Run: npx vitest run --project=src-lib-unit
        // Phase 62: research-renderer.ts + protocol-shortcode-plugin.ts tests.
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            'markdown-it': '/Users/karstenhaldan/minisite/leanshot/node_modules/markdown-it/index.mjs',
            // vite-plugin-pwa virtual module — see top-level resolve.alias comment.
            'virtual:pwa-register': fileURLToPath(
              new URL('./src/lib/pwa/__mocks__/virtual-pwa-register.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'src-lib-unit',
          // Phase 70-07 cascade-16 — jsdom, not node. The original "pure
          // logic" framing didn't match scope: src/lib/storage, store,
          // migration, anonymous/cookie, ads/adsense, etc. all touch
          // localStorage / document.cookie / navigator. Running under
          // 'node' threw ReferenceError: localStorage is not defined
          // across 100+ tests. jsdom is the right env for src/lib here.
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test-setup.ts'],
          include: ['src/lib/**/__tests__/*.test.ts', 'src/lib/**/*.test.ts'],
          // Phase 70-07 cascade-15 — see top-level exclude comment.
          exclude: ['src/lib/native/**'],
        },
      },
      {
        // Phase 62 — React component unit tests (jsdom + @testing-library/react).
        // Consolidated from Plan 62-04 (src-ui-unit) + Plan 62-07 (src-components).
        // plugins:[react()] required for JSX automatic-runtime transform; tests
        // assume React is auto-imported (no explicit `import React`).
        // Covers admin/research/* + dashboard/settings/* + any future src/components tests.
        // Run: npx vitest run --project=src-ui-unit
        plugins: [react()],
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
          },
        },
        test: {
          name: 'src-ui-unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test-setup.ts'],
          include: [
            'src/components/**/__tests__/*.test.tsx',
            'src/components/**/__tests__/*.test.ts',
            'src/components/**/*.test.tsx',
            'src/components/**/*.test.ts',
          ],
          // Phase 70-07 cascade-15 — see top-level exclude comment.
          exclude: ['src/components/BiometricGate.test.tsx'],
        },
      },
    ],
  },
});
