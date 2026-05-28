/**
 * Phase 22 Plan 22-08 — Main chart for /admin/metrics (ADMIN-02).
 *
 * Line+bar combo: free-vs-paid stacked bars (x = monthly bins, y left = subs)
 * + churn-rate line overlay (y right = %). Legend: "Free · Paid · Churn rate"
 * (UI-SPEC line 514).
 *
 * Wraps the existing BaseChart primitive (chart.js, already bundled —
 * vendor-charts manualChunk). No new chart dependency.
 */
import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'react';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
import { Card } from '@/components/ui/Card';
import type { ChurnSeriesBin } from '@/lib/admin/admin-metrics';

export interface AdminMetricsMrrChartProps {
  series: ChurnSeriesBin[];
}

export function AdminMetricsMrrChart({ series }: AdminMetricsMrrChartProps) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels: series.map((b) => b.bucket),
        datasets: [
          {
            label: 'Free',
            type: 'bar' as const,
            data: series.map((b) => b.free),
            backgroundColor: 'var(--color-surface-elevated)',
            borderColor: 'var(--color-border)',
            borderWidth: 1,
            stack: 'subs',
            yAxisID: 'y',
          },
          {
            label: 'Paid',
            type: 'bar' as const,
            data: series.map((b) => b.paid),
            backgroundColor: 'var(--color-primary)',
            borderColor: 'var(--color-primary)',
            borderWidth: 1,
            stack: 'subs',
            yAxisID: 'y',
          },
          {
            label: 'Churn rate',
            type: 'line' as const,
            data: series.map((b) => b.churnPct),
            borderColor: 'var(--color-danger)',
            backgroundColor: 'var(--color-danger)',
            yAxisID: 'y1',
            tension: 0.25,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } },
          title: { display: false },
        },
        scales: {
          x: {
            stacked: true,
            title: { display: true, text: 'Month' },
            grid: { display: false },
          },
          y: {
            stacked: true,
            position: 'left',
            title: { display: true, text: 'Subscribers' },
            beginAtZero: true,
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'Churn %' },
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: {
              callback: (v: string | number) => `${v}%`,
            },
          },
        },
      },
    }),
    [series],
  );

  return (
    <Card span={12} padding="md" variant="default" className="mb-6">
      <h2 className="text-[14px] font-semibold text-[var(--color-text)] mb-4">
        Subscribers + churn
      </h2>
      <BaseChart config={config} ariaLabel="Subscribers and churn rate over time" height={300} />
    </Card>
  );
}
