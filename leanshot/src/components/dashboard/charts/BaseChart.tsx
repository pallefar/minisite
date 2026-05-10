import { useEffect, useRef } from 'react';
import { Chart, type ChartConfiguration, type ChartOptions, type ChartType, registerables } from 'chart.js';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/helpers';

Chart.register(...registerables);

export interface BaseChartProps {
  config: ChartConfiguration;
  className?: string;
  /** Optional height override in px. Otherwise the parent should constrain. */
  height?: number;
  /** Accessible description of what the chart shows. */
  ariaLabel: string;
}

/**
 * Thin Chart.js wrapper.
 *  - Destroys + recreates the chart on every theme change so colors are
 *    always current (no stale-color first paint). Achieved by remounting
 *    via the `key={theme}` pattern at the call-site.
 *  - Always destroys in effect cleanup (StrictMode safe).
 */
export function BaseChart({ config, className, height = 240, ariaLabel }: BaseChartProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!ref.current) return;
    chartRef.current = new Chart(ref.current, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Update data without re-creating the chart for live data changes
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.data = config.data;
    c.options = (config.options ?? {}) as ChartOptions<ChartType>;
    c.update('none');
  }, [config]);

  return (
    <div className={cn('relative w-full', className)} style={{ height }}>
      <canvas ref={ref} role="img" aria-label={ariaLabel} />
    </div>
  );
}
