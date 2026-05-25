import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Syringe } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { SiteRotation } from '@/illustrations/SiteRotation';
import { SITES } from '@/lib/constants';
import { useStore } from '@/lib/store';
import type { InjectionSite } from '@/types';

/** Body figure with numbered rotation dots + zone labels (DS-09 v2). */
export function SiteRotationCard() {
  const { t } = useTranslation('patient');
  const injections = useStore((s) => s.injections);
  const setTab = useStore((s) => s.setTab);

  const status: Record<InjectionSite, 'recent' | 'older' | 'next' | 'empty'> = {
    'abdomen-ul': 'empty',
    'abdomen-ur': 'empty',
    'abdomen-ll': 'empty',
    'abdomen-lr': 'empty',
    'thigh-l': 'empty',
    'thigh-r': 'empty',
    'arm-l': 'empty',
    'arm-r': 'empty',
  };
  injections.slice(0, 8).forEach((inj) => {
    if (!inj.site) return;
    const days = (Date.now() - new Date(inj.datetime).getTime()) / 86_400_000;
    if (days < 7 && status[inj.site] === 'empty') status[inj.site] = 'recent';
    else if (days < 14 && status[inj.site] === 'empty') status[inj.site] = 'older';
  });
  const empty = SITES.find((s) => status[s] === 'empty');
  if (empty) status[empty] = 'next';

  return (
    <Card span={4} variant="default" data-tour="sites">
      <CardHeader
        title={t('patient:card.site_rotation.title')}
        icon={<Syringe className="size-4" />}
        action={
          <button
            onClick={() => setTab('medication')}
            aria-label={t('patient:card.site_rotation.open_medication_tab')}
            className="size-8 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <ArrowUpRight className="size-4" />
          </button>
        }
      />

      <div className="flex justify-center py-2">
        <SiteRotation status={status} className="w-[140px]" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-2 text-[11px] text-[var(--color-text-secondary)]">
        <Legend color="var(--color-warning)" label={t('patient:card.site_rotation.legend_recent')} />
        <Legend color="var(--color-amber)" label={t('patient:card.site_rotation.legend_older')} />
        <Legend color="var(--color-success)" label={t('patient:card.site_rotation.legend_next')} />
      </div>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
