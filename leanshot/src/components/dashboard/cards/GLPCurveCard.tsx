import { ChartLine, Clock } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatDuration, hoursSince } from '@/lib/helpers';
import { HALF_LIVES, calcMedLevel } from '@/lib/pharmacology';
import { useStore } from '@/lib/store';

/**
 * GLP-1 level card.
 *  - Shows the past-7-day curve
 *  - Past doses appear as small circle markers along the curve
 *  - "Next shot due in Xd Yh" pill
 *  - Peak vs trough chips
 */
export function GLPCurveCard() {
  // Phase 7 Plan 07-09 (D-06): nullable selector + Rules-of-Hooks-safe
  // early-return. All hooks (useStore, useReducedMotion, useMemo) run
  // unconditionally above the early-return.
  const { t } = useTranslation('patient');
  const u = useStore((s) => s.user);
  const injections = useStore((s) => s.injections);
  const reduced = useReducedMotion();

  // Build a 7-day curve with 4-hour resolution. Memo body short-circuits
  // when `u` is null so the deps-array references `u` (not `u.medication`).
  const curve = useMemo(() => {
    if (!u) return null;
    const halfLife = HALF_LIVES[u.medication] ?? 168;
    const lastInj = injections[0];
    const W = 320;
    const H = 110;
    const totalHours = 7 * 24;
    const points: { x: number; y: number; level: number; tMs: number }[] = [];
    for (let h = 0; h <= totalHours; h += 2) {
      const tMs = Date.now() - (totalHours - h) * 3_600_000;
      const lvl = lastInj ? calcMedLevel(tMs, halfLife, injections) : 0;
      points.push({ x: (h / totalHours) * W, y: 0, level: lvl, tMs });
    }
    const max = Math.max(0.01, ...points.map((p) => p.level));
    points.forEach((p) => (p.y = H - (p.level / max) * (H - 6) - 2));
    const path = points
      .map((p, i) =>
        i === 0 ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L${p.x.toFixed(1)},${p.y.toFixed(1)}`,
      )
      .join(' ');
    const area = `${path} L ${W},${H} L 0,${H} Z`;

    // Markers for actual injections within the last 7 days
    const dots = injections
      .filter((inj) => Date.now() - new Date(inj.datetime).getTime() <= totalHours * 3_600_000)
      .map((inj) => {
        const ms = new Date(inj.datetime).getTime();
        const hAgo = (Date.now() - ms) / 3_600_000;
        const x = ((totalHours - hAgo) / totalHours) * W;
        // Clamp between visible range
        const closest = points.reduce(
          (best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best),
          points[0]!,
        );
        return { x, y: closest.y };
      });

    return {
      halfLife,
      path,
      area,
      dotMarkers: dots,
    };
  }, [u, injections]);

  if (!u || !curve) return null;

  const { halfLife, path, area, dotMarkers } = curve;
  const lastInj = injections[0];
  const hSince = lastInj ? hoursSince(lastInj.datetime) : null;

  // Static key selects for i18next-parser extraction
  const peakOrTroughKey: 'peak_now' | 'mid_cycle' | 'trough' | 'no_data' =
    hSince === null ? 'no_data' : hSince < 48 ? 'peak_now' : hSince < 120 ? 'mid_cycle' : 'trough';

  // Exhaustive switch — all cases are static literals that i18next-parser extracts
  let peakLabel: string;
  switch (peakOrTroughKey) {
    case 'peak_now':
      peakLabel = t('patient:card.glp_curve.peak_now');
      break;
    case 'mid_cycle':
      peakLabel = t('patient:card.glp_curve.mid_cycle');
      break;
    case 'trough':
      peakLabel = t('patient:card.glp_curve.trough');
      break;
    case 'no_data':
      peakLabel = t('patient:card.glp_curve.no_data');
      break;
  }

  const peakTone =
    peakOrTroughKey === 'peak_now' ? 'success' : peakOrTroughKey === 'trough' ? 'warning' : 'info';

  const currentLevel =
    lastInj && hSince !== null ? Math.round(Math.pow(0.5, hSince / halfLife) * 100) : 0;

  // Compute next shot prediction: 7 days after last shot (default GLP-1 cadence)
  const nextShotMs = lastInj
    ? new Date(lastInj.datetime).getTime() + 7 * 86_400_000 - Date.now()
    : 0;
  const nextHours = Math.max(0, nextShotMs / 3_600_000);

  // Axis labels — static keys
  const axisLabels = [
    t('patient:card.glp_curve.axis_now'),
    t('patient:card.glp_curve.axis_day3'),
    t('patient:card.glp_curve.axis_day6'),
  ] as const;

  return (
    <Card span={5} variant="default" className="min-h-[360px] flex flex-col" data-tour="glp">
      <CardHeader
        title={t('patient:card.glp_curve.title')}
        icon={<ChartLine className="size-4" />}
        action={
          <Badge tone={peakTone} pulse={peakOrTroughKey === 'peak_now'}>
            {peakLabel}
          </Badge>
        }
      />

      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-[44px] font-extrabold tracking-[-0.04em] numerals-tabular leading-none">
            {currentLevel}
          </span>
          <span className="text-[18px] opacity-70 font-bold">%</span>
          <span className="ms-1 text-[12px] text-[var(--color-text-tertiary)]">
            {t('patient:card.glp_curve.estimated')}
          </span>
        </div>
        {lastInj && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
            <Clock className="size-3.5" />
            <span>
              {t('patient:card.glp_curve.next_shot_in')}{' '}
              <strong className="text-[var(--color-text)] numerals-tabular">
                {formatDuration(nextHours)}
              </strong>
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mt-4 mb-1">
        {axisLabels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>

      <div className="relative flex-1 min-h-[100px]">
        <svg viewBox="0 0 320 110" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="glp-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#glp-fill)" />
          <path
            d={path}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Dose markers */}
          {dotMarkers.map((d, i) => (
            <g key={i}>
              <circle cx={d.x} cy={d.y} r={6} fill="var(--color-primary)" opacity={0.18} />
              <circle
                cx={d.x}
                cy={d.y}
                r={3}
                fill="var(--color-primary)"
                stroke="var(--color-surface)"
                strokeWidth={1.4}
              />
            </g>
          ))}
          {/* "Now" indicator */}
          <line
            x1="318"
            y1="0"
            x2="318"
            y2="110"
            stroke="var(--color-rose)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            opacity="0.6"
          />
        </svg>
        {!reduced && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-pill bg-[var(--color-warning-soft)] text-[var(--color-warning)] text-[10px] font-semibold tracking-tight">
            {t('patient:card.glp_curve.appetite_warning')}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <PeakChip
          tone="info"
          label={t('patient:card.glp_curve.chip_peak_label')}
          day={t('patient:card.glp_curve.chip_peak_day')}
          body={t('patient:card.glp_curve.chip_peak_body')}
        />
        <PeakChip
          tone="warning"
          label={t('patient:card.glp_curve.chip_trough_label')}
          day={t('patient:card.glp_curve.chip_trough_day')}
          body={t('patient:card.glp_curve.chip_trough_body')}
        />
      </div>
    </Card>
  );
}

function PeakChip({
  tone,
  label,
  day,
  body,
}: {
  tone: 'info' | 'warning';
  label: string;
  day: string;
  body: string;
}) {
  return (
    <div
      className={`rounded-2xl px-3.5 py-3 ${
        tone === 'info'
          ? 'bg-[var(--color-info-soft)] text-[var(--color-info)]'
          : 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] opacity-75">{label}</p>
      <p className="text-[14px] font-bold mt-0.5">{day}</p>
      <p className="text-[11px] opacity-80">{body}</p>
    </div>
  );
}
