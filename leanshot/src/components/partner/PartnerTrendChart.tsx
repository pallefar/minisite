/**
 * Phase 19 Plan 19-06a — PartnerTrendChart.
 *
 * Spec references:
 *   - 19-UI-SPEC.md §/partner/dashboard trend chart
 *   - 19-PATTERNS.md §C.6 BaseChart wrapper
 *
 * Reuses the existing BaseChart wrapper (which already registers chart.js
 * `...registerables`). Zero new plugin imports, zero new dep cost.
 *
 * Color contract: clicks line = `--color-primary` (accent reserved-for #6),
 * conversions line = `--color-success` (semantic green; NOT in the accent budget).
 */
import type { ChartConfiguration } from 'chart.js';
import { type ReactNode, useMemo } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { Card, CardHeader } from '@/components/ui/Card';
import type { DailyPoint } from '@/lib/affiliate/api';

export interface PartnerTrendChartProps {
  data: DailyPoint[];
}

function formatDayLabel(iso: string): string {
  // iso = YYYY-MM-DD. Render as e.g. "May 15".
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function PartnerTrendChart({ data }: PartnerTrendChartProps): ReactNode {
  const config = useMemo<ChartConfiguration>(() => {
    return {
      type: 'line',
      data: {
        labels: data.map((d) => formatDayLabel(d.date)),
        datasets: [
          {
            label: 'Clicks',
            data: data.map((d) => d.clicks),
            borderColor: 'var(--color-primary)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
          },
          {
            label: 'Conversions',
            data: data.map((d) => d.conversions),
            borderColor: 'var(--color-success)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 6,
              color: 'var(--color-text-tertiary)',
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: 'var(--color-text-tertiary)',
              precision: 0,
            },
            grid: { color: 'var(--color-border)' },
          },
        },
      },
    };
  }, [data]);

  return (
    <Card span={12} padding="md">
      <CardHeader
        title="Clicks + conversions (30d)"
        action={
          <span className="text-xs text-[var(--color-text-secondary)]">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-primary)] me-1 align-middle" />
            Clicks
            <span className="mx-2 text-[var(--color-text-tertiary)]">·</span>
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-success)] me-1 align-middle" />
            Conversions
          </span>
        }
      />
      <BaseChart config={config} ariaLabel="Clicks and conversions over the past 30 days" />
    </Card>
  );
}
