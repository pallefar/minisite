import { Syringe, Scale, Apple, ShieldAlert, Smile, Pill, Activity, Bot, Zap } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { useStore } from '@/lib/store';
import type { TabId } from '@/types';

interface QuickLogCardProps {
  onOpenAI: () => void;
}

const ACTIONS: { Icon: typeof Syringe; label: string; tab?: TabId; ai?: boolean }[] = [
  { Icon: Syringe, label: 'Injection', tab: 'medication' },
  { Icon: Scale, label: 'Weight', tab: 'body' },
  { Icon: Apple, label: 'Meal', tab: 'nutrition' },
  { Icon: ShieldAlert, label: 'Symptom', tab: 'symptoms' },
  { Icon: Smile, label: 'Mood', tab: 'mood' },
  { Icon: Pill, label: 'Stack', tab: 'supplements' },
  { Icon: Activity, label: 'Workout', tab: 'activity' },
  { Icon: Bot, label: 'Ask AI', ai: true },
];

export function QuickLogCard({ onOpenAI }: QuickLogCardProps) {
  const setTab = useStore((s) => s.setTab);
  return (
    <Card span={12}>
      <CardHeader title="Quick log" icon={<Zap className="size-4" />} />
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {ACTIONS.map(({ Icon, label, tab, ai }) => (
          <button
            key={label}
            onClick={() => (ai ? onOpenAI() : tab && setTab(tab))}
            className="flex flex-col items-center justify-center gap-1.5 px-2 py-3.5 rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] hover:-translate-y-[1px] transition-[transform,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
            aria-label={label}
          >
            <span className="size-9 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center">
              <Icon className="size-4" strokeWidth={1.8} />
            </span>
            <span className="text-[11px] font-semibold">{label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
