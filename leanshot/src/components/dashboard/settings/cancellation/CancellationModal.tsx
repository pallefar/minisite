/**
 * Phase 40 Plan 40-04 — CancellationModal outer wrapper.
 * Three-step state machine: reason picklist → server-picked offer → loss-summary.
 * ALL sub-components are NON-LAZY imports so Vite emits a single 'cancellation' chunk.
 * App.tsx is the SINGLE WRITER registering this as React.lazy (single-chunk entry point).
 *
 * Accessibility:
 *  - role="dialog" + aria-modal="true" on the inner container
 *  - aria-labelledby="cancel-step-title" + aria-describedby="cancel-step-body"
 *  - ESC closes Step 1 + Step 3; Step 2 shows inline close-confirmation per UI-SPEC
 *  - Step transitions: instant when useReducedMotion() = true
 *
 * Per 40-PATTERNS §9 + RESEARCH §Pitfall 8: NO react-router, NO nested routes.
 */
import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/helpers';
import type { CancellationReason } from '@/types/cancellation';

// Non-lazy imports — keeps all steps in the single 'cancellation' chunk
import { LossSummaryStep } from './steps/LossSummaryStep';
import { OfferStep } from './steps/OfferStep';
import { ReasonPicklistStep } from './steps/ReasonPicklistStep';

interface CancellationModalProps {
  onClose: () => void;
}

type Step = 1 | 2 | 3;

/**
 * Step indicator dot trio. aria-current="step" on active dot.
 */
function StepIndicator({ step }: { step: Step }) {
  return (
    <div
      role="group"
      aria-label="Step {step} of 3"
      className="flex items-center gap-2 mb-4"
    >
      {([1, 2, 3] as const).map((s) => {
        const isActive = s === step;
        const isCompleted = s < step;
        return (
          <span
            key={s}
            aria-current={isActive ? 'step' : undefined}
            className={cn(
              'size-2 rounded-full transition-all',
              isActive || isCompleted
                ? 'bg-[var(--color-primary)]'
                : 'bg-[var(--color-border)]',
              isCompleted &&
                'shadow-[0_0_0_2px_var(--color-primary-soft)] size-3',
            )}
          />
        );
      })}
    </div>
  );
}

export function CancellationModal({ onClose }: CancellationModalProps) {
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState<Step>(1);
  const [reason, setReason] = useState<CancellationReason | null>(null);
  const [reasonOtherText, setReasonOtherText] = useState<string | undefined>(undefined);
  const [step2CloseConfirm, setStep2CloseConfirm] = useState(false);

  // Fire cancellation_started on mount
  useEffect(() => {
    track('cancellation_started', {});
  }, []);

  // Step 2: ESC / backdrop shows inline close-confirmation instead of closing
  // Step 1 + Step 3: ESC / backdrop close normally (handled by Modal dismissible prop)
  const isDismissible = step !== 2;

  const handleModalClose = (): void => {
    if (step === 2) {
      setStep2CloseConfirm(true);
      return;
    }
    track('cancellation_dismissed', { step, reason_picked: reason ?? '' });
    onClose();
  };

  const handleReasonSubmit = (
    selectedReason: CancellationReason,
    otherText?: string,
  ): void => {
    setReason(selectedReason);
    setReasonOtherText(otherText);
    setStep(2);
  };

  const handleKeepFromStep1 = (): void => {
    track('cancellation_dismissed', { step: 1, reason_picked: '' });
    onClose();
  };

  const handleAdvanceToStep3 = (): void => {
    setStep(3);
  };

  const handleKeepFromStep3 = (): void => {
    onClose();
  };

  return (
    <Modal
      open
      onClose={handleModalClose}
      dismissible={isDismissible}
      size="lg"
      hideClose={false}
      title=""
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-step-title"
        aria-describedby="cancel-step-body"
        className="px-1"
      >
        <StepIndicator step={step} />

        {/* Step 2 close-confirmation overlay */}
        {step2CloseConfirm && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface)] rounded-xl z-10 p-6">
            <div className="space-y-4 text-center max-w-xs">
              <p className="text-[16px] font-semibold text-[var(--color-text)]">
                You&apos;ll lose the personalized offer. Continue?
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setStep2CloseConfirm(false);
                    track('cancellation_dismissed', { step: 2, reason_picked: reason ?? '' });
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl text-[14px] font-semibold bg-[var(--color-primary)] text-[var(--color-bg)] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  Yes, close
                </button>
                <button
                  type="button"
                  onClick={() => setStep2CloseConfirm(false)}
                  className="px-4 py-2 rounded-xl text-[14px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  Stay
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step content — instant transitions when reduced motion is enabled */}
        <div
          className={cn(
            'min-h-[200px]',
            !reducedMotion && 'transition-all duration-200',
          )}
        >
          {step === 1 && (
            <ReasonPicklistStep
              onSubmit={handleReasonSubmit}
              onKeep={handleKeepFromStep1}
            />
          )}

          {step === 2 && reason !== null && (
            <OfferStep
              reason={reason}
              reason_other_text={reasonOtherText}
              onAdvance={handleAdvanceToStep3}
            />
          )}

          {step === 3 && reason !== null && (
            <LossSummaryStep
              reason={reason}
              onKeep={handleKeepFromStep3}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
