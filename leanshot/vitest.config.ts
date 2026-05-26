/**
 * Phase 38 Plan 38-10 — top-level vitest config that registers the
 * `phase38-eval` Vitest project for the AI-SPEC §5 evaluation harness.
 * Phase 60 Plan 60-03 — adds the `phase60-eval` sibling project for the
 * Phase 60 RAG evaluation harness (all 13 AI-SPEC §5 dimensions).
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
 * Paths below are resolved relative to this config file → `..` walks up
 * to git root.
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
    // Default project: src/ unit tests (matches the default `npm run test:unit`
    // surface; vitest CLI without `--project` picks this up).
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
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
    ],
  },
});
