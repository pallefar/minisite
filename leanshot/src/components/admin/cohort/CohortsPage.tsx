/**
 * Phase 27 Plan 27-02 — CohortsPage wrapper.
 *
 * Composes AdminCohortBuilder + AdminCohortList into a single admin module
 * surface. Default-exported so an ADMIN_MODULES entry can `lazy: () =>
 * import('@/components/admin/cohort/CohortsPage')` to it without bespoke
 * `.then` unwrapping.
 *
 * The current Phase 24 ADMIN_MODULES 'membership' entry points at
 * AdminCohortsPage (the Phase 22 retention-heatmap surface). Replacing the
 * entry pointer requires editing leanshot/src/lib/admin/modules.ts, which
 * Phase 24 owns — per [[feedback_planner_iter1_anti_patterns]] no-shared-file-
 * choreography we DO NOT edit it here. Surface the gap in 27-02-SUMMARY for
 * the verifier and the Phase 27 integration addendum.
 */
import { useState, useCallback } from 'react';
import { AdminCohortBuilder } from './AdminCohortBuilder';
import { AdminCohortList } from './AdminCohortList';

export default function CohortsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const handleSaved = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6 space-y-6 max-w-4xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Cohorts</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Define reusable audience segments for paywalls, recommendations, challenges, and saves.
          Cohort membership is rebuilt every 15 minutes.
        </p>
      </header>
      <AdminCohortBuilder onSaved={handleSaved} />
      <AdminCohortList key={reloadKey} />
    </main>
  );
}
