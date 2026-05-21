/**
 * Phase 34 Plan 34-10 — onboarding-mobile-lighthouse.spec.ts (ONBOARD-10).
 *
 * Asserts mobile Lighthouse ≥90 on /onboard with throttling (4x CPU + 1.6Mbps net,
 * applied via the simulate throttler in scripts/lighthouse-onboarding.mjs).
 *
 * Gate: PLAYWRIGHT_RUN_LIGHTHOUSE=1 (env var only — per
 * [[reference_playwright_conditional_project_argv]], argv detection fails in
 * worker subprocesses). Excluded from default chromium project via testIgnore.
 *
 * Why we shell out to scripts/lighthouse-onboarding.mjs instead of running the
 * lighthouse library inline: the lighthouse ESM package + Playwright's worker
 * runtime have a fragile module-resolution interaction on Node 22.x. A
 * subprocess boundary makes the audit deterministic and matches NEW-W-01
 * plan-checker carry-over ("Lighthouse script ESM, not CommonJS").
 *
 * If the score falls below 90, this spec FAILS (hard). Per
 * [[feedback_defer_then_batch_fix_pattern]]: do NOT add test.fixme inline —
 * instead, document the measured number in `.planning/deferred-tests.md` and
 * triage as a follow-up plan.
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const E2E_BASE_URL = process.env.E2E_BASE_URL ?? process.env.CI
  ? 'http://localhost:4173'
  : 'http://localhost:5173';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HARNESS = resolve(__dirname, '..', 'scripts', 'lighthouse-onboarding.mjs');

interface LighthouseScores {
  performance: number;
  accessibility: number;
  url: string;
  timestamp: string;
  metrics?: {
    fcp: number | null;
    lcp: number | null;
    tbt: number | null;
    cls: number | null;
  };
}

test.describe('@p34-lighthouse onboarding', () => {
  test.skip(
    process.env.PLAYWRIGHT_RUN_LIGHTHOUSE !== '1',
    'Lighthouse audit is opt-in via PLAYWRIGHT_RUN_LIGHTHOUSE=1 (slow + flaky in parallel CI)'
  );

  test('ONBOARD-10: /onboard mobile Lighthouse ≥90 performance', async () => {
    test.setTimeout(120_000); // Lighthouse audits can take 60s+ end-to-end.

    const out = execSync(`node ${HARNESS} ${E2E_BASE_URL}/onboard`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 110_000,
    });

    // The script may emit log lines from Chromium launch; the final stdout
    // line is the JSON payload. Parse the last non-empty line.
    const lastJsonLine = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();
    expect(lastJsonLine).toBeTruthy();

    const scores = JSON.parse(lastJsonLine!) as LighthouseScores;

    // Accessibility is a soft-assert — we report it for visibility but don't
    // gate on it (axe-baseline.test.ts owns the a11y regression gate).
    expect.soft(scores.accessibility).toBeGreaterThanOrEqual(90);

    // Performance is the hard gate per ONBOARD-10.
    expect(scores.performance).toBeGreaterThanOrEqual(90);
  });
});
