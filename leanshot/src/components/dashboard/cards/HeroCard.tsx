import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useCountUp } from '@/hooks/useCountUp';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { HeroOrbital } from '@/illustrations/HeroOrbital';
import { cn } from '@/lib/helpers';
import { medLabelShort, TITRATION } from '@/lib/pharmacology';
import { useStore } from '@/lib/store';

/**
 * Home hero card.
 *  - Animated mesh gradient using three drifting radial gradients
 *  - Editorial Fraunces "Weight" / "Lost" label
 *  - Live count-up on the headline number
 *  - Spotify-style titration track at the bottom with current dose pulsing
 */
export function HeroCard() {
  // Phase 7 Plan 07-09 (D-06): nullable selector + Rules-of-Hooks-safe
  // early-return. All hooks (useStore×4, useReducedMotion, useCountUp×4)
  // run unconditionally above the `if (!u) return null;` guard. Derived
  // values default to 0 / null when u is null so the count-up hooks
  // receive stable inputs during the transient window.
  const { t } = useTranslation('patient');
  const u = useStore((s) => s.user);
  const weights = useStore((s) => s.weights);
  const injections = useStore((s) => s.injections);
  const meals = useStore((s) => s.meals);
  const reduced = useReducedMotion();

  const latest = weights[weights.length - 1];
  const lost = u && latest ? u.startWeight - latest.weight : 0;
  const lostAbs = Math.abs(lost);
  const today = new Date().toISOString().slice(0, 10);
  const todayProtein = meals
    .filter((m) => m.date === today)
    .reduce((acc, m) => acc + (m.protein || 0), 0);
  const goalLoss = u ? u.startWeight - u.goalWeight : 0;
  const goalPct =
    goalLoss > 0 ? Math.min(100, Math.max(0, Math.round((lost / goalLoss) * 100))) : 0;

  const countLost = useCountUp(lostAbs, { duration: 900 });
  const countGoal = useCountUp(goalPct, { duration: 900 });
  const countShots = useCountUp(injections.length, { duration: 700 });
  const countProtein = useCountUp(todayProtein, { duration: 700 });

  if (!u) return null;

  const wU = u.units === 'metric' ? 'kg' : 'lb';
  const direction =
    lost >= 0 ? t('patient:card.hero.direction_lost') : t('patient:card.hero.direction_gained');
  const weeks = Math.floor((Date.now() - new Date(u.startDate).getTime()) / (7 * 86_400_000));

  let phase: string;
  let phaseTip: string;
  if (weeks < 4) {
    phase = t('patient:card.hero.phase_tolerance');
    phaseTip = t('patient:card.hero.phase_tip_tolerance');
  } else if (weeks < 16) {
    phase = t('patient:card.hero.phase_titration');
    phaseTip = t('patient:card.hero.phase_tip_titration');
  } else {
    phase = t('patient:card.hero.phase_maintenance');
    phaseTip = t('patient:card.hero.phase_tip_maintenance');
  }

  const titList = TITRATION[u.medication];

  return (
    <Card
      span={7}
      variant="hero"
      padding="none"
      className="relative overflow-hidden bg-[var(--color-hero-bg)] text-white shadow-hero min-h-[360px] border-0 group"
      data-tour="hero"
    >
      {/* Animated mesh gradient */}
      <Mesh reduced={reduced} />
      <HeroOrbital className="absolute -right-12 -bottom-16 w-[360px] h-[360px] opacity-50 pointer-events-none select-none" />

      {/* Top bar */}
      <div className="relative z-10 flex items-start justify-between gap-3 p-6 md:p-7">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="inverse">{medLabelShort(u.medication)}</Badge>
          <Badge tone="inverse">
            {u.dose} {u.doseUnit}
          </Badge>
        </div>
        <Badge tone="inverse" className="bg-white text-[var(--color-hero-bg)] border-transparent">
          Rx · {medLabelShort(u.medication)}
        </Badge>
      </div>

      {/* Editorial headline */}
      <div className="relative z-10 px-6 md:px-7">
        <p className="font-display italic font-light text-[clamp(28px,3.4vw,42px)] leading-none opacity-95">
          {direction}
        </p>
        <p className="mt-1 text-[clamp(48px,7vw,82px)] font-extrabold tracking-[-0.04em] leading-[0.92] numerals-tabular">
          {countLost.toFixed(1)}
          <span className="ms-2 text-[0.42em] font-medium opacity-70">{wU}</span>
        </p>
        <p className="mt-2 text-[13px] opacity-80">
          {t('patient:card.hero.week_phase_tip', { week: weeks, phase, phaseTip })}
        </p>
      </div>

      {/* Stats row */}
      <div className="relative z-10 px-6 md:px-7 mt-5 flex flex-wrap gap-x-6 gap-y-3">
        <Stat label={t('patient:card.hero.stat_goal')} value={`${Math.round(countGoal)}%`} />
        <Divider />
        <Stat
          label={t('patient:card.hero.stat_injections')}
          value={Math.round(countShots).toString()}
        />
        <Divider />
        <Stat
          label={t('patient:card.hero.stat_protein_today')}
          value={
            <>
              {Math.round(countProtein)}
              <span className="text-[0.6em] opacity-70">/{u.proteinTarget}g</span>
            </>
          }
        />
      </div>

      {/* Titration track — Spotify-style */}
      {titList && (
        <div className="relative z-10 mx-6 md:mx-7 mb-6 mt-6 rounded-2xl bg-white/8 border border-white/15 backdrop-blur-md px-4 md:px-5 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-70">
              {t('patient:card.hero.titration_timeline')}
            </p>
            <p className="text-[11px] opacity-60">{t('patient:card.hero.titration_hint')}</p>
          </div>
          <TitrationTrack steps={titList} currentWeek={weeks} t={t} />
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[20px] md:text-[22px] font-bold leading-tight numerals-tabular">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-65 mt-0.5">
        {label}
      </p>
    </div>
  );
}

function Divider() {
  return <span className="h-7 w-px bg-white/15" aria-hidden />;
}

interface TitrationTrackProps {
  steps: Array<{ d: string; w: string; n: string }>;
  currentWeek: number;
  t: (key: string) => string;
}
function TitrationTrack({ steps, currentWeek, t }: TitrationTrackProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none -mx-1 px-1 pb-1">
      {steps.map((s, i) => {
        const wks = s.w.split('–');
        const start = parseInt(wks[0] ?? '0') || 0;
        const end = wks[1] ? parseInt(wks[1]) : 999;
        const isCurrent = currentWeek >= start && currentWeek <= end;
        const isDone = currentWeek > end;
        return (
          <div key={s.d + s.w} className="flex items-center gap-1 shrink-0">
            <button
              className={cn(
                'flex flex-col items-center gap-1 px-2 py-1 rounded-xl transition-colors min-w-[68px]',
                isCurrent && 'bg-white/10',
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="relative">
                <span
                  className={cn(
                    'block size-2.5 rounded-full',
                    isCurrent && 'bg-[var(--color-rose)]',
                    isDone && !isCurrent && 'bg-white/60',
                    !isDone && !isCurrent && 'bg-white/30',
                  )}
                />
                {isCurrent && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full ring-2 ring-[var(--color-rose)]/35 animate-ping"
                  />
                )}
              </div>
              <span
                className={cn(
                  'text-[12px] font-bold whitespace-nowrap',
                  isCurrent ? 'opacity-100' : 'opacity-65',
                  isDone && !isCurrent && 'line-through opacity-50',
                )}
              >
                {s.d}
              </span>
              <span className="text-[10px] opacity-65 whitespace-nowrap">
                {isCurrent ? t('patient:card.hero.titration_now_prefix') : ''}Wk {s.w}
              </span>
            </button>
            {i < steps.length - 1 && <div className="h-px w-4 bg-white/20 hidden md:block" />}
          </div>
        );
      })}
    </div>
  );
}

/** Subtle drifting mesh gradient — three radial layers. */
function Mesh({ reduced }: { reduced: boolean }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div
        className={cn(
          'absolute -top-1/4 -right-1/4 w-[120%] h-[120%]',
          !reduced && 'animate-mesh-drift',
        )}
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgba(168,205,196,0.36), transparent 55%), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.18), transparent 50%), radial-gradient(circle at 40% 80%, rgba(243,201,178,0.16), transparent 60%)',
        }}
      />
    </div>
  );
}
