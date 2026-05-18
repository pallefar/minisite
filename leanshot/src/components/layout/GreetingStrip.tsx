import { Sun, Moon, Cloud, Battery } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { greeting, todayStr } from '@/lib/helpers';
import {
  greetingText as i18nGreetingText,
  moodLabel as i18nMoodLabel,
  type MoodLevel,
} from '@/lib/i18n/greeting-labels';
import { useStore } from '@/lib/store';

/**
 * Personalised greeting strip — "Good morning, Karsten".
 * Right side shows live "weather-style" mood + energy chips populated from
 * the most recent mood log (today preferred, otherwise latest).
 *
 * Phase 32 Plan 32-02 — greeting + mood/energy labels via t() (`common` ns).
 * `greeting()` helper returns the time-of-day SLOT ('morning'|'afternoon'|'evening');
 * the i18n lookup is performed in `greeting-labels.ts` via an exhaustive
 * switch over MoodLevel + GreetingSlot so i18next-parser sees literal keys.
 */
export function GreetingStrip() {
  const { t } = useTranslation('common');
  const name = useStore((s) => s.user?.name ?? t('profile_friend'));
  const moodLogs = useStore((s) => s.mood);

  const today = todayStr();
  const mood = moodLogs.find((m) => m.date === today) ?? moodLogs[moodLogs.length - 1] ?? null;

  const part = greeting();
  const Icon = part === 'evening' ? Moon : part === 'afternoon' ? Cloud : Sun;
  const moodLabel =
    mood && mood.mood >= 1 && mood.mood <= 5
      ? i18nMoodLabel(t, mood.mood as MoodLevel)
      : t('mood_label_not_yet');
  const energyLabel = mood?.energy ? `${mood.energy}/10` : '—';
  const greetingTextValue = i18nGreetingText(t, part);

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
            {`${greetingTextValue},`}
          </p>
          <p className="text-[18px] font-bold leading-tight tracking-tight truncate">
            {name}
            <span className="font-display italic font-normal text-[var(--color-primary)]">
              {' ·'}
            </span>
          </p>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-[var(--color-surface)] border border-[var(--color-border)] text-[12px] font-semibold">
          <span className="size-1.5 rounded-full bg-[var(--color-success)]" aria-hidden />
          <span className="text-[var(--color-text-secondary)]">{t('mood_label_word')}</span>
          <span className="text-[var(--color-text)]">{moodLabel}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-[var(--color-surface)] border border-[var(--color-border)] text-[12px] font-semibold">
          <Battery className="size-3.5 text-[var(--color-amber)]" />
          <span className="text-[var(--color-text-secondary)]">{t('energy_label_word')}</span>
          <span className="text-[var(--color-text)]">{energyLabel}</span>
        </span>
      </div>
    </div>
  );
}
