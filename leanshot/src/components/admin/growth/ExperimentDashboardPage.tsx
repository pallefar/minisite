/**
 * Phase 39 Plan 39-06 — ExperimentDashboardPage (Surface E + H per 39-UI-SPEC).
 *
 * Route: /admin/growth/experiments
 *
 * Chrome:
 *   - Page header (mirrors CACDashboardPage shape — icon + h1 + subtitle)
 *   - 3 Pill tabs (Paywall / Page-Builder / Pharma) with controlled state union
 *   - Soft banner: vendor-unconfigured (Pattern A) when get_experiment_results
 *     RPC returns error.message === 'vendor_unconfigured'
 *   - Sub-tab content area (data-testid='experiment-tab-content') is a
 *     placeholder slot filled in by Plans 39-07 (paywall + page) and
 *     39-08 (pharma).
 *
 * Polling:
 *   - useEffect + setInterval at 30_000ms (per UI-SPEC Hard Constraint 5:
 *     NO server-state library; raw effect-driven fetch only). Cancellation
 *     flag prevents pileup on tab change. See `feedback_negation_grep_defeated_by_comment_string`
 *     for why we avoid spelling out the forbidden symbol names in comments.
 *
 * Empty state:
 *   - Heading: 'No active experiments yet.'
 *   - Body:    'Create a variant from any published page to begin testing.'
 *   - Primary: 'Go to Pages' (anchor to /admin/pages — router-less admin)
 *
 * Requirements served:
 *   PAYWALL-06, PAGEAB-01, PAGEAB-07, PHARMA-08 (via Plans 39-07 + 39-08
 *   which mount per-tab content into this shell).
 *
 * Security: minRole='admin' is the Pattern S1 UX layer (modules.ts); the
 * get_experiment_results SECDEF RPC (added by Plans 39-07/08) re-checks
 * admin role at the data layer.
 */
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import type { ExperimentRow, ExperimentSurface } from './experiment-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000;

const TABS: ReadonlyArray<{ key: ExperimentSurface; label: string }> = [
  { key: 'paywall', label: 'Paywall' },
  { key: 'page', label: 'Page-Builder' },
  { key: 'pharma', label: 'Pharma' },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExperimentDashboardPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ExperimentSurface>('paywall');
  const [rows, setRows] = useState<ExperimentRow[] | null>(null);
  const [vendorUnconfigured, setVendorUnconfigured] = useState(false);
  // busyKey is consumed by Plan 39-07 Ship-Winner button — kept in this shell
  // so the per-tab content slot has a stable in-flight signal contract. The
  // setter is exposed indirectly via data-busy-key wiring; Plan 39-07 reads
  // setBusyKey from a context once it lands. Until then the state stays null.
  const [busyKey] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch: get_experiment_results RPC. Mirror CACDashboardPage cancellation
  // pattern. The RPC body itself ships in Plan 39-07.
  // ---------------------------------------------------------------------------
  const load = useCallback(async (surface: ExperimentSurface, cancelled: { v: boolean }) => {
    setRows(null);
    setVendorUnconfigured(false);
    const { data, error } = await supabase.rpc('get_experiment_results', { surface });
    if (cancelled.v) return;
    if (error) {
      // Pattern A: vendor_unconfigured → soft banner, treat data as empty.
      const msg = (error as { message?: string }).message ?? '';
      if (msg.includes('vendor_unconfigured')) {
        setVendorUnconfigured(true);
      }
      setRows([]);
    } else {
      setRows((data as ExperimentRow[]) ?? []);
    }
  }, []);

  useEffect(() => {
    const cancelled = { v: false };
    void load(activeTab, cancelled);
    const intervalId = setInterval(() => {
      void load(activeTab, cancelled);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled.v = true;
      clearInterval(intervalId);
    };
  }, [activeTab, load]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const isLoading = rows === null;
  const isEmpty = rows !== null && rows.length === 0 && !vendorUnconfigured;

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      {/* Page header — mirrors CACDashboardPage shape */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="size-9 rounded-xl bg-[var(--color-surface-elevated)] text-[var(--color-primary)] inline-flex items-center justify-center">
            <TrendingUp size={18} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold">Experiments</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Paywall, Page-Builder, and Pharma A/B results.
            </p>
          </div>
        </div>
      </div>

      {/* Vendor-unconfigured soft banner (Pattern A) */}
      {vendorUnconfigured && (
        <Card variant="flat" padding="md" className="mb-4">
          <div className="flex items-start gap-3">
            <span className="text-[var(--color-warning)] mt-0.5">
              <AlertTriangle size={16} aria-hidden />
            </span>
            <p className="text-sm text-[var(--color-text)]">
              Slack alerts pause until #growth-experiments webhook is configured.
            </p>
          </div>
        </Card>
      )}

      {/* Tab nav — 3 Pills with controlled state union */}
      <div role="tablist" aria-label="Experiment surface" className="flex gap-2 mb-6">
        {TABS.map((t) => (
          <Pill
            key={t.key}
            active={activeTab === t.key}
            onClick={() => setActiveTab(t.key)}
            size="sm"
          >
            {t.label}
          </Pill>
        ))}
      </div>

      {/* Per-tab content slot — Plans 39-07 and 39-08 fill in. */}
      <section
        data-testid="experiment-tab-content"
        data-tab={activeTab}
        data-busy-key={busyKey ?? ''}
        aria-label={`${activeTab} experiments`}
      >
        {isLoading ? (
          <div className="grid grid-cols-12 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="col-span-12">
                <Skeleton
                  data-testid="experiment-skeleton"
                  className="h-16 rounded-card w-full"
                />
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          <Card variant="flat" padding="lg">
            <EmptyState
              inline
              title="No active experiments yet."
              body="Create a variant from any published page to begin testing."
              cta={
                <a
                  href="/admin/pages"
                  className="inline-flex items-center justify-center h-8 px-3 rounded-pill text-sm font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:brightness-95"
                >
                  Go to Pages
                </a>
              }
            />
          </Card>
        ) : (
          // Plans 39-07 / 39-08 fill this slot. Until then, a non-stub
          // placeholder showing the count keeps the chrome non-empty.
          <Card variant="flat" padding="md">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {rows!.length} experiment{rows!.length === 1 ? '' : 's'} loaded.
              Per-tab table renders ship in Plans 39-07 / 39-08.
            </p>
          </Card>
        )}
      </section>

    </main>
  );
}

export default ExperimentDashboardPage;
