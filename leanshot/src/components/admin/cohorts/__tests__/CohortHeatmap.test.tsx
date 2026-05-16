/**
 * Phase 22 plan 22-01 Wave 0 scaffold — CohortHeatmap (ADMIN-08).
 * Owner of impl: plan 22-06 (cohort retention page).
 *
 * Behaviors deferred:
 *   - Renders 13 cohort-week rows × 91 day-offset columns
 *   - K-anonymity guard: cells with active_users < 10 render "<10" instead of percentage
 */
import { describe, it } from 'vitest';

import { CohortHeatmap } from '@/components/admin/cohorts/CohortHeatmap';

describe('CohortHeatmap (Phase 22 ADMIN-08)', () => {
  it.skip('renders 13 × 91 cell grid from cohort_retention data [DEFERRED — Wave 0 scaffold; impl in plan 22-06]', () => {
    void CohortHeatmap;
  });
  it.skip('cells with active_users < 10 render "<10" [DEFERRED — Wave 0 scaffold; impl in plan 22-06]', () => {
    void CohortHeatmap;
  });
});

// Wave 0 scaffold per .planning/phases/22-…/22-RESEARCH.md §Validation Architecture — DEFERRED implementation owner: 22-06
