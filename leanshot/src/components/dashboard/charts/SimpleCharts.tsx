/**
 * Small chart wrappers used across tabs. Each is keyed on theme so
 * colors track theme changes correctly.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { getChartTokens } from '@/lib/chart-theme';
import { SUPPS_DEFAULT, SYMPTOMS_LIST } from '@/lib/constants';
import { lastNDays, shortLabel } from '@/lib/helpers';
import { useStore } from '@/lib/store';
import { BaseChart } from './BaseChart';

export function WeightChart({ days = 365, height = 280 }: { days?: number; height?: number }) {
  // Phase 7 Plan 07-09 (D-06): nullable selector + Rules-of-Hooks-safe
  // early-return. See MedLevelChart.tsx for the canonical pattern.
  const { t } = useTranslation('patient');
  const u = useStore((s) => s.user);
  const weights = useStore((s) => s.weights);
  const { theme } = useTheme();
  const config = useMemo(() => {
    if (!u) return null;
    const tok = getChartTokens(theme);
    const cutoff = Date.now() - days * 86_400_000;
    const data = weights.filter((w) => new Date(w.date).getTime() > cutoff);
    return {
      type: 'line' as const,
      data: {
        labels: data.length ? data.map((w) => shortLabel(w.date)) : [t('patient:chart.weight.start_label')],
        datasets: [
          {
            label: t('patient:chart.weight.legend'),
            data: data.length ? data.map((w) => w.weight) : [u.startWeight],
            borderColor: tok.primary,
            backgroundColor: tok.primary + '1A',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: tok.primary,
            borderWidth: 2.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: tok.tick }, grid: { color: tok.grid } },
          x: { ticks: { color: tok.tick, maxTicksLimit: 8 }, grid: { color: tok.grid } },
        },
      },
    };
  }, [u, weights, days, theme, t]);
  if (!u || !config) return null;
  return <BaseChart config={config} height={height} ariaLabel="Weight trajectory" />;
}

export function ProteinChart({ days = 14, height = 220 }: { days?: number; height?: number }) {
  // Phase 7 Plan 07-09 (D-06): nullable selector + Rules-of-Hooks-safe
  // early-return. See MedLevelChart.tsx for the canonical pattern.
  const u = useStore((s) => s.user);
  const meals = useStore((s) => s.meals);
  const { theme } = useTheme();
  const config = useMemo(() => {
    if (!u) return null;
    const t = getChartTokens(theme);
    const dates = lastNDays(days);
    const data = dates.map((d) =>
      meals.filter((m) => m.date === d).reduce((sum, m) => sum + (m.protein || 0), 0),
    );
    return {
      type: 'bar' as const,
      data: {
        labels: dates.map(shortLabel),
        datasets: [
          {
            data,
            backgroundColor: data.map((v) => (v >= u.proteinTarget ? t.sage : t.rose)),
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: t.tick }, grid: { color: t.grid } },
          x: { ticks: { color: t.tick }, grid: { color: t.grid } },
        },
      },
    };
  }, [u, meals, days, theme]);
  if (!u || !config) return null;
  return <BaseChart config={config} height={height} ariaLabel="Protein intake" />;
}

export function SymptomChart({ height = 240 }: { height?: number }) {
  const { t } = useTranslation('patient');
  const symptoms = useStore((s) => s.symptoms);
  const { theme } = useTheme();
  const config = useMemo(() => {
    const tok = getChartTokens(theme);
    const counts: Record<string, number> = {};
    SYMPTOMS_LIST.forEach((s) => (counts[s.id] = 0));
    const cutoff = Date.now() - 30 * 86_400_000;
    symptoms
      .filter((s) => new Date(s.date).getTime() > cutoff)
      .forEach((s) => (counts[s.symptom] = (counts[s.symptom] ?? 0) + 1));
    const data = SYMPTOMS_LIST.filter((s) => counts[s.id]! > 0).map((s) => ({
      name: s.name,
      count: counts[s.id]!,
    }));
    return {
      type: 'bar' as const,
      data: {
        labels: data.length ? data.map((d) => d.name) : [t('patient:chart.symptom.no_data')],
        datasets: [
          {
            data: data.length ? data.map((d) => d.count) : [0],
            backgroundColor: tok.rose,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: tok.tick }, grid: { color: tok.grid } },
          x: { ticks: { color: tok.tick }, grid: { color: tok.grid } },
        },
      },
    };
  }, [symptoms, theme, t]);
  return <BaseChart config={config} height={height} ariaLabel="Symptom frequency" />;
}

export function SuppChart({ height = 220 }: { height?: number }) {
  const supplements = useStore((s) => s.supplements);
  const { theme } = useTheme();
  const config = useMemo(() => {
    const t = getChartTokens(theme);
    const dates = lastNDays(14);
    const data = dates.map((d) => Object.values(supplements[d] ?? {}).filter(Boolean).length);
    return {
      type: 'bar' as const,
      data: {
        labels: dates.map(shortLabel),
        datasets: [{ data, backgroundColor: t.sage, borderRadius: 6 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { max: SUPPS_DEFAULT.length, ticks: { color: t.tick }, grid: { color: t.grid } },
          x: { ticks: { color: t.tick }, grid: { color: t.grid } },
        },
      },
    };
  }, [supplements, theme]);
  return <BaseChart config={config} height={height} ariaLabel="Stack adherence" />;
}

export function MoodChart({ height = 220 }: { height?: number }) {
  const { t } = useTranslation('patient');
  const mood = useStore((s) => s.mood);
  const { theme } = useTheme();
  const config = useMemo(() => {
    const tok = getChartTokens(theme);
    const days = lastNDays(14);
    const m = days.map((d) => mood.find((x) => x.date === d)?.mood ?? null);
    const e = days.map((d) => mood.find((x) => x.date === d)?.energy ?? null);
    return {
      type: 'bar' as const,
      data: {
        labels: days.map(shortLabel),
        datasets: [
          {
            type: 'line' as const,
            label: t('patient:chart.mood.legend_mood'),
            data: m,
            borderColor: tok.primary,
            backgroundColor: tok.primary + '1F',
            tension: 0.3,
            fill: true,
            spanGaps: true,
            pointRadius: 3,
          },
          {
            type: 'line' as const,
            label: t('patient:chart.mood.legend_energy'),
            data: e,
            borderColor: tok.rose,
            backgroundColor: 'transparent',
            tension: 0.3,
            yAxisID: 'y2',
            spanGaps: true,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tok.tick } } },
        scales: {
          y: { min: 0, max: 5, ticks: { color: tok.tick }, grid: { color: tok.grid } },
          y2: {
            min: 0,
            max: 10,
            position: 'right' as const,
            ticks: { color: tok.tick },
            grid: { display: false },
          },
          x: { ticks: { color: tok.tick }, grid: { color: tok.grid } },
        },
      },
    };
  }, [mood, theme, t]);
  return <BaseChart config={config} height={height} ariaLabel="Mood and energy trend" />;
}

export function SleepChart({ height = 220 }: { height?: number }) {
  const { t } = useTranslation('patient');
  const sleep = useStore((s) => s.sleep);
  const { theme } = useTheme();
  const config = useMemo(() => {
    const tok = getChartTokens(theme);
    const days = lastNDays(14);
    const hours = days.map((d) => sleep.find((s) => s.date === d)?.hours ?? null);
    const qual = days.map((d) => sleep.find((s) => s.date === d)?.quality ?? null);
    return {
      type: 'bar' as const,
      data: {
        labels: days.map(shortLabel),
        datasets: [
          {
            type: 'bar' as const,
            label: t('patient:chart.sleep.legend_hours'),
            data: hours,
            backgroundColor: tok.primary + '88',
            borderRadius: 6,
          },
          {
            type: 'line' as const,
            label: t('patient:chart.sleep.legend_quality'),
            data: qual,
            borderColor: tok.sage,
            backgroundColor: 'transparent',
            tension: 0.3,
            yAxisID: 'y2',
            spanGaps: true,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tok.tick } } },
        scales: {
          y: { min: 0, max: 12, ticks: { color: tok.tick }, grid: { color: tok.grid } },
          y2: {
            min: 0,
            max: 10,
            position: 'right' as const,
            ticks: { color: tok.tick },
            grid: { display: false },
          },
          x: { ticks: { color: tok.tick }, grid: { color: tok.grid } },
        },
      },
    };
  }, [sleep, theme, t]);
  return <BaseChart config={config} height={height} ariaLabel="Sleep trend" />;
}

export function NoiseChart({ height = 220 }: { height?: number }) {
  const foodNoise = useStore((s) => s.foodNoise);
  const { theme } = useTheme();
  const config = useMemo(() => {
    const t = getChartTokens(theme);
    const days = lastNDays(14);
    const data = days.map((d) => foodNoise[d] ?? null);
    return {
      type: 'line' as const,
      data: {
        labels: days.map(shortLabel),
        datasets: [
          {
            data,
            borderColor: '#5AB7C7',
            backgroundColor: 'rgba(90,183,199,0.16)',
            fill: true,
            tension: 0.3,
            spanGaps: true,
            pointRadius: 3,
            borderWidth: 2.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 10, ticks: { color: t.tick }, grid: { color: t.grid } },
          x: { ticks: { color: t.tick }, grid: { color: t.grid } },
        },
      },
    };
  }, [foodNoise, theme]);
  return <BaseChart config={config} height={height} ariaLabel="Food noise trend" />;
}

export function CompositionChart({ height = 240 }: { height?: number }) {
  const { t } = useTranslation('patient');
  const weights = useStore((s) => s.weights);
  const { theme } = useTheme();
  const config = useMemo(() => {
    const tok = getChartTokens(theme);
    const data = weights.filter((w) => w.bodyFat);
    if (data.length < 1) {
      return {
        type: 'doughnut' as const,
        data: {
          labels: [t('patient:chart.composition.empty_label')],
          datasets: [{ data: [1], backgroundColor: [tok.surface] }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
        },
      };
    }
    const last = data[data.length - 1]!;
    const lean = last.weight * (1 - last.bodyFat! / 100);
    const fat = last.weight - lean;
    return {
      type: 'doughnut' as const,
      data: {
        labels: [t('patient:chart.composition.lean_mass'), t('patient:chart.composition.fat_mass')],
        datasets: [
          {
            data: [Number(lean.toFixed(1)), Number(fat.toFixed(1))],
            backgroundColor: [tok.sage, tok.rose],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' as const, labels: { color: tok.tick } } },
      },
    };
  }, [weights, theme, t]);
  return <BaseChart config={config} height={height} ariaLabel="Body composition" />;
}
