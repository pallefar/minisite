/**
 * Phase 42 Plan 42-10 (POLISH-12 D-24) — Admin Quarterly NPS Dashboard.
 *
 * Route: /admin/nps/quarterly (registered in src/lib/admin/modules.ts).
 *
 * Layout (ROADMAP-literal, reuses Phase 33 admin-CAC chart pattern):
 *   1. Current-quarter NPS score card.
 *   2. Delta-vs-prior-quarter card with arrow indicator.
 *   3. 4-quarter trend chart (BaseChart wrapper).
 *   4. Filter row (tenure-bucket / plan-tier / cohort / score-range).
 *   5. Verbatim list (paginated, 20 per page).
 *
 * Security:
 *   - get_quarterly_nps_dashboard() SECDEF RPC enforces is_admin_at_least('admin')
 *     (T-42-10-01 mitigation). Non-admin callers receive 403 from PostgREST.
 *   - Module registered with minRole='admin' in ADMIN_MODULES.
 *
 * D-24 empty-state spec: "No responses yet this quarter" when the response
 * count for the target quarter = 0. NOT a hedge — this is the explicit
 * design spec.
 */
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types (inline — no new types module per plan spec).
// ---------------------------------------------------------------------------

interface TrendBucket {
  quarter: string;
  nps: number | null;
  responses: number;
}

interface VerbatimRow {
  id: string;
  score: number;
  comment: string;
  responded_at: string;
  responded_via: 'email' | 'in-app';
  tenure_bucket: 'new' | '<6mo' | '>6mo' | '>1yr' | 'unknown';
}

interface DashboardPayload {
  quarter: string;
  prior_quarter: string;
  current_score: number | null;
  prior_score: number | null;
  delta: number | null;
  trend: TrendBucket[];
  verbatim: VerbatimRow[];
  verbatim_total: number;
  page: number;
  page_size: number;
}

type TenureBucket = 'all' | 'new' | '<6mo' | '>6mo' | '>1yr';
type PlanTier = 'all' | 'free' | 'pro' | 'lifetime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatScore(value: number | null): string {
  if (value == null) return '—';
  return Math.round(value).toString();
}

function formatDelta(value: number | null): string {
  if (value == null) return '—';
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Filter Bar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  tenure: TenureBucket;
  plan: PlanTier;
  cohort: string;
  onTenureChange: (v: TenureBucket) => void;
  onPlanChange: (v: PlanTier) => void;
  onCohortChange: (v: string) => void;
}

function FilterBar({
  tenure,
  plan,
  cohort,
  onTenureChange,
  onPlanChange,
  onCohortChange,
}: FilterBarProps) {
  return (
    <div
      role="group"
      aria-label="Filter responses"
      className="flex flex-wrap gap-3 items-center"
    >
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="font-semibold text-[var(--color-text-secondary)]">Tenure</span>
        <select
          value={tenure}
          onChange={(e) => onTenureChange(e.target.value as TenureBucket)}
          className="h-9 rounded-pill border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px]"
        >
          <option value="all">All</option>
          <option value="new">New (&lt;30 days)</option>
          <option value="&lt;6mo">&lt;6 months</option>
          <option value="&gt;6mo">&gt;6 months</option>
          <option value="&gt;1yr">&gt;1 year</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[12px]">
        <span className="font-semibold text-[var(--color-text-secondary)]">Plan tier</span>
        <select
          value={plan}
          onChange={(e) => onPlanChange(e.target.value as PlanTier)}
          className="h-9 rounded-pill border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px]"
        >
          <option value="all">All</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="lifetime">Lifetime</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[12px]">
        <span className="font-semibold text-[var(--color-text-secondary)]">Cohort</span>
        <select
          value={cohort}
          onChange={(e) => onCohortChange(e.target.value)}
          className="h-9 rounded-pill border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px]"
        >
          <option value="all">All</option>
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuarterlyNPSDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [tenure, setTenure] = useState<TenureBucket>('all');
  const [plan, setPlan] = useState<PlanTier>('all');
  const [cohort, setCohort] = useState<string>('all');
  const [page, setPage] = useState<number>(1);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: result, error: rpcError } = await supabase.rpc(
      'get_quarterly_nps_dashboard',
      {
        p_quarter: null,
        p_tenure_bucket: tenure === 'all' ? null : tenure,
        p_plan_tier: plan === 'all' ? null : plan,
        p_cohort: cohort === 'all' ? null : cohort,
        p_score_min: null,
        p_score_max: null,
        p_page: page,
      },
    );
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    setData(result as DashboardPayload);
    setLoading(false);
  }, [tenure, plan, cohort, page]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
  }, [tenure, plan, cohort]);

  const trendConfig = useMemo(() => {
    if (!data) {
      return null;
    }
    // Trend is most-recent-first from the RPC; chart prefers chronological.
    const ordered = [...data.trend].reverse();
    return {
      type: 'line' as const,
      data: {
        labels: ordered.map((b) => b.quarter),
        datasets: [
          {
            label: 'NPS',
            data: ordered.map((b) => b.nps ?? null),
            borderColor: 'rgb(99, 102, 241)',
            backgroundColor: 'rgba(99, 102, 241, 0.15)',
            tension: 0.3,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { suggestedMin: -100, suggestedMax: 100 },
        },
        plugins: {
          legend: { display: false },
        },
      },
    };
  }, [data]);

  const verbatimEmpty =
    data && (data.verbatim_total === 0 || data.verbatim.length === 0);

  const totalPages = data ? Math.max(1, Math.ceil(data.verbatim_total / data.page_size)) : 1;

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-4 md:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Quarterly NPS</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            POLISH-12 — quarterly responses across email and in-app surfaces.
          </p>
        </div>
      </header>

      {error && (
        <Card variant="flat" padding="md" className="mb-4">
          <p role="alert" className="text-[13px] text-[var(--color-danger)]">
            Couldn’t load dashboard data: {error}
          </p>
        </Card>
      )}

      {/* Top row — score + delta cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card variant="elevated" padding="lg">
          <CardHeader title={data ? `Current quarter (${data.quarter})` : 'Current quarter'} />
          {loading ? (
            <Skeleton className="h-16 w-32" />
          ) : (
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-4xl font-bold tracking-tight">
                {formatScore(data?.current_score ?? null)}
              </span>
              <span className="text-[13px] text-[var(--color-text-secondary)]">NPS</span>
            </div>
          )}
        </Card>

        <Card variant="elevated" padding="lg">
          <CardHeader title="Δ vs prior quarter" />
          {loading ? (
            <Skeleton className="h-16 w-32" />
          ) : (
            <div className="flex items-center gap-2 mt-2">
              {data?.delta != null && data.delta > 0 ? (
                <TrendingUp className="size-6 text-[var(--color-success)]" aria-hidden />
              ) : data?.delta != null && data.delta < 0 ? (
                <TrendingDown className="size-6 text-[var(--color-danger)]" aria-hidden />
              ) : null}
              <span className="text-4xl font-bold tracking-tight">
                {formatDelta(data?.delta ?? null)}
              </span>
              <span className="text-[13px] text-[var(--color-text-secondary)]">
                vs {data?.prior_quarter ?? '—'}
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* Trend chart */}
      <Card variant="elevated" padding="lg" className="mb-6">
        <CardHeader title="4-quarter trend" />
        <div className="mt-3" style={{ height: 240 }}>
          {loading || !trendConfig ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <BaseChart config={trendConfig} height={240} ariaLabel="Quarterly NPS trend chart" />
          )}
        </div>
      </Card>

      {/* Filter row */}
      <Card variant="flat" padding="md" className="mb-4">
        <FilterBar
          tenure={tenure}
          plan={plan}
          cohort={cohort}
          onTenureChange={setTenure}
          onPlanChange={setPlan}
          onCohortChange={setCohort}
        />
      </Card>

      {/* Verbatim list */}
      <Card variant="elevated" padding="lg">
        <CardHeader
          title="Verbatim responses"
          action={
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              {data ? `${data.verbatim_total} total` : ''}
            </span>
          }
        />

        {loading ? (
          <div className="mt-4 flex flex-col gap-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : verbatimEmpty ? (
          <EmptyState
            title="No responses yet this quarter"
            body="Verbatim responses will appear here as users complete the quarterly survey."
          />
        ) : (
          <>
            <ul className="mt-3 flex flex-col gap-3">
              {data?.verbatim.map((row) => (
                <li
                  key={row.id}
                  className="border border-[var(--color-border)] rounded-card p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-secondary)]">
                    <span>
                      Score: <strong className="text-[var(--color-text)]">{row.score}</strong>
                    </span>
                    <span>{formatTimestamp(row.responded_at)}</span>
                    <span>
                      {row.tenure_bucket} · {row.responded_via}
                    </span>
                  </div>
                  <p className="text-[14px] leading-relaxed">{row.comment}</p>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav
                className="mt-4 flex items-center justify-end gap-2"
                aria-label="Verbatim pagination"
              >
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-8 px-3 rounded-pill border border-[var(--color-border)] text-[13px] disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-[12px] text-[var(--color-text-secondary)]">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="h-8 px-3 rounded-pill border border-[var(--color-border)] text-[13px] disabled:opacity-50"
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </Card>
    </main>
  );
}

export default QuarterlyNPSDashboard;
