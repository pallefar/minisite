/**
 * Phase 39 Plan 39-08 — PharmaVariantMetricsCard.
 *
 * Composite metrics card for the Pharma sub-tab. Renders the UI-SPEC line 204
 * copy verbatim:
 *   "Conversion uplift: {N}% · NPS Δ: {N} · 1★ rate: {ratio}× baseline"
 *
 * Visual cues:
 *   - one_star_rate_ratio > 2 → danger tone (D-03 1★ kill threshold)
 *   - optional Sparkline when trend_series is supplied (Sparkline primitive,
 *     NO new chart abstraction per <action>)
 *
 * Accent policy: UI-SPEC line 132 reserves teal accent for non-pharma surfaces.
 * This card uses success/warning/danger token classes only.
 *
 * Decision references: D-03 (NPS + 1★ kill thresholds), PHARMA-08.
 */
import { Card } from '@/components/ui/Card';
import { Sparkline } from '@/components/ui/Sparkline';

export interface PharmaVariantMetricsCardProps {
  nps_delta: number | null;
  one_star_rate_ratio: number | null;
  conversion_uplift_pct: number | null;
  /** Optional rolling history for the Sparkline (length>0 to render). */
  trend_series?: number[];
}

function formatPct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return `${v.toFixed(1)}%`;
}

function formatNps(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return v.toFixed(1);
}

function formatRatio(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return `${v.toFixed(1)}×`;
}

export function PharmaVariantMetricsCard({
  nps_delta,
  one_star_rate_ratio,
  conversion_uplift_pct,
  trend_series,
}: PharmaVariantMetricsCardProps): React.JSX.Element {
  const danger =
    one_star_rate_ratio !== null && !Number.isNaN(one_star_rate_ratio) && one_star_rate_ratio > 2;
  const tone: 'danger' | 'neutral' = danger ? 'danger' : 'neutral';

  return (
    <Card
      variant="flat"
      padding="sm"
      data-tone={tone}
      className={danger ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)]' : ''}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm tabular-nums">
          <span className="text-[var(--color-text-secondary)]">Conversion uplift: </span>
          <span className="font-bold">{formatPct(conversion_uplift_pct)}</span>
          <span className="text-[var(--color-text-secondary)]"> · NPS Δ: </span>
          <span className={danger ? 'font-bold text-[var(--color-danger)]' : 'font-bold'}>
            {formatNps(nps_delta)}
          </span>
          <span className="text-[var(--color-text-secondary)]"> · 1★ rate: </span>
          <span className={danger ? 'font-bold text-[var(--color-danger)]' : 'font-bold'}>
            {formatRatio(one_star_rate_ratio)}
          </span>
          <span className="text-[var(--color-text-secondary)]"> baseline</span>
        </p>
        {trend_series && trend_series.length > 0 && (
          <Sparkline
            values={trend_series}
            width={80}
            height={24}
            label="NPS trend"
            color={danger ? 'var(--color-danger)' : 'var(--color-primary)'}
          />
        )}
      </div>
    </Card>
  );
}

export default PharmaVariantMetricsCard;
