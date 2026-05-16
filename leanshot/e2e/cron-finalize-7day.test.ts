/**
 * Phase 22 plan 22-01 Wave 0 scaffold — cron-finalize 7-day window e2e.
 * Owner of impl: plan 22-05.
 *
 * Mirrors Phase 7's cron-finalize 30-day pattern with the back-date helper updated to
 * `now() - interval '8 days'` to fall outside the new 7-day grace window.
 */
import { describe, it } from 'vitest';

describe.skip('Phase 22 — finalize 7-day cron [DEFERRED — Wave 0 scaffold; impl in plan 22-05]', () => {
  it('back-date initiated_at 8 days + run_finalize_account_deletions_cron_now() → user gone', () => {});
  it('back-date initiated_at 6 days → row remains (within grace)', () => {});
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-05
