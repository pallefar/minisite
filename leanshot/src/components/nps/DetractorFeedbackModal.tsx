/**
 * Phase 36 Plan 36-03 Task 2 — DetractorFeedbackModal (Surface C).
 *
 * Non-promoter (1-3 star) open-text feedback modal. Submit creates a support
 * ticket via the Wave 2 Edge Fn `nps-feedback-submit` (server-side derives
 * user from JWT — body never names a user_id, T-36-16).
 *
 * UX states:
 *   - 'form'    — initial; textarea + Submit/Skip.
 *   - 'success' — Check + Thanks copy + auto-dismiss 3000ms.
 *   - 'error'   — error pill below textarea; Submit re-enabled for retry.
 *
 * Submit disabled when value.trim().length < 10; "At least a sentence helps"
 * hint visible at --color-text-tertiary while disabled.
 *
 * V13-3 (CONTEXT D-03/D-21) — see useNPSPromptListener.ts for the
 * unconditional native-review wiring; this consumer modal never imports the
 * native trigger hook nor the native shim.
 *
 * Server validates length 10..4000 (Wave 2); the client soft-validates the
 * minimum to keep the submit affordance honest.
 */
import { Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { submitNpsFeedback } from '@/lib/nps/decide-client';

const MIN_LENGTH = 10;
const SUCCESS_AUTO_DISMISS_MS = 3000;

type ViewState = 'form' | 'success' | 'error';

export interface DetractorFeedbackModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function DetractorFeedbackModal({
  open,
  onDismiss,
}: DetractorFeedbackModalProps) {
  const [value, setValue] = useState('');
  const [view, setView] = useState<ViewState>('form');
  const [loading, setLoading] = useState(false);

  const trimmed = value.trim();
  const canSubmit = trimmed.length >= MIN_LENGTH;

  // Auto-dismiss the success state after 3s. The state machine guarantees
  // setView('success') only fires inside handleSubmit success branch.
  useEffect(() => {
    if (view !== 'success' || !open) return;
    const t = window.setTimeout(onDismiss, SUCCESS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [view, open, onDismiss]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      await submitNpsFeedback(trimmed);
      setView('success');
    } catch {
      setView('error');
    } finally {
      setLoading(false);
    }
  }, [canSubmit, loading, trimmed]);

  return (
    <Modal
      open={open}
      onClose={onDismiss}
      size="md"
      dismissible
      mobileFullscreen
      title="What could we do better?"
    >
      {view === 'success' ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <Check
            size={32}
            className="text-[var(--color-success)]"
            aria-hidden
          />
          <h2 className="text-2xl font-display">Thanks — we&apos;ll be in touch</h2>
          <p className="text-base text-[var(--color-text-secondary)] text-center">
            We&apos;ve created a support ticket. You&apos;ll hear from us within 24 hours.
          </p>
          <Button variant="primary" onClick={onDismiss}>
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base text-[var(--color-text-secondary)]">
            Your reply goes straight to our team. We read every one.
          </p>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={loading}
            rows={5}
            placeholder="Tell us what's frustrating, what's missing, or what didn't work."
            className="w-full rounded-card border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          {!canSubmit && (
            <p className="text-[13px] text-[var(--color-text-tertiary)]">
              At least a sentence helps
            </p>
          )}
          {view === 'error' && (
            <p
              role="alert"
              className="rounded-pill bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-[13px] px-3 py-2"
            >
              Couldn&apos;t send. Tap Send feedback to try again.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onDismiss} disabled={loading}>
              Skip
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!canSubmit || loading}
              aria-busy={loading || undefined}
              leadingIcon={loading ? <Spinner size="sm" /> : undefined}
            >
              Send feedback
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default DetractorFeedbackModal;
