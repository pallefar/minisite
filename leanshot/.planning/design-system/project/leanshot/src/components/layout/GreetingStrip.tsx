import { Sun, Moon, Cloud, Battery } from 'lucide-react';
import { greeting, todayStr } from '@/lib/helpers';
import { useStore } from '@/lib/store';

/**
 * Personalised greeting strip — "Good morning, Karsten".
 * Right side shows live "weather-style" mood + energy chips populated from
 * the most recent mood log (today preferred, otherwise latest).
 */
export function GreetingStrip() {
  const name = useStore((s) => s.user?.name ?? 'friend');
  const moodLogs = useStore((s) => s.mood);

  const today = todayStr();
  const mood = moodLogs.find((m) => m.date === today) ?? moodLogs[moodLogs.length - 1] ?? null;

  const part = greeting();
  const Icon = part === 'evening' ? Moon : part === 'afternoon' ? Cloud : Sun;
  const moodLabel = mood ? ['Tough', 'Low', 'Even', 'Good', 'Great'][mood.mood - 1] : 'Not yet';
  const energyLabel = mood?.energy ? `${mood.energy}/10` : '—';

  return (
    <div className="flex items-center justify-between gap-4 mb-4 md:mb-5 animate-fade-in">
      <div className="flex items-center gap-3 min-w-0">
        <span
          aria-hidden
          className="size-9 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] inline-flex items-center justify-center text-[var(--color-amber)] shadow-[var(--shadow-xs)]"
        >
          <Icon className="size-[18px]" strokeWidth={1.7} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-tight">
            Good {part},
          </p>
          <p className="text-[18px] font-bold leading-tight tracking-tight truncate">
            {name}
            <span className="font-display italic font-normal text-[var(--color-primary)]"> ·</span>
          </p>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-[var(--color-surface)] border border-[var(--color-border)] text-[12px] font-semibold">
          <span className="size-1.5 rounded-full bg-[var(--color-success)]" aria-hidden />
          <span className="text-[var(--color-text-secondary)]">Mood</span>
          <span className="text-[var(--color-text)]">{moodLabel}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-[var(--color-surface)] border border-[var(--color-border)] text-[12px] font-semibold">
          <Battery className="size-3.5 text-[var(--color-amber)]" />
          <span className="text-[var(--color-text-secondary)]">Energy</span>
          <span className="text-[var(--color-text)]">{energyLabel}</span>
        </span>
      </div>
    </div>
  );
}
