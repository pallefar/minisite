/**
 * Phase 22 Plan 22-08 — /admin/metrics page (ADMIN-02).
 *
 * Layout per UI-SPEC §/admin/metrics:
 *   - Header: heading "Business metrics" + period Pill group (7d/30d/90d/12m) + Updated badge.
 *   - KPI strip: MRR · ARR · 30d churn · clinic-seat utilization (4 sub-cards span={3}).
 *   - Main chart: line+bar combo via BaseChart.
 *   - Clinic-seat list: one row per clinic with Sparkline.
 *   - Empty state: when MRR + paid_count + clinic_seat_count all zero.
 *
 * Dual-layer security (D-05 Pattern S1):
 *   - Server: admin_compute_mrr_arr RPC is is_staff-gated (42501 forbidden).
 *   - Client: inline profiles.is_staff probe (mirrors AdminAffiliatesScaffold
 *     verbatim; AdminLayout shell lands in plan 22-06 and 22-12 wires routes).
 *
 * Default-export for App.tsx React.lazy() route registration in plan 22-12.
 */
import { useEffect, useMemo, useState } from 'react';
import { AdminMetricsClinicSeatList } from '@/components/admin/AdminMetricsClinicSeatList';
import { AdminMetricsKpiStrip } from '@/components/admin/AdminMetricsKpiStrip';
import { AdminMetricsMrrChart } from '@/components/admin/AdminMetricsMrrChart';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { fetchMetrics, type AdminMetrics, type AdminMetricsPeriod } from '@/lib/admin/admin-metrics';
import { supabase } from '@/lib/supabase';

const PERIOD_OPTIONS: { key: AdminMetricsPeriod; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: '12m', label: '12m' },
];

function minutesSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 60_000));
}

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

export function AdminMetricsPage() {
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);
  const [period, setPeriod] = useState<AdminMetricsPeriod>('30d');
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);

  // Probe is_staff (UX layer; RPC is the security boundary).
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

  // Fetch metrics — only after staff probe resolves true.
  useEffect(() => {
    if (isStaff !== true) return;
    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    fetchMetrics({ period })
      .then((m) => {
        if (cancelled) return;
        setMetrics(m);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load metrics';
        setErrorMessage(msg);
        setMetrics(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isStaff, period]);

  const isEmpty = useMemo(() => {
    if (!metrics) return false;
    return (
      metrics.mrrCents === 0 &&
      metrics.arrCents === 0 &&
      metrics.paidCount === 0 &&
      metrics.clinicSeatCount === 0
    );
  }, [metrics]);

  if (isStaff === undefined) return null;
  if (!isStaff) return <NotAuthorizedCard />;

  const updatedMin = metrics ? minutesSince(metrics.computedAt) : null;

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Business metrics</h1>
        <div className="flex items-center gap-3">
          <PillGroup segmented aria-label="Period">
            {PERIOD_OPTIONS.map((opt) => (
              <Pill
                key={opt.key}
                size="sm"
                active={period === opt.key}
                onClick={() => setPeriod(opt.key)}
                role="tab"
                aria-selected={period === opt.key}
              >
                {opt.label}
              </Pill>
            ))}
          </PillGroup>
          {updatedMin !== null && (
            <Badge tone="neutral" aria-label={`Updated ${updatedMin} minutes ago`}>
              Updated {updatedMin} min ago
            </Badge>
          )}
        </div>
      </header>

      {loading && !metrics && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading metrics…</p>
      )}

      {errorMessage && (
        <Card variant="flat" padding="md" className="mb-4">
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {errorMessage}
          </p>
        </Card>
      )}

      {metrics && isEmpty && (
        <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12">
          <EmptyState
            title="No revenue data yet"
            body="Connect Stripe to see MRR and ARR here."
          />
        </Card>
      )}

      {metrics && !isEmpty && (
        <>
          <AdminMetricsKpiStrip
            mrrCents={metrics.mrrCents}
            arrCents={metrics.arrCents}
            churnPct30d={metrics.churnPct30d}
            clinicSeatCount={metrics.clinicSeatCount}
            clinicSeatSeries={metrics.clinicSeatUtilization.flatMap((c) =>
              c.series.length > 0 ? c.series : [c.used],
            )}
          />
          <div className="grid grid-cols-12 gap-4">
            <AdminMetricsMrrChart series={metrics.churnSeries} />
            <AdminMetricsClinicSeatList rows={metrics.clinicSeatUtilization} />
          </div>
        </>
      )}
    </main>
  );
}

export default AdminMetricsPage;
