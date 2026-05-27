/**
 * Phase 62 Plan 62-04 — RetentionChart.
 *
 * BaseChart wrapper for stacked-area retention curve.
 * Receives week-by-week retention data from compile_research_cohort RPC.
 *
 * Uses key={theme} on the BaseChart container to force remount on theme change
 * (prevents stale-color first paint — per BaseChart.tsx pattern note).
 *
 * Typography: text-[18px] for heading, text-[13px] for body.
 * @theme tokens verified present in src/index.css.
 */
import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTheme } from '@/hooks/useTheme';

export interface RetentionChartProps {
  data: Array<{ week_label: string; retained_pct: number }>;
  epsilon: number;
}

export function RetentionChart({ data, epsilon }: RetentionChartProps) {
  const { theme } = useTheme();

  const config = useMemo<ChartConfiguration>(() => {
    const labels = data.map((d) => d.week_label);
    const values = data.map((d) => d.retained_pct);

    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: `Retention % (ε=${epsilon})`,
            data: values,
            fill: true,
            tension: 0.3,
            borderColor: 'var(--color-primary)',
            backgroundColor: 'rgba(27, 72, 66, 0.15)',
            pointBackgroundColor: 'var(--color-primary)',
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: 'var(--color-text-secondary)',
              font: { size: 11 },
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y as number).toFixed(1)}%`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: 'var(--color-chart-tick)',
              font: { size: 11 },
            },
            grid: {
              color: 'var(--color-grid-line)',
            },
          },
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              color: 'var(--color-chart-tick)',
              font: { size: 11 },
              callback: (value) => `${value}%`,
            },
            grid: {
              color: 'var(--color-grid-line)',
            },
          },
        },
      },
    };
  }, [data, epsilon]);

  if (data.length === 0) {
    return (
      <EmptyState
        title="No retention data for selected filters."
        body="Run a cohort with more users to see retention curves."
        inline
      />
    );
  }

  return (
    <div>
      <h2 className="text-[18px] font-semibold text-[var(--color-text)] mb-4">
        Retention Curves
      </h2>
      <BaseChart
        key={theme}
        config={config}
        ariaLabel="Retention curve: percentage retained by week"
        height={280}
      />
    </div>
  );
}

export default RetentionChart;
