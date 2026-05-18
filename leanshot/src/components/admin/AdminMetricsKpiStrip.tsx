/**
 * Phase 22 Plan 22-08 — KPI strip for /admin/metrics (ADMIN-02).
 *
 * 4 tiles: MRR · ARR · 30d churn · clinic-seat utilization (Sparkline).
 * useCountUp animates numeric values on mount; useReducedMotion fallback
 * is honored inside the hook (instant value).
 *
 * UI-SPEC §/admin/metrics line 263 (KPI strip 4 sub-cards span={3}).
 * Copywriting per UI-SPEC lines 504-507.
 */
import { Card } from '@/components/ui/Card';
import { Sparkline } from '@/components/ui/Sparkline';
import { useCountUp } from '@/hooks/useCountUp';

export interface AdminMetricsKpiStripProps {
  mrrCents: number;
  arrCents: number;
  churnPct30d: number;
  clinicSeatCount: number;
  clinicSeatSeries: number[];
}

function formatCurrencyShort(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

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

export function AdminMetricsKpiStrip({
  mrrCents,
  arrCents,
  churnPct30d,
  clinicSeatCount,
  clinicSeatSeries,
}: AdminMetricsKpiStripProps) {
  const mrrAnim = useCountUp(mrrCents / 100);
  const arrAnim = useCountUp(arrCents / 100);
  const churnAnim = useCountUp(churnPct30d, { decimals: 1 });
  const seatsAnim = useCountUp(clinicSeatCount);

  return (
    <div className="grid grid-cols-12 gap-4 mb-6">
      <KpiTile label="MRR" ariaLabelledValue={formatCurrencyShort(mrrCents)}>
        ${Math.round(mrrAnim).toLocaleString()}
      </KpiTile>
      <KpiTile label="ARR" ariaLabelledValue={formatCurrencyShort(arrCents)}>
        ${Math.round(arrAnim).toLocaleString()}
      </KpiTile>
      <KpiTile label="30d churn" ariaLabelledValue={`${churnPct30d.toFixed(1)} percent`}>
        {churnAnim.toFixed(1)}
        <span className="ms-1 text-[12px] font-medium text-[var(--color-text-secondary)]">%</span>
      </KpiTile>
      <KpiTile
        label="Clinic seat utilization"
        ariaLabelledValue={`${clinicSeatCount} seats`}
      >
        <span className="inline-flex items-baseline gap-2">
          {Math.round(seatsAnim)}
          <Sparkline
            values={clinicSeatSeries.length > 0 ? clinicSeatSeries : [0, 0]}
            width={64}
            height={24}
            label={`Clinic-seat trend: ${clinicSeatCount}`}
          />
        </span>
      </KpiTile>
    </div>
  );
}
