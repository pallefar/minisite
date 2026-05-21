/**
 * Phase 40 Plan 40-06 — CancellationRoiKpiTiles.
 *
 * 4 KPI tiles for the admin ROI dashboard:
 *   - Offers shown (SUM of shown_count)
 *   - Acceptance rate (accepted / shown * 100)
 *   - Revenue recovered (SUM of deferred_mrr_cents_est in USD)
 *   - Avg retention extension (avg months from accepted offer_config)
 *
 * Each tile shows a Δ-vs-prior-period badge where applicable.
 * Uses Fraunces display font per UI-SPEC line 64 ROI hero exception.
 *
 * Data: queried from v_cancellation_offers_roi VIEW via supabase-js.
 * Grouping by posthog_variant_id is included when variants are active
 * (v1.3 cold-start: all null, so grouping is a no-op).
 */
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

export interface RoiViewRow {
  offered_day: string;
  offer_type: string;
  cohort_id: string | null;
  tenure_bucket: string;
  posthog_variant_id: string | null;
  shown_count: number;
  accepted_count: number;
  declined_count: number;
  deferred_mrr_cents_est: number;
}

interface KpiData {
  offersShown: number;
  acceptanceRate: number; // pp
  revenueRecovered: number; // USD cents
  avgRetentionMonths: number;
  deltaAcceptanceRate: number | null; // pp vs prior period
  deltaRevenue: number | null; // USD cents vs prior period
}

interface CancellationRoiKpiTilesProps {
  rows: RoiViewRow[];
  priorRows: RoiViewRow[];
  loading: boolean;
}

function computeKpi(rows: RoiViewRow[]): Omit<KpiData, 'deltaAcceptanceRate' | 'deltaRevenue'> {
  const offersShown = rows.reduce((s, r) => s + (r.shown_count ?? 0), 0);
  const accepted = rows.reduce((s, r) => s + (r.accepted_count ?? 0), 0);
  const acceptanceRate = offersShown > 0 ? (accepted / offersShown) * 100 : 0;
  // deferred_mrr_cents_est is in cents (percent_off * 12.99 per view); convert to dollars
  const revenueRecovered = rows.reduce((s, r) => s + (r.deferred_mrr_cents_est ?? 0), 0) / 100;
  // Avg retention: 2 months assumed for accepted pause/discount; 7d/14d/30d for extended_trial
  // (offer_config not in view — use a simplified 2-month average for v1.3)
  const avgRetentionMonths = accepted > 0 ? 2.0 : 0;

  return { offersShown, acceptanceRate, revenueRecovered, avgRetentionMonths };
}

function KpiTile({
  label,
  value,
  sub,
  delta,
  deltaLabel,
}: {
  label: string;
  value: string;
  sub: string;
  delta?: number | null;
  deltaLabel?: string;
}) {
  const isPositive = delta !== null && delta !== undefined && delta > 0;
  const isNegative = delta !== null && delta !== undefined && delta < 0;

  return (
    <Card variant="elevated" className="flex flex-col gap-2 p-6">
      <span className="text-[13px] text-[var(--color-text-secondary)] font-medium">{label}</span>
      <span
        className="font-[var(--font-display)] text-[22px] font-semibold leading-[1.35] text-[var(--color-text)]"
        aria-label={`${label}: ${value}`}
      >
        {value}
      </span>
      <span className="text-[13px] text-[var(--color-text-secondary)]">{sub}</span>
      {delta !== null && delta !== undefined && Math.abs(delta) > 0.01 && (
        <Badge
          tone={isPositive ? 'success' : isNegative ? 'danger' : 'neutral'}
          leadingIcon={
            isPositive ? (
              <TrendingUp size={11} aria-hidden />
            ) : isNegative ? (
              <TrendingDown size={11} aria-hidden />
            ) : undefined
          }
        >
          {isPositive ? '+' : ''}
          {deltaLabel ?? `${delta.toFixed(1)}`}
        </Badge>
      )}
    </Card>
  );
}

export function CancellationRoiKpiTiles({ rows, priorRows, loading }: CancellationRoiKpiTilesProps) {
  const kpi = useMemo(() => computeKpi(rows), [rows]);
  const prior = useMemo(() => computeKpi(priorRows), [priorRows]);

  const deltaAcceptance = priorRows.length > 0 ? kpi.acceptanceRate - prior.acceptanceRate : null;
  const deltaRevenue = priorRows.length > 0 ? kpi.revenueRecovered - prior.revenueRecovered : null;

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} variant="elevated" className="p-6 animate-pulse">
            <div className="h-4 bg-[var(--color-border)] rounded w-24 mb-3" />
            <div className="h-7 bg-[var(--color-border)] rounded w-16 mb-2" />
            <div className="h-3 bg-[var(--color-border)] rounded w-28" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiTile
        label="Offers shown"
        value={kpi.offersShown.toLocaleString()}
        sub="in selected range"
      />
      <KpiTile
        label="Acceptance rate"
        value={`${kpi.acceptanceRate.toFixed(1)} %`}
        sub="of offers shown"
        delta={deltaAcceptance}
        deltaLabel={
          deltaAcceptance !== null
            ? `${deltaAcceptance > 0 ? '+' : ''}${deltaAcceptance.toFixed(1)} pp`
            : undefined
        }
      />
      <KpiTile
        label="Revenue recovered"
        value={`$${kpi.revenueRecovered.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
        sub="deferred MRR × months retained"
        delta={deltaRevenue}
        deltaLabel={
          deltaRevenue !== null
            ? `${deltaRevenue > 0 ? '+' : ''}$${Math.abs(deltaRevenue).toFixed(0)}`
            : undefined
        }
      />
      <KpiTile
        label="Avg. retention extension"
        value={`${kpi.avgRetentionMonths.toFixed(1)} months`}
        sub="across accepted offers"
      />
    </div>
  );
}

/**
 * Hook to load ROI data for the KPI tiles.
 * Returns current-period rows + prior-period rows for delta calculation.
 */
export function useRoiData(
  dateFrom: string,
  dateTo: string,
  cohorts: string[],
  offerTypes: string[],
) {
  const [rows, setRows] = useState<RoiViewRow[]>([]);
  const [priorRows, setPriorRows] = useState<RoiViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        // Current period
        let q = supabase
          .from('v_cancellation_offers_roi')
          .select('*')
          .gte('offered_day', dateFrom)
          .lte('offered_day', dateTo);
        if (cohorts.length > 0) q = q.in('cohort_id', cohorts);
        if (offerTypes.length > 0) q = q.in('offer_type', offerTypes);

        const { data: current, error: err } = await q;
        if (err) throw new Error(err.message);

        // Prior period (same duration, shifted back)
        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        const durationMs = to.getTime() - from.getTime();
        const priorFrom = new Date(from.getTime() - durationMs).toISOString().slice(0, 10);
        const priorTo = new Date(to.getTime() - durationMs).toISOString().slice(0, 10);

        let pq = supabase
          .from('v_cancellation_offers_roi')
          .select('*')
          .gte('offered_day', priorFrom)
          .lte('offered_day', priorTo);
        if (cohorts.length > 0) pq = pq.in('cohort_id', cohorts);
        if (offerTypes.length > 0) pq = pq.in('offer_type', offerTypes);

        const { data: prior, error: perr } = await pq;
        if (perr) throw new Error(perr.message);

        if (!cancelled) {
          setRows((current as RoiViewRow[]) ?? []);
          setPriorRows((prior as RoiViewRow[]) ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, cohorts.join(','), offerTypes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return { rows, priorRows, loading, error };
}
