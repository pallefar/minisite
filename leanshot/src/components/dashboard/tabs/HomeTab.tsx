import { Lightbulb } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { HeroCard } from '@/components/dashboard/cards/HeroCard';
import { GLPCurveCard } from '@/components/dashboard/cards/GLPCurveCard';
import { FocusCard } from '@/components/dashboard/cards/FocusCard';
import { SiteRotationCard } from '@/components/dashboard/cards/SiteRotationCard';
import { EffectivenessCard } from '@/components/dashboard/cards/EffectivenessCard';
import { SymptomCard } from '@/components/dashboard/cards/SymptomCard';
import { StreaksCard } from '@/components/dashboard/cards/StreaksCard';
import { QuickLogCard } from '@/components/dashboard/cards/QuickLogCard';
import { useStore } from '@/lib/store';
import { generateInsights } from '@/lib/insights';

export function HomeTab({ onOpenAI }: { onOpenAI: () => void }) {
  const setTab = useStore((s) => s.setTab);
  const insight = useStore((s) => generateInsights(s)[0]);

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

      <Card span={12}>
        <CardHeader title="Today's insight" icon={<Lightbulb className="size-4" />} />
        {insight ? (
          <div className="rounded-2xl bg-[var(--color-info-soft)] border border-[var(--color-info-soft)] px-4 py-3.5 flex gap-3">
            <span className="size-9 rounded-xl bg-[var(--color-info)] text-white inline-flex items-center justify-center shrink-0">
              <Lightbulb className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-[var(--color-text)]">{insight.title}</p>
              <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5 leading-snug">{insight.body}</p>
            </div>
            {insight.cta && (
              <button
                className="text-[13px] font-bold text-[var(--color-primary)] hover:underline shrink-0 self-center focus-visible:outline-none focus-visible:underline"
                onClick={() => setTab(insight.cta!.tab as never)}
              >
                {insight.cta.label} →
              </button>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Keep logging — insights appear once you have a few days of data.</p>
        )}
      </Card>
    </div>
  );
}
