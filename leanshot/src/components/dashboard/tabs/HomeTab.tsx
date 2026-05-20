import { Lightbulb } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo } from 'react';
import { EffectivenessCard } from '@/components/dashboard/cards/EffectivenessCard';
import { FocusCard } from '@/components/dashboard/cards/FocusCard';
import { GLPCurveCard } from '@/components/dashboard/cards/GLPCurveCard';
import { HeroCard } from '@/components/dashboard/cards/HeroCard';
import { QuickLogCard } from '@/components/dashboard/cards/QuickLogCard';
import { SiteRotationCard } from '@/components/dashboard/cards/SiteRotationCard';
import { StreaksCard } from '@/components/dashboard/cards/StreaksCard';
import { SymptomCard } from '@/components/dashboard/cards/SymptomCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

const ForYouCard = lazy(() => import('@/components/dashboard/cards/ForYouCard'));
import { generateInsights } from '@/lib/insights';
import { initialState } from '@/lib/storage';
import { useStore } from '@/lib/store';

export function HomeTab({ onOpenAI }: { onOpenAI: () => void }) {
  const setTab = useStore((s) => s.setTab);

  // Phase 42 Plan 04 (D-16) — track dashboard visits for the deferred install
  // prompt. Lazy-imported so the install-prompt module stays in its existing
  // PWA lazy chunk (no impact on HomeTab's chunk size).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      import('@/lib/pwa/install-prompt'),
      import('@/hooks/useInstallPrompt'),
    ]).then(([ip, hook]) => {
      if (cancelled) return;
      ip.recordDashboardVisit();
      hook.notifyInstallPromptTick();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // generateInsights returns a fresh array each call — using it as a Zustand
  // selector makes useSyncExternalStore's snapshot unstable. Subscribe to
  // raw slices and memoize the derived [0] insight.
  const user = useStore((s) => s.user);
  const weights = useStore((s) => s.weights);
  const meals = useStore((s) => s.meals);
  const symptoms = useStore((s) => s.symptoms);
  const injections = useStore((s) => s.injections);
  const workouts = useStore((s) => s.workouts);
  const water = useStore((s) => s.water);
  const mood = useStore((s) => s.mood);
  const insight = useMemo(
    () =>
      generateInsights({
        ...initialState,
        user,
        weights,
        meals,
        symptoms,
        injections,
        workouts,
        water,
        mood,
      })[0],
    [user, weights, meals, symptoms, injections, workouts, water, mood],
  );

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <FocusCard />
      <HeroCard />
      <GLPCurveCard />
      <SiteRotationCard />
      <EffectivenessCard />
      <SymptomCard />
      <StreaksCard />
      <QuickLogCard onOpenAI={onOpenAI} />

      <Suspense
        fallback={
          <Card span={6}>
            <CardHeader title="For you" />
            <Skeleton className="h-20" />
          </Card>
        }
      >
        <ForYouCard span={6} />
      </Suspense>

      <Card span={12}>
        <CardHeader title="Today's insight" icon={<Lightbulb className="size-4" />} />
        {insight ? (
          <div className="rounded-2xl bg-[var(--color-info-soft)] border border-[var(--color-info-soft)] px-4 py-3.5 flex gap-3">
            <span className="size-9 rounded-xl bg-[var(--color-info)] text-white inline-flex items-center justify-center shrink-0">
              <Lightbulb className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-[var(--color-text)]">{insight.title}</p>
              <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5 leading-snug">
                {insight.body}
              </p>
            </div>
            {insight.cta && (
              <button
                className="text-[13px] font-bold text-[var(--color-primary)] hover:underline shrink-0 self-center focus-visible:outline-none focus-visible:underline"
                onClick={() => setTab(insight.cta!.tab)}
              >
                {insight.cta.label} →
              </button>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Keep logging — insights appear once you have a few days of data.
          </p>
        )}
      </Card>
    </div>
  );
}
