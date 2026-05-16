/**
 * Phase 22 Plan 22-08 — /admin/cohorts page (ADMIN-08).
 *
 * Wraps CohortHeatmap with the admin_get_cohort_retention RPC call. Default
 * window is 13 weeks; "Show all weeks" toggle expands to 52 (server-side cap).
 *
 * Dual-layer security (D-05 Pattern S1):
 *   - Server: admin_get_cohort_retention is is_staff-gated (42501 forbidden).
 *   - Client: inline profiles.is_staff probe (mirrors AdminAffiliatesScaffold).
 *
 * Default-export for App.tsx React.lazy() route registration in plan 22-12.
 */
import { useEffect, useState } from 'react';

import { CohortHeatmap, type CohortCell } from '@/components/admin/cohorts/CohortHeatmap';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

const DEFAULT_WEEKS = 13;
const ALL_WEEKS = 52;

function NotAuthorizedCard() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12 text-center">
        <h1 className="text-xl font-semibold mb-2">This area is for admins only</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          You don&apos;t have access to the admin console.
        </p>
        <a
          href="/"
          className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
        >
          Back to home →
        </a>
      </Card>
    </main>
  );
}

export function AdminCohortsPage() {
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<CohortCell[] | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Probe is_staff.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setIsStaff(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff')
        .eq('id', uid)
        .maybeSingle();
      const staff = (profile as { is_staff?: boolean } | null)?.is_staff === true;
      if (!cancelled) setIsStaff(staff);
    })().catch(() => {
      if (!cancelled) setIsStaff(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch cohort data.
  useEffect(() => {
    if (isStaff !== true) return;
    let cancelled = false;
    const weeks = showAll ? ALL_WEEKS : DEFAULT_WEEKS;
    setErrorMessage('');
    void (async () => {
      const { data, error } = await supabase.rpc('admin_get_cohort_retention', {
        p_weeks: weeks,
      });
      if (cancelled) return;
      if (error) {
        setErrorMessage(error.message ?? 'Failed to load cohort data');
        setRows([]);
        return;
      }
      setRows((data ?? []) as CohortCell[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaff, showAll]);

  if (isStaff === undefined) return null;
  if (!isStaff) return <NotAuthorizedCard />;

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Cohort retention</h1>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-pressed={showAll}
          className="inline-flex items-center h-8 px-3 rounded-pill text-[13px] font-medium border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text)] hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
        >
          {showAll ? 'Show last 13 weeks' : 'Show all weeks'}
        </button>
      </header>

      {errorMessage && (
        <Card variant="flat" padding="md" className="mb-4">
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {errorMessage}
          </p>
        </Card>
      )}

      {rows === null && !errorMessage && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading cohort data…</p>
      )}

      {rows !== null && (
        <Card variant="default" padding="md">
          <CohortHeatmap rows={rows} />
        </Card>
      )}
    </main>
  );
}

export default AdminCohortsPage;
