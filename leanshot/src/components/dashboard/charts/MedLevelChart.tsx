import { useMemo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { getChartTokens } from '@/lib/chart-theme';
import { HALF_LIVES, calcMedLevel } from '@/lib/pharmacology';
import { useStore } from '@/lib/store';
import { BaseChart } from './BaseChart';
import { medLevelWatermarkPlugin } from './medLevelWatermarkPlugin';

/** 28-day past + 7-day projected medication level chart. */
export function MedLevelChart({ height = 280 }: { height?: number }) {
  const u = useStore((s) => s.user!);
  const injections = useStore((s) => s.injections);
  const { theme } = useTheme();

  const config = useMemo(() => {
    const t = getChartTokens(theme);
    const halfLife = HALF_LIVES[u.medication] ?? 168;
    const labels: string[] = [];
    const past: (number | null)[] = [];
    const future: (number | null)[] = [];
    const now = Date.now();
    for (let h = -28 * 24; h <= 7 * 24; h += 6) {
      const ts = now + h * 3_600_000;
      const lv = calcMedLevel(ts, halfLife, injections);
      const d = new Date(ts);
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
      if (ts <= now) {
        past.push(lv);
        future.push(null);
      } else {
        past.push(null);
        future.push(lv);
      }
    }
    // Bridge the gap so the line connects past → projected
    const lastPast = past.findIndex(
      (v, i, a) => v != null && (i === a.length - 1 || a[i + 1] == null),
    );
    if (lastPast >= 0 && future[lastPast + 1] !== undefined) future[lastPast] = past[lastPast]!;

    return {
      type: 'line' as const,
      data: {
        labels,
        datasets: [
          {
            label: 'Past',
            data: past,
            borderColor: t.primary,
            backgroundColor: t.primary + '20',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.4,
            spanGaps: false,
          },
          {
            label: 'Projected',
            data: future,
            borderColor: t.rose,
            backgroundColor: t.rose + '20',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.4,
            borderDash: [5, 5],
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' as const },
        plugins: {
          legend: { labels: { color: t.tick } },
          // D-13: theme-aware diagonal watermark drawn into the canvas itself
          // so screenshots carry the disclaimer (SC#3).
          medLevelWatermark: {
            color: theme === 'dark' ? '220, 220, 220' : '60, 60, 60',
            opacity: theme === 'dark' ? 0.18 : 0.12,
          },
        },
        scales: {
          y: {
            ticks: { color: t.tick, callback: (v: string | number) => Number(v).toFixed(1) },
            grid: { color: t.grid },
            title: { display: true, text: `${u.doseUnit} in system`, color: t.tick },
          },
          x: { ticks: { color: t.tick, maxTicksLimit: 10 }, grid: { color: t.grid } },
        },
      },
      // D-15: per-instance plugin registration. NEVER Chart.register() — that would
      // leak the watermark onto every chart sharing BaseChart (weight, symptom, sparkline).
      plugins: [medLevelWatermarkPlugin],
    };
  }, [u, injections, theme]);

  return <BaseChart config={config} height={height} ariaLabel="28-day medication level" />;
}
