/**
 * Phase 22 Plan 22-07 — CancelSubModal (ADMIN-04).
 *
 * Cancels a Stripe subscription at period end via the `admin-stripe-action`
 * Edge Function (Plan 22-03). Cancellation is non-destructive (Stripe sets
 * `cancel_at_period_end=true`); the user keeps access until `period_end`.
 *
 * Copy per UI-SPEC §Copywriting line 688:
 *   "Cancel {email}'s subscription? They'll keep access until {period_end}."
 *
 * Uses Modal directly (instead of ConfirmModal primitive) so we can render
 * a custom busy state + inline error on Stripe failure.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { AdminStripeError, cancelSubscription } from '@/lib/admin/admin-stripe-actions';

export interface CancelSubModalProps {
  isOpen: boolean;
  targetUserId: string;
  targetUserEmail: string;
  subscriptionId: string;
  /** ISO date or YYYY-MM-DD — when Stripe will actually cancel. */
  periodEnd: string;
  onClose: () => void;
  onSuccess: () => void;
}

function formatPeriodEnd(periodEnd: string): string {
  try {
    const d = new Date(periodEnd);
    if (Number.isNaN(d.getTime())) return periodEnd;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return periodEnd;
  }
}

export function CancelSubModal({
  isOpen,
  targetUserId,
  targetUserEmail,
  subscriptionId,
  periodEnd,
  onClose,
  onSuccess,
}: CancelSubModalProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const close = (): void => {
    if (busy) return;
    setInlineError(null);
    onClose();
  };

  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    setInlineError(null);
    try {
      await cancelSubscription({ targetUserId, subscriptionId });
      toast(`Subscription canceled for ${targetUserEmail}`, 'success');
      onSuccess();
      onClose();
    } catch (e) {
      if (e instanceof AdminStripeError && e.code === 'stripe') {
        setInlineError(
          `Stripe rejected the cancellation: ${e.stripeCode ?? 'unknown_error'}. Try again or contact support.`,
        );
      } else if (e instanceof AdminStripeError && e.code === 'forbidden') {
        setInlineError('You do not have permission to cancel subscriptions.');
      } else {
        setInlineError('Could not cancel the subscription. Try again or contact support.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={close} title="Cancel subscription" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          Cancel {targetUserEmail}&apos;s subscription? They&apos;ll keep access until{' '}
          {formatPeriodEnd(periodEnd)}.
        </p>
        {inlineError && (
          <p role="alert" className="text-sm text-[var(--color-danger)] leading-relaxed">
            {inlineError}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Keep subscription
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            disabled={busy}
            onClick={() => {
              void handleConfirm();
            }}
          >
            Cancel subscription
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default CancelSubModal;
