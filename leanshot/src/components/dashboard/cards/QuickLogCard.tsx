import type { TFunction } from 'i18next';
import { Syringe, Scale, Apple, ShieldAlert, Smile, Pill, Activity, Bot, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '@/components/ui/Card';
import { useStore } from '@/lib/store';
import type { TabId } from '@/types';

interface QuickLogCardProps {
  onOpenAI: () => void;
}

type ActionId =
  | 'injection'
  | 'weight'
  | 'meal'
  | 'symptom'
  | 'mood'
  | 'stack'
  | 'workout'
  | 'ask_ai';

const ACTIONS: { id: ActionId; Icon: typeof Syringe; tab?: TabId; ai?: boolean }[] = [
  { id: 'injection', Icon: Syringe, tab: 'medication' },
  { id: 'weight', Icon: Scale, tab: 'body' },
  { id: 'meal', Icon: Apple, tab: 'nutrition' },
  { id: 'symptom', Icon: ShieldAlert, tab: 'symptoms' },
  { id: 'mood', Icon: Smile, tab: 'mood' },
  { id: 'stack', Icon: Pill, tab: 'supplements' },
  { id: 'workout', Icon: Activity, tab: 'activity' },
  { id: 'ask_ai', Icon: Bot, ai: true },
];

// Exhaustive switch helper — static keys so i18next-parser can extract them.
function getActionLabel(t: TFunction, id: ActionId): string {
  switch (id) {
    case 'injection':
      return t('patient:card.quick_log.action_injection');
    case 'weight':
      return t('patient:card.quick_log.action_weight');
    case 'meal':
      return t('patient:card.quick_log.action_meal');
    case 'symptom':
      return t('patient:card.quick_log.action_symptom');
    case 'mood':
      return t('patient:card.quick_log.action_mood');
    case 'stack':
      return t('patient:card.quick_log.action_stack');
    case 'workout':
      return t('patient:card.quick_log.action_workout');
    case 'ask_ai':
      return t('patient:card.quick_log.action_ask_ai');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function QuickLogCard({ onOpenAI }: QuickLogCardProps) {
  const { t } = useTranslation('patient');
  const setTab = useStore((s) => s.setTab);
  return (
    <Card span={12}>
      <CardHeader title={t('patient:card.quick_log.title')} icon={<Zap className="size-4" />} />
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {ACTIONS.map(({ id, Icon, tab, ai }) => {
          const label = getActionLabel(t, id);
          return (
            <button
              key={id}
              onClick={() => (ai ? onOpenAI() : tab && setTab(tab))}
              className="flex flex-col items-center justify-center gap-1.5 px-2 py-3.5 rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] hover:-translate-y-[1px] transition-[transform,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
              aria-label={label}
            >
              <span className="size-9 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center">
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <span className="text-[11px] font-semibold">{label}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
