import { useMemo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { getChartTokens } from '@/lib/chart-theme';
import { PK_DISCLAIMER_BAND_CAPTION, PK_DISCLAIMER_Y_AXIS } from '@/lib/disclaimers';
import { HALF_LIVES, calcMedLevel, trialClass } from '@/lib/pharmacology';
import { CV_BY_DRUG_CLASS } from '@/lib/pharmacology-corpus';
import { useStore } from '@/lib/store';
import type { Injection, MedicationId, WeightLog } from '@/types';
import type { SnapshotResponse } from '@/types/share';
import { BaseChart } from './BaseChart';
import { medLevelWatermarkPlugin } from './medLevelWatermarkPlugin';

/**
 * Phase 8 Plan 08-04 (HI-5) — optional snapshot props let the doctor read-share
 * route pass injections + weights + the active medication via props, so the
 * share lazy chunk never touches the Zustand store. When props are absent the
 * chart falls back to the existing `useStore` reads (dashboard path
 * unchanged). The `useStore` selectors must run unconditionally (Rules of
 * Hooks) — the prop-vs-store choice happens AFTER all hooks resolve.
 */
export interface MedLevelChartProps {
  height?: number;
  /** Optional snapshot injections; when omitted, falls back to `useStore.injections`. */
  injections?: SnapshotResponse['snapshot']['injections'];
  /** Optional snapshot weights; when omitted, falls back to `useStore.weights`. */
  weights?: SnapshotResponse['snapshot']['weights'];
  /** Optional medication id for the share route (no store user available). */
  medication?: MedicationId;
}

/** Map snapshot-shape injections to the Injection shape `calcMedLevel` expects. */
function snapshotInjectionsToDashboard(
  injections: SnapshotResponse['snapshot']['injections'],
): Injection[] {
  return injections.map((i) => ({
    log_id: i.log_id,
    datetime: i.timestamp,
    dose: String(i.dose),
    unit: i.unit as Injection['unit'],
    site: (i.site || null) as Injection['site'],
    notes: '',
  }));
}

/** Map snapshot weights to dashboard WeightLog (ISO timestamp → YYYY-MM-DD). */
function snapshotWeightsToDashboard(
  weights: SnapshotResponse['snapshot']['weights'],
): WeightLog[] {
  return weights.map((w) => ({
    date: w.timestamp.slice(0, 10),
    weight: w.weight_kg,
    bodyFat: null,
    ts: new Date(w.timestamp).getTime(),
  }));
}

/** 28-day past + 7-day projected medication level chart. */
export function MedLevelChart(props: MedLevelChartProps) {
  const { height = 280 } = props;
  // Phase 6 Plan 06-01 (UI-CHECK + 06-CONTEXT D-12 #3) + Phase 7 Plan
  // 07-09 (D-06): the nullable-selector + early-return pattern below is
  // the canonical shape for "this component needs a logged-in user".
  // MedLevelChart can mount transiently during the SIGNED_OUT →
  // clearUserDataSlices() window (and on first paint before onboarding
  // completes) when `s.user === null`; the prior non-null assertion lied
  // and crashed with "Cannot read properties of null (reading
  // 'medication')". Hook order is preserved: all `useStore` selectors +
  // `useTheme` + `useMemo` run unconditionally; the `useMemo` body
  // short-circuits when `u` is null so the early-return below
  // (`if (!u) return null`) is legal under Rules of Hooks.
  //
  // Phase 8 Plan 08-04 (HI-5) — the share route passes its own snapshot
  // data via props. The store reads still run (Rules of Hooks) but we
  // prefer the props when present so the share lazy chunk never sees
  // Zustand state.
  const storeUser = useStore((s) => s.user);
  const storeInjections = useStore((s) => s.injections);
  const storeWeights = useStore((s) => s.weights);
  const { theme } = useTheme();

  const propInjections = props.injections;
  const propWeights = props.weights;
  const propMedication = props.medication;

  const config = useMemo(() => {
    // Resolve medication: prop wins; else store user's medication; else
    // null (no chart can be rendered without a medication).
    const medication: MedicationId | null =
      propMedication ?? (storeUser ? storeUser.medication : null);
    if (!medication) return null;

    const injections: Injection[] = propInjections
      ? snapshotInjectionsToDashboard(propInjections)
      : storeInjections;
    const weights: WeightLog[] = propWeights
      ? snapshotWeightsToDashboard(propWeights)
      : storeWeights;
    // `weights` is retained for future-PK extension symmetry with the
    // dashboard call site; reference it so unused-locals does not fire.
    void weights;

    const t = getChartTokens(theme);
    const halfLife = HALF_LIVES[medication] ?? 168;
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

    // Phase 3 PK-03: inter-individual variability band per drug class CV%.
    const cvPct = CV_BY_DRUG_CLASS[trialClass(medication)] ?? 0.3;
    const upperPast = past.map((v) => (v == null ? null : v * (1 + cvPct)));
    const lowerPast = past.map((v) => (v == null ? null : v * (1 - cvPct)));
    const upperFuture = future.map((v) => (v == null ? null : v * (1 + cvPct)));
    const lowerFuture = future.map((v) => (v == null ? null : v * (1 - cvPct)));
    // Empty-state suppression: with zero injections every mean is zero so the
    // ±CV band would render as a ghost-fill artifact along the x-axis. Skip.
    const showBand = injections.length > 0;

    return {
      type: 'line' as const,
      data: {
        labels,
        // Dataset ordering reconciliation (PATTERNS.md): visible lines FIRST so
        // the UI-SPEC tooltip filter `(item) => item.datasetIndex < 2` cleanly
        // EXCLUDES the band datasets. Chart.js `fill: '+1'` is index-relative,
        // so upper-bound (idx N) → lower-bound (idx N+1) still works.
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
          ...(showBand
            ? [
                {
                  label: 'Upper bound (Past)',
                  data: upperPast,
                  borderColor: 'transparent',
                  backgroundColor: t.primary + '20',
                  fill: '+1',
                  tension: 0.3,
                  pointRadius: 0,
                  spanGaps: false,
                },
                {
                  label: 'Lower bound (Past)',
                  data: lowerPast,
                  borderColor: 'transparent',
                  backgroundColor: 'transparent',
                  fill: false,
                  tension: 0.3,
                  pointRadius: 0,
                  spanGaps: false,
                },
                {
                  label: 'Upper bound (Projected)',
                  data: upperFuture,
                  borderColor: 'transparent',
                  backgroundColor: t.rose + '20',
                  fill: '+1',
                  tension: 0.3,
                  pointRadius: 0,
                  spanGaps: true,
                },
                {
                  label: 'Lower bound (Projected)',
                  data: lowerFuture,
                  borderColor: 'transparent',
                  backgroundColor: 'transparent',
                  fill: false,
                  tension: 0.3,
                  pointRadius: 0,
                  spanGaps: true,
                },
              ]
            : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' as const },
        plugins: {
          legend: {
            labels: {
              color: t.tick,
              filter: (item: { text: string }) => item.text === 'Past' || item.text === 'Projected',
            },
          },
          tooltip: {
            filter: (item: { datasetIndex: number }) => item.datasetIndex < 2,
          },
          // D-13 + Phase 3 D-08: theme-aware diagonal two-line watermark
          // drawn into the canvas itself so screenshots carry the disclaimer.
          // Plugin options key uses the v2 id (quoted because of hyphen).
          'medLevelWatermark-v2': {
            color: theme === 'dark' ? '220, 220, 220' : '60, 60, 60',
            opacity: theme === 'dark' ? 0.18 : 0.12,
          },
        },
        scales: {
          y: {
            ticks: { color: t.tick, callback: (v: string | number) => Number(v).toFixed(1) },
            grid: { color: t.grid },
            // Phase 3 SC#1: Y-axis carries NO measurement-grade unit.
            title: { display: true, text: PK_DISCLAIMER_Y_AXIS, color: t.tick },
          },
          x: { ticks: { color: t.tick, maxTicksLimit: 10 }, grid: { color: t.grid } },
        },
      },
      // D-15: per-instance plugin registration. NEVER Chart.register() — that would
      // leak the watermark onto every chart sharing BaseChart (weight, symptom, sparkline).
      plugins: [medLevelWatermarkPlugin],
    };
  }, [
    storeUser,
    storeInjections,
    storeWeights,
    propInjections,
    propWeights,
    propMedication,
    theme,
  ]);

  // Phase 6 Plan 06-01 (D-12 #3): early-return AFTER hooks so the Rules of
  // Hooks are preserved (hooks run unconditionally; render output is
  // null-guarded). Renders nothing during the transient SIGNED_OUT or
  // pre-onboarding window when `user` is null. Phase 8: if the share route
  // passes `injections` but no `medication`, this guard also catches that.
  if (!config) return null;

  return (
    <>
      <BaseChart
        config={config}
        height={height}
        ariaLabel="28-day medication level estimate with inter-individual variability band, not a measured serum level"
      />
      <p className="text-[12px] italic text-[var(--color-text-tertiary)] text-center mt-1">
        {PK_DISCLAIMER_BAND_CAPTION}
      </p>
    </>
  );
}
