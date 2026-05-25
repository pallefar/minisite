/**
 * Phase 56 Plan 56-05 — Ad Revenue Dashboard admin module (AD-06).
 *
 * Route: /admin/growth/ad-revenue
 *
 * Reads from get_ad_revenue_dashboard(p_start_date, p_end_date) SECDEF RPC
 * (admin-only — T-56-14 mitigated by SECDEF 42501 raise for non-admins).
 *
 * Sections (top → bottom):
 *   1. KPI strip — eCPM / RPM / Fill Rate / CTR (4× Card span={3})
 *   2. Per-network + per-placement breakdown table
 *
 * Security:
 *   - All data gated by get_ad_revenue_dashboard SECDEF RPC (admin-only gate).
 *   - Module minRole 'admin' in modules.ts enforces Pattern S1 dual-layer.
 *   - No hardcoded hex colors — uses CSS design tokens.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCountUp } from '@/hooks/useCountUp';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Inline types — no new types file per plan spec
// ---------------------------------------------------------------------------

type AdRevenueRow = {
  network: string;
  report_date: string;
  impressions: number;
  clicks: number;
  fill_rate: number;
  estimated_revenue_usd: number;
  ecpm_usd: number;
  rpm_usd: number;
};

// ---------------------------------------------------------------------------
// KPI Tile — reuses AdminMetricsKpiStrip Card pattern (Card span={3})
// ---------------------------------------------------------------------------

function KpiTile({
  label,
  ariaLabelledValue,
  children,
}: {
  label: string;
  ariaLabelledValue: string;
  children: React.ReactNode;
}) {
  return (
    <Card span={3} padding="md" variant="default">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div
        className="mt-1.5 text-[26px] font-bold leading-tight numerals-tabular tracking-tight"
        role="status"
        aria-live="polite"
        aria-label={`${label}: ${ariaLabelledValue}`}
      >
        {children}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// KPI strip component
// ---------------------------------------------------------------------------

function AdRevenueKpiStrip({
  ecpm,
  rpm,
  fillRate,
  ctr,
}: {
  ecpm: number;
  rpm: number;
  fillRate: number;
  ctr: number;
}) {
  const ecpmAnim = useCountUp(ecpm, { decimals: 2 });
  const rpmAnim = useCountUp(rpm, { decimals: 2 });
  const fillAnim = useCountUp(fillRate * 100, { decimals: 1 });
  const ctrAnim = useCountUp(ctr * 100, { decimals: 2 });

  return (
    <div className="grid grid-cols-12 gap-4 mb-6">
      <KpiTile label="eCPM" ariaLabelledValue={`$${ecpm.toFixed(2)}`}>
        <span className="text-[var(--color-text-primary)]">${ecpmAnim.toFixed(2)}</span>
      </KpiTile>
      <KpiTile label="RPM" ariaLabelledValue={`$${rpm.toFixed(2)}`}>
        <span className="text-[var(--color-text-primary)]">${rpmAnim.toFixed(2)}</span>
      </KpiTile>
      <KpiTile label="Fill Rate" ariaLabelledValue={`${(fillRate * 100).toFixed(1)} percent`}>
        {fillAnim.toFixed(1)}
        <span className="ms-1 text-[12px] font-medium text-[var(--color-text-secondary)]">%</span>
      </KpiTile>
      <KpiTile label="CTR" ariaLabelledValue={`${(ctr * 100).toFixed(2)} percent`}>
        {ctrAnim.toFixed(2)}
        <span className="ms-1 text-[12px] font-medium text-[var(--color-text-secondary)]">%</span>
      </KpiTile>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default date range: last 30 days
// ---------------------------------------------------------------------------

function getDefaultDates(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// ---------------------------------------------------------------------------
// Main dashboard page
// ---------------------------------------------------------------------------

export function AdRevenueDashboardPage() {
  const [rows, setRows] = useState<AdRevenueRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = useMemo(() => getDefaultDates(), []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc('get_ad_revenue_dashboard', {
        p_start_date: startDate,
        p_end_date: endDate,
      });

      if (cancelled) return;

      if (rpcError) {
        setError(rpcError.message);
        setRows([]);
      } else {
        setRows((data as AdRevenueRow[]) ?? []);
      }
      setLoading(false);
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  // Aggregate KPIs across all rows
  const kpis = useMemo(() => {
    if (!rows || rows.length === 0) {
      return { ecpm: 0, rpm: 0, fillRate: 0, ctr: 0 };
    }

    const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);
    const totalClicks = rows.reduce((sum, r) => sum + r.clicks, 0);
    const avgEcpm = rows.reduce((sum, r) => sum + r.ecpm_usd, 0) / rows.length;
    const avgRpm = rows.reduce((sum, r) => sum + r.rpm_usd, 0) / rows.length;
    const avgFillRate = rows.reduce((sum, r) => sum + r.fill_rate, 0) / rows.length;
    // CTR = total clicks / total impressions (divide-by-zero guard)
    const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

    return { ecpm: avgEcpm, rpm: avgRpm, fillRate: avgFillRate, ctr };
  }, [rows]);

  // Group rows by network for the breakdown table
  const networkGroups = useMemo(() => {
    if (!rows || rows.length === 0) return [];

    const byNetwork = new Map<
      string,
      {
        network: string;
        impressions: number;
        clicks: number;
        revenue: number;
        ecpm: number;
        rpm: number;
        fillRate: number;
        rowCount: number;
      }
    >();

    for (const row of rows) {
      const existing = byNetwork.get(row.network);
      if (existing) {
        existing.impressions += row.impressions;
        existing.clicks += row.clicks;
        existing.revenue += row.estimated_revenue_usd;
        existing.ecpm += row.ecpm_usd;
        existing.rpm += row.rpm_usd;
        existing.fillRate += row.fill_rate;
        existing.rowCount += 1;
      } else {
        byNetwork.set(row.network, {
          network: row.network,
          impressions: row.impressions,
          clicks: row.clicks,
          revenue: row.estimated_revenue_usd,
          ecpm: row.ecpm_usd,
          rpm: row.rpm_usd,
          fillRate: row.fill_rate,
          rowCount: 1,
        });
      }
    }

    return Array.from(byNetwork.values()).map((g) => ({
      ...g,
      ecpm: g.ecpm / g.rowCount,
      rpm: g.rpm / g.rowCount,
      fillRate: g.fillRate / g.rowCount,
      ctr: g.impressions > 0 ? g.clicks / g.impressions : 0,
    }));
  }, [rows]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-12 gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} span={3} padding="md" variant="default">
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-8 w-24" />
            </Card>
          ))}
        </div>
        <Card span={12} padding="md" variant="default">
          <Skeleton className="h-40 w-full" />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          title="Error loading revenue data"
          description={error}
        />
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No revenue data"
          description="No revenue data available for the selected period. Revenue data arrives once ad placements are live (Phase 70)."
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <AdRevenueKpiStrip
        ecpm={kpis.ecpm}
        rpm={kpis.rpm}
        fillRate={kpis.fillRate}
        ctr={kpis.ctr}
      />

      <Card span={12} padding="md" variant="default">
        <CardHeader title="By Network" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="py-2 px-3 text-left text-[var(--color-text-tertiary)] font-semibold uppercase text-[10px] tracking-[0.1em]">
                  Network
                </th>
                <th className="py-2 px-3 text-right text-[var(--color-text-tertiary)] font-semibold uppercase text-[10px] tracking-[0.1em]">
                  Impressions
                </th>
                <th className="py-2 px-3 text-right text-[var(--color-text-tertiary)] font-semibold uppercase text-[10px] tracking-[0.1em]">
                  Clicks
                </th>
                <th className="py-2 px-3 text-right text-[var(--color-text-tertiary)] font-semibold uppercase text-[10px] tracking-[0.1em]">
                  CTR
                </th>
                <th className="py-2 px-3 text-right text-[var(--color-text-tertiary)] font-semibold uppercase text-[10px] tracking-[0.1em]">
                  Fill Rate
                </th>
                <th className="py-2 px-3 text-right text-[var(--color-text-tertiary)] font-semibold uppercase text-[10px] tracking-[0.1em]">
                  eCPM
                </th>
                <th className="py-2 px-3 text-right text-[var(--color-text-tertiary)] font-semibold uppercase text-[10px] tracking-[0.1em]">
                  RPM
                </th>
                <th className="py-2 px-3 text-right text-[var(--color-text-tertiary)] font-semibold uppercase text-[10px] tracking-[0.1em]">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {networkGroups.map((group) => (
                <tr
                  key={group.network}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]"
                >
                  <td className="py-2.5 px-3 font-medium text-[var(--color-text-primary)]">
                    {group.network}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--color-text-secondary)] numerals-tabular">
                    {group.impressions.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--color-text-secondary)] numerals-tabular">
                    {group.clicks.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--color-text-secondary)] numerals-tabular">
                    {(group.ctr * 100).toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--color-text-secondary)] numerals-tabular">
                    {(group.fillRate * 100).toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--color-text-secondary)] numerals-tabular">
                    ${group.ecpm.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--color-text-secondary)] numerals-tabular">
                    ${group.rpm.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--color-text-secondary)] numerals-tabular">
                    ${group.revenue.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
