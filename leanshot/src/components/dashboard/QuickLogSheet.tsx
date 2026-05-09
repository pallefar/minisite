import { Syringe, Scale, Apple, ShieldAlert, Smile, Pill, Activity, Bot } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { useStore } from '@/lib/store';
import type { TabId } from '@/types';

interface QuickLogSheetProps {
  open: boolean;
  onClose: () => void;
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

/**
 * Mobile quick-log bottom sheet — tapping any tile takes you straight
 * to the relevant tab. Apple-style with drag-to-dismiss handle.
 */
export function QuickLogSheet({ open, onClose, onOpenAI }: QuickLogSheetProps) {
  const setTab = useStore((s) => s.setTab);
  return (
    <Sheet open={open} onClose={onClose} title="Quick log">
      <div className="grid grid-cols-4 gap-2">
        {ACTIONS.map(({ Icon, label, tab, ai }) => (
          <button
            key={label}
            onClick={() => {
              if (ai) {
                onOpenAI();
              } else if (tab) {
                setTab(tab);
              }
              onClose();
            }}
            className="flex flex-col items-center gap-1.5 px-2 py-4 rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] transition-colors"
            aria-label={label}
          >
            <span className="size-11 rounded-2xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center">
              <Icon className="size-5" strokeWidth={1.8} />
            </span>
            <span className="text-[12px] font-semibold">{label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
