/**
 * Phase 40 Plan 40-04 — Pause duration selector inside OfferCard.
 * PillGroup for 1 / 2 / 3 month presets; default = 2 months (highest take-rate).
 * "Resumes {date}" strip updates live when user picks a different preset.
 * Single-chunk: non-lazy import; lives in the cancellation chunk via CancellationModal.tsx.
 */
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/helpers';

interface PauseControlsProps {
  value: 1 | 2 | 3;
  onChange: (v: 1 | 2 | 3) => void;
  resumesAt: string;
}

const PRESET_MONTHS: (1 | 2 | 3)[] = [1, 2, 3];

function pauseMonthLabel(t: TFunction, months: 1 | 2 | 3): string {
  switch (months) {
    case 1:
      return t('settings:cancellation.pause.month_one');
    case 2:
      return t('settings:cancellation.pause.month_two');
    case 3:
      return t('settings:cancellation.pause.month_three');
    default: {
      const _exhaustive: never = months;
      return _exhaustive;
    }
  }
}

export function PauseControls({ value, onChange, resumesAt }: PauseControlsProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-[var(--color-text)]">
        {t('settings:cancellation.pause.duration_label')}
      </p>
      <div
        role="group"
        aria-label={t('settings:cancellation.pause.duration_label')}
        className="flex gap-2"
      >
        {PRESET_MONTHS.map((months) => {
          const selected = value === months;
          return (
            <button
              key={months}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(months)}
              className={cn(
                'flex-1 px-3 py-2 rounded-lg text-[13px] font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                selected
                  ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'bg-transparent border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]',
              )}
            >
              {pauseMonthLabel(t, months)}
            </button>
          );
        })}
      </div>
      <div className="bg-[var(--color-surface-soft)] rounded-md px-3 py-2 text-[13px] text-[var(--color-text-secondary)] font-mono">
        {t('settings:cancellation.pause.resumes', { date: resumesAt })}
      </div>
    </div>
  );
}
