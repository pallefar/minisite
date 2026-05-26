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
    ],
  },
});
