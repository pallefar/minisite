/**
 * Phase 40 Plan 40-04 — Step 1: Reason picklist.
 * Vertical stack of 7 Pill-style radio rows per UI-SPEC Surface 1 Step 1.
 * Single-chunk: non-lazy import; lives in the cancellation chunk via CancellationModal.tsx.
 */
import type { TFunction } from 'i18next';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/helpers';
import type { CancellationReason } from '@/types/cancellation';

interface ReasonPicklistStepProps {
  onSubmit: (reason: CancellationReason, reason_other_text?: string) => void;
  onKeep: () => void;
}

const REASON_VALUES: CancellationReason[] = [
  'too_expensive',
  'not_using',
  'found_alternative',
  'health_goals_changed',
  'temporary_break',
  'service_quality_issue',
  'other',
];

function reasonLabel(t: TFunction, value: CancellationReason): string {
  switch (value) {
    case 'too_expensive':
      return t('settings:cancellation.reason.too_expensive');
    case 'not_using':
      return t('settings:cancellation.reason.not_using');
    case 'found_alternative':
      return t('settings:cancellation.reason.found_alternative');
    case 'health_goals_changed':
      return t('settings:cancellation.reason.health_goals_changed');
    case 'temporary_break':
      return t('settings:cancellation.reason.temporary_break');
    case 'service_quality_issue':
      return t('settings:cancellation.reason.service_quality_issue');
    case 'other':
      return t('settings:cancellation.reason.other');
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

const MIN_OTHER_LENGTH = 4;
const MAX_OTHER_LENGTH = 280;
const COUNTER_THRESHOLD = 240;

export function ReasonPicklistStep({ onSubmit, onKeep }: ReasonPicklistStepProps) {
  const { t } = useTranslation('settings');
  const [selected, setSelected] = useState<CancellationReason | null>(null);
  const [otherText, setOtherText] = useState('');

  const isOtherSelected = selected === 'other';
  const otherValid = !isOtherSelected || otherText.trim().length >= MIN_OTHER_LENGTH;

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
          {t('settings:cancellation.step1.title')}
        </h2>
        <p id="cancel-step-body" className="text-[13px] text-[var(--color-text-secondary)] mt-1">
          {t('settings:cancellation.step1.body')}
        </p>
      </div>

      {/* Reason pills */}
      <div
        role="radiogroup"
        aria-label={t('settings:cancellation.step1.radiogroup_label')}
        className="space-y-2"
      >
        {REASON_VALUES.map((value, index) => {
          const isSelected = selected === value;
          const isFirst = index === 0;
          const tabIndex = isSelected || (!selected && isFirst) ? 0 : -1;

          return (
            <div key={value}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={tabIndex}
                onClick={() => setSelected(value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    const next = REASON_VALUES[index + 1];
                    if (next) setSelected(next);
                  } else if (e.key === 'ArrowUp') {
                    const prev = REASON_VALUES[index - 1];
                    if (prev) setSelected(prev);
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
                <span className="font-semibold text-[var(--color-text)]">
                  {reasonLabel(t, value)}
                </span>
              </button>

              {/* "Other" textarea expansion */}
              {value === 'other' && isOtherSelected && (
                <div className="mt-2 space-y-1">
                  <textarea
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value.slice(0, MAX_OTHER_LENGTH))}
                    placeholder={t('settings:cancellation.step1.other_placeholder')}
                    aria-label={t('settings:cancellation.step1.other_aria_label')}
                    aria-required="true"
                    className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-text)] bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
                    rows={3}
                  />
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[12px] text-[var(--color-text-tertiary)]">
                      {t('settings:cancellation.step1.other_read_note')}
                    </p>
                    <div className="flex items-center gap-2">
                      {otherText.trim().length < MIN_OTHER_LENGTH && otherText.length > 0 && (
                        <span className="text-[12px] text-[var(--color-danger)]">
                          {t('settings:cancellation.step1.other_min_length_hint')}
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
          {t('settings:cancellation.keep_account')}
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
          {t('common:action.continue')}
        </button>
      </div>
    </div>
  );
}
