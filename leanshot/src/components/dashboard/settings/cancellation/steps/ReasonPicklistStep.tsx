/**
 * Phase 40 Plan 40-04 — Step 1: Reason picklist.
 * Vertical stack of 7 Pill-style radio rows per UI-SPEC Surface 1 Step 1.
 * Single-chunk: non-lazy import; lives in the cancellation chunk via CancellationModal.tsx.
 */
import { Check } from 'lucide-react';
import { useState } from 'react';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/helpers';
import type { CancellationReason } from '@/types/cancellation';

interface ReasonPicklistStepProps {
  onSubmit: (reason: CancellationReason, reason_other_text?: string) => void;
  onKeep: () => void;
}

const REASONS: { value: CancellationReason; label: string }[] = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'not_using', label: 'Not using it enough' },
  { value: 'found_alternative', label: 'Found an alternative' },
  { value: 'health_goals_changed', label: 'Health goals changed' },
  { value: 'temporary_break', label: 'Temporary break needed' },
  { value: 'service_quality_issue', label: 'Service quality issue' },
  { value: 'other', label: 'Other' },
];

const MIN_OTHER_LENGTH = 4;
const MAX_OTHER_LENGTH = 280;
const COUNTER_THRESHOLD = 240;

export function ReasonPicklistStep({ onSubmit, onKeep }: ReasonPicklistStepProps) {
  const [selected, setSelected] = useState<CancellationReason | null>(null);
  const [otherText, setOtherText] = useState('');

  const isOtherSelected = selected === 'other';
  const otherValid =
    !isOtherSelected || otherText.trim().length >= MIN_OTHER_LENGTH;

  const canContinue = selected !== null && otherValid;

  const handleSubmit = (): void => {
    if (!canContinue || !selected) return;
    track('cancellation_reason_picked', { reason: selected });
    onSubmit(selected, isOtherSelected ? otherText.trim() : undefined);
  };

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div>
        <h2
          id="cancel-step-title"
          className="text-[18px] font-semibold text-[var(--color-text)]"
          tabIndex={-1}
        >
          Why are you cancelling?
        </h2>
        <p
          id="cancel-step-body"
          className="text-[13px] text-[var(--color-text-secondary)] mt-1"
        >
          Help us understand — your answer shapes what we offer next.
        </p>
      </div>

      {/* Reason pills */}
      <div role="radiogroup" aria-label="Cancellation reason" className="space-y-2">
        {REASONS.map((reason, index) => {
          const isSelected = selected === reason.value;
          const isFirst = index === 0;
          const tabIndex = isSelected || (!selected && isFirst) ? 0 : -1;

          return (
            <div key={reason.value}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={tabIndex}
                onClick={() => setSelected(reason.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    const next = REASONS[index + 1];
                    if (next) setSelected(next.value);
                  } else if (e.key === 'ArrowUp') {
                    const prev = REASONS[index - 1];
                    if (prev) setSelected(prev.value);
                  }
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] min-h-[48px]',
                  isSelected
                    ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] text-[var(--color-text)]'
                    : 'bg-transparent border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]',
                )}
              >
                {isSelected ? (
                  <Check className="size-4 text-[var(--color-primary)] shrink-0" aria-hidden />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                <span className="font-semibold text-[var(--color-text)]">{reason.label}</span>
              </button>

              {/* "Other" textarea expansion */}
              {reason.value === 'other' && isOtherSelected && (
                <div className="mt-2 space-y-1">
                  <textarea
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value.slice(0, MAX_OTHER_LENGTH))}
                    placeholder="Tell us what we could do better."
                    aria-label="Additional feedback"
                    aria-required="true"
                    className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-text)] bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
                    rows={3}
                  />
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[12px] text-[var(--color-text-tertiary)]">
                      We read every response.
                    </p>
                    <div className="flex items-center gap-2">
                      {otherText.trim().length < MIN_OTHER_LENGTH && otherText.length > 0 && (
                        <span className="text-[12px] text-[var(--color-danger)]">
                          Add at least a few words so we can act on this.
                        </span>
                      )}
                      {otherText.length >= COUNTER_THRESHOLD && (
                        <span className="text-[12px] text-[var(--color-text-tertiary)]">
                          {otherText.length}/{MAX_OTHER_LENGTH}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer CTAs */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={onKeep}
          className="px-4 py-2.5 text-[14px] font-semibold text-[var(--color-text-secondary)] rounded-xl hover:bg-[var(--color-surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          Keep my account
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canContinue}
          aria-disabled={!canContinue}
          className={cn(
            'px-5 py-2.5 rounded-xl text-[14px] font-semibold bg-[var(--color-primary)] text-[var(--color-bg)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
            !canContinue ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90',
          )}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
