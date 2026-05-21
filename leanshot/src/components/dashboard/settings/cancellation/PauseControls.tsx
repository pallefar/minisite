/**
 * Phase 40 Plan 40-04 — Pause duration selector inside OfferCard.
 * PillGroup for 1 / 2 / 3 month presets; default = 2 months (highest take-rate).
 * "Resumes {date}" strip updates live when user picks a different preset.
 * Single-chunk: non-lazy import; lives in the cancellation chunk via CancellationModal.tsx.
 */
import { cn } from '@/lib/helpers';

interface PauseControlsProps {
  value: 1 | 2 | 3;
  onChange: (v: 1 | 2 | 3) => void;
  resumesAt: string;
}

const PRESETS: { months: 1 | 2 | 3; label: string }[] = [
  { months: 1, label: '1 month' },
  { months: 2, label: '2 months' },
  { months: 3, label: '3 months' },
];

export function PauseControls({ value, onChange, resumesAt }: PauseControlsProps) {
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-[var(--color-text)]">Pause duration</p>
      <div
        role="group"
        aria-label="Pause duration"
        className="flex gap-2"
      >
        {PRESETS.map(({ months, label }) => {
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
              {label}
            </button>
          );
        })}
      </div>
      <div className="bg-[var(--color-surface-soft)] rounded-md px-3 py-2 text-[13px] text-[var(--color-text-secondary)] font-mono">
        Resumes {resumesAt}
      </div>
    </div>
  );
}
