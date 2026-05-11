/**
 * Chart.js token sync — read live CSS variables so charts always reflect
 * the current theme. Always call inside the chart options factory or the
 * mount effect so we get fresh values after a theme switch.
 */
import type { Theme } from '@/types';

export interface ChartTokens {
  tick: string;
  grid: string;
  primary: string;
  primarySoft: string;
  rose: string;
  roseSoft: string;
  sage: string;
  sageSoft: string;
  amber: string;
  sky: string;
  text: string;
  textSecondary: string;
  surface: string;
}

const css = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function getChartTokens(_theme: Theme): ChartTokens {
  // Theme arg is here so callers must remount on theme change (it's used as the
  // React key on chart wrappers). We always read live values either way.
  return {
    tick: css('--color-chart-tick'),
    grid: css('--color-grid-line'),
    primary: css('--color-primary'),
    primarySoft: css('--color-primary-soft'),
    rose: css('--color-rose'),
    roseSoft: css('--color-rose-soft'),
    sage: css('--color-sage'),
    sageSoft: css('--color-sage-soft'),
    amber: css('--color-amber'),
    sky: css('--color-sky'),
    text: css('--color-text'),
    textSecondary: css('--color-text-secondary'),
    surface: css('--color-surface'),
  };
}
