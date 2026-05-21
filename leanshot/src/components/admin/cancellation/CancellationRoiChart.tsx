/**
 * Phase 40 Plan 40-06 — CancellationRoiChart.
 *
 * Stacked bar chart: shown / accepted / declined per offer_type.
 * Uses BaseChart wrapper (P33 pattern). Custom HTML legend below chart.
 *
 * Per UI-SPEC Surface 3 "Chart" section (lines 306-318):
 *   - 3 stacked series: accepted (--color-primary), declined (--color-text-tertiary),
 *     shown_no_response (--color-border)
 *   - X-axis: 4 offer types (Pause / Discount / Extended trial / Downgrade)
 *   - 320 px tall on md+, 280 px on mobile
 *   - Custom HTML legend (chart.js inline legend has color-token issues per P33)
 */
import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { useTheme } from '@/hooks/useTheme';
import type { RoiViewRow } from './CancellationRoiKpiTiles';

const OFFER_TYPES = [
  { key: 'pause', label: 'Pause' },
  { key: 'discount', label: 'Discount' },
  { key: 'extended_trial', label: 'Extended trial' },
  { key: 'downgrade', label: 'Downgrade' },
] as const;

interface CancellationRoiChartProps {
  rows: RoiViewRow[];
  loading: boolean;
}

interface OfferTypeSummary {
  label: string;
  accepted: number;
  declined: number;
  shownNoResponse: number;
}

function aggregateByOfferType(rows: RoiViewRow[]): OfferTypeSummary[] {
  return OFFER_TYPES.map(({ key, label }) => {
    const typeRows = rows.filter((r) => r.offer_type === key);
    const accepted = typeRows.reduce((s, r) => s + (r.accepted_count ?? 0), 0);
    const declined = typeRows.reduce((s, r) => s + (r.declined_count ?? 0), 0);
    const shown = typeRows.reduce((s, r) => s + (r.shown_count ?? 0), 0);
    const shownNoResponse = Math.max(0, shown - accepted - declined);
    return { label, accepted, declined, shownNoResponse };
  });
}

export function CancellationRoiChart({ rows, loading }: CancellationRoiChartProps) {
  const { theme } = useTheme();
  const summaries = useMemo(() => aggregateByOfferType(rows), [rows]);

  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels: summaries.map((s) => s.label),
        datasets: [
          {
            label: 'Accepted',
            data: summaries.map((s) => s.accepted),
            backgroundColor: 'var(--color-primary)',
            borderColor: 'var(--color-primary)',
            borderWidth: 0,
            stack: 'offers',
          },
          {
            label: 'Declined',
            data: summaries.map((s) => s.declined),
            backgroundColor: 'var(--color-text-tertiary)',
            borderColor: 'var(--color-text-tertiary)',
            borderWidth: 0,
            stack: 'offers',
          },
          {
            label: 'Shown (no response)',
            data: summaries.map((s) => s.shownNoResponse),
            backgroundColor: 'var(--color-border)',
            borderColor: 'var(--color-border)',
            borderWidth: 0,
            stack: 'offers',
          },
        ],
      },
      options: {
        indexAxis: 'x',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }, // custom HTML legend below chart
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toLocaleString()}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              color: 'var(--color-text-secondary)',
              font: { size: 12 },
            },
          },
          y: {
            stacked: true,
            grid: { color: 'var(--color-border)' },
            ticks: {
              color: 'var(--color-text-secondary)',
              font: { size: 12 },
            },
          },
        },
      },
    }),
    [summaries],
  );

  const legendItems = [
    { color: 'var(--color-primary)', label: 'Accepted' },
    { color: 'var(--color-text-tertiary)', label: 'Declined' },
    { color: 'var(--color-border)', label: 'Shown (no response)' },
  ];

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-[280px] md:h-[320px] bg-[var(--color-border)] rounded-lg" />
      </div>
    );
  }

  return (
    <div>
      {/* Chart */}
      <BaseChart
        key={theme}
        config={config}
        height={undefined}
        className="h-[280px] md:h-[320px]"
        ariaLabel="Stacked bar chart showing save-offer counts (accepted, declined, shown with no response) per offer type"
      />
      {/* Custom HTML legend per P33 lesson */}
      <div
        className="flex flex-wrap gap-4 mt-4 justify-center"
        role="list"
        aria-label="Chart legend"
      >
        {legendItems.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5" role="listitem">
            <span
              className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="text-[12px] text-[var(--color-text-secondary)]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
