/**
 * Phase 22 Plan 22-07 — RefundModal (ADMIN-04).
 *
 * 3-step gated refund flow per UI-SPEC §Refund modal (lines 370-388):
 *
 *   Step 1: Pick charge        — select from last-90d Stripe charges; Continue
 *                                disabled until selection.
 *   Step 2: Enter amount       — amount input (max=charge.amount, dollars), Pill
 *                                quick-fill (Full / Half / Custom), reason input
 *                                (optional, 200 chars max). Continue disabled if
 *                                amount empty or > charge.amount.
 *   Step 3: Confirm            — summary "You are about to refund $X to {email}"
 *                                + typed-confirm Input "Type REFUND $X.XX". Submit
 *                                enabled ONLY on exact-match case-sensitive.
 *
 * On Submit:
 *   - invokes `refundCharge({targetUserId, chargeId, amountCents, reason})`
 *     wrapping the `admin-stripe-action` Edge Fn (Plan 22-03).
 *   - on success: toast "Refund of $X issued to {email}", modal closes.
 *   - on AdminStripeError(code='stripe'): inline error per UI-SPEC line 680
 *     "Stripe rejected the refund: {message}. Try again or contact support."
 *
 * Accessibility:
 *   - step heading aria-live="polite" so step transitions announce.
 *   - typed-confirm Input has explicit label so screen-readers narrate the
 *     required match string.
 *   - Esc on step ≥ 2 prompts before close (UI-SPEC line 388) — implemented
 *     here as a confirm-prompt window guard via dismissible=true + onClose.
 */
import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pill, PillGroup } from '@/components/ui/Pill';
import { useToast } from '@/hooks/useToast';
import {
  AdminStripeError,
  refundCharge,
  typedConfirmMatchesRefund,
} from '@/lib/admin/admin-stripe-actions';

export interface RefundCharge {
  id: string;
  /** Amount in cents (Stripe convention). */
  amount: number;
  /** Stripe `created` unix timestamp (seconds). */
  created: number;
  descriptor: string;
}

export interface RefundModalProps {
  isOpen: boolean;
  charges: RefundCharge[];
  targetUserId: string;
  targetUserEmail: string;
  onClose: () => void;
  onSuccess: (refundId: string | null) => void;
}

type Step = 1 | 2 | 3;
type PillKey = 'full' | 'half' | 'custom';

function formatChargeOption(c: RefundCharge): string {
  const dollars = (c.amount / 100).toFixed(2);
  const d = new Date(c.created * 1000);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date} — $${dollars} ${c.descriptor}`;
}

export function RefundModal({
  isOpen,
  charges,
  targetUserId,
  targetUserEmail,
  onClose,
  onSuccess,
}: RefundModalProps) {
  const toast = useToast();
  const [step, setStep] = useState<Step>(1);
  const [chargeId, setChargeId] = useState<string>('');
  const [amountDollars, setAmountDollars] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [pill, setPill] = useState<PillKey>('full');
  const [typed, setTyped] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const charge = useMemo(
    () => charges.find((c) => c.id === chargeId) ?? null,
    [charges, chargeId],
  );

  const amountCents = useMemo(() => {
    const n = Number.parseFloat(amountDollars);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }, [amountDollars]);

  const amountValid = charge !== null && amountCents > 0 && amountCents <= charge.amount;

  const expectedTyped = useMemo(
    () => (amountCents > 0 ? `REFUND $${(amountCents / 100).toFixed(2)}` : ''),
    [amountCents],
  );
  const typedOk = typedConfirmMatchesRefund(typed, amountCents);

  const reset = (): void => {
    setStep(1);
    setChargeId('');
    setAmountDollars('');
    setReason('');
    setPill('full');
    setTyped('');
    setInlineError(null);
  };

  const close = (): void => {
    if (busy) return;
    // UI-SPEC line 388: confirm before closing on step ≥ 2. Modal's dismissible
    // path triggers this when the user hits Esc or clicks the backdrop.
    if (step >= 2) {
      const ok = window.confirm('Discard this refund?');
      if (!ok) return;
    }
    reset();
    onClose();
  };

  const goNext = (): void => {
    if (step === 1 && chargeId) {
      // Initialize amount to charge full on first entry to step 2.
      if (!amountDollars && charge) {
        setAmountDollars((charge.amount / 100).toFixed(2));
        setPill('full');
      }
      setStep(2);
      return;
    }
    if (step === 2 && amountValid) {
      setTyped('');
      setStep(3);
    }
  };

  const goBack = (): void => {
    if (step === 2) setStep(1);
    if (step === 3) setStep(2);
  };

  const onPickPill = (key: PillKey): void => {
    setPill(key);
    if (!charge) return;
    if (key === 'full') setAmountDollars((charge.amount / 100).toFixed(2));
    if (key === 'half') setAmountDollars((charge.amount / 200).toFixed(2));
    if (key === 'custom') setAmountDollars('');
  };

  const handleSubmit = async (): Promise<void> => {
    if (!charge || !typedOk || busy) return;
    setBusy(true);
    setInlineError(null);
    try {
      const result = await refundCharge({
        targetUserId,
        chargeId: charge.id,
        amountCents,
        reason: reason.trim() || undefined,
      });
      toast(
        `Refund of $${(amountCents / 100).toFixed(2)} issued to ${targetUserEmail}`,
        'success',
      );
      onSuccess(result.refundId);
      reset();
      onClose();
    } catch (e) {
      if (e instanceof AdminStripeError && e.code === 'stripe') {
        setInlineError(
          `Stripe rejected the refund: ${e.stripeCode ?? 'unknown_error'}. Try again or contact support.`,
        );
      } else if (e instanceof AdminStripeError && e.code === 'forbidden') {
        setInlineError('You do not have permission to issue refunds.');
      } else {
        setInlineError('Could not issue the refund. Try again or contact support.');
      }
    } finally {
      setBusy(false);
    }
  };

  const stepTitle = step === 1 ? 'Pick a charge' : step === 2 ? 'Refund amount' : 'Confirm refund';

  return (
    <Modal open={isOpen} onClose={close} title="Issue refund" size="md">
      <div className="space-y-4">
        <p
          aria-live="polite"
          className="text-xs uppercase tracking-[0.06em] text-[var(--color-text-secondary)] font-semibold"
        >
          Step {step} of 3 — {stepTitle}
        </p>

        {step === 1 && (
          <>
            <Select
              label="Pick a charge"
              value={chargeId}
              onChange={(e) => setChargeId(e.target.value)}
            >
              <option value="">Select a recent charge…</option>
              {charges.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatChargeOption(c)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Showing the user&apos;s last 90 days of charges.
            </p>
          </>
        )}

        {step === 2 && charge && (
          <>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Refunding charge <span className="font-mono text-xs">{charge.id}</span> —
              original amount ${(charge.amount / 100).toFixed(2)}.
            </p>
            <PillGroup segmented aria-label="Refund amount preset">
              <Pill size="sm" active={pill === 'full'} onClick={() => onPickPill('full')}>
                Full
              </Pill>
              <Pill size="sm" active={pill === 'half'} onClick={() => onPickPill('half')}>
                Half
              </Pill>
              <Pill size="sm" active={pill === 'custom'} onClick={() => onPickPill('custom')}>
                Custom
              </Pill>
            </PillGroup>
            <Input
              label="Refund amount (USD)"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max={(charge.amount / 100).toFixed(2)}
              value={amountDollars}
              onChange={(e) => {
                setPill('custom');
                setAmountDollars(e.target.value);
              }}
              error={
                amountDollars && !amountValid
                  ? `Amount must be between $0.01 and $${(charge.amount / 100).toFixed(2)}`
                  : undefined
              }
            />
            <Input
              label="Reason (optional)"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate charge"
            />
          </>
        )}

        {step === 3 && charge && (
          <>
            <p className="text-sm text-[var(--color-text)] leading-relaxed">
              You are about to refund{' '}
              <strong>${(amountCents / 100).toFixed(2)}</strong> to{' '}
              <strong>{targetUserEmail}</strong>.
            </p>
            <Input
              label={`Type ${expectedTyped} to confirm`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              placeholder={expectedTyped}
              disabled={busy}
            />
            {inlineError && (
              <p
                role="alert"
                className="text-sm text-[var(--color-danger)] leading-relaxed"
              >
                {inlineError}
              </p>
            )}
          </>
        )}

        <div className="flex gap-2 justify-between pt-2">
          <div>
            {step > 1 && (
              <Button variant="ghost" onClick={goBack} disabled={busy}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            {step < 3 ? (
              <Button
                variant="primary"
                onClick={goNext}
                disabled={(step === 1 && !chargeId) || (step === 2 && !amountValid)}
              >
                Continue
              </Button>
            ) : (
              <Button
                variant="destructive"
                leadingIcon={<Trash2 className="size-4" />}
                disabled={!typedOk || busy}
                loading={busy}
                onClick={() => {
                  void handleSubmit();
                }}
              >
                Issue refund
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default RefundModal;
