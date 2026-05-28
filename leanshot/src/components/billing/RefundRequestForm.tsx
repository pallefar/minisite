/**
 * Phase 65 Plan 65-09 — RefundRequestForm (PAY-04 UI half).
 *
 * Settings sub-view at /settings/billing/refund (or rendered inline by
 * SettingsPage as a sub-route per project no-router convention). 3 visual
 * states:
 *   - loading       — eligibility probe in flight on mount (skeleton)
 *   - form          — eligible: textarea + Request refund CTA + Keep CTA
 *                     ineligible: friendly message + support email link
 *   - submitted     — success: "Your refund of $X has been processed."
 *
 * Destructive guard: clicking "Request refund" opens a confirmation modal
 * with verbatim UI-SPEC §3 copy. Modal confirm fires the actual POST. Modal
 * cancel reads "Keep my subscription" (NOT generic "Cancel"), per UI-SPEC.
 *
 * Patterns:
 *   D — Tokens only; --color-text / --color-text-secondary / --color-surface.
 *   Typography ceiling: 11 / 13 / 18 / heading + 400 / 600 weights only.
 *   Spacing: standard 1 / 2 / 3 / 4 / 6 / 8 / 12 scale.
 *   A11y: textarea aria-describedby links to char counter; Modal primitive
 *   provides role=dialog aria-modal=true.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import {
  checkRefundEligibility,
  requestRefund,
  type RefundEligibility,
  type RefundResult,
} from '@/lib/billing/refund-client';

const MAX_REASON_CHARS = 2000;
const SUPPORT_EMAIL = 'billing-support@leanshot.app';

const formatCents = (cents: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);

export interface RefundRequestFormProps {
  onClose?: () => void;
}

type ViewState = 'loading' | 'form' | 'submitted';

export function RefundRequestForm({ onClose }: RefundRequestFormProps) {
  const [view, setView] = useState<ViewState>('loading');
  const [eligibility, setEligibility] = useState<RefundEligibility | null>(null);
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RefundResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const e = await checkRefundEligibility();
      if (cancelled) return;
      setEligibility(e);
      setView('form');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const charCount = reason.length;
  const formattedAmount = useMemo(
    () =>
      result && result.ok
        ? formatCents(result.amount_cents)
        : eligibility?.amount_cents !== undefined
          ? formatCents(eligibility.amount_cents)
          : '$0.00',
    [result, eligibility],
  );

  const handleConfirmSubmit = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await requestRefund(reason);
      setResult(res);
      if (res.ok) {
        setView('submitted');
      }
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  // ─── LOADING SKELETON ────────────────────────────────────────────────────
  if (view === 'loading') {
    return (
      <Card className="p-6">
        <div className="flex flex-col gap-3 animate-pulse">
          <div className="h-4 w-1/2 bg-[var(--color-skeleton)] rounded" />
          <div className="h-3 w-3/4 bg-[var(--color-skeleton)] rounded" />
          <div className="h-24 w-full bg-[var(--color-skeleton)] rounded" />
        </div>
      </Card>
    );
  }

  // ─── SUCCESS STATE ───────────────────────────────────────────────────────
  if (view === 'submitted' && result?.ok) {
    return (
      <Card className="p-6 flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Refund submitted</h2>
        <p className="text-[13px] font-normal text-[var(--color-text)]">
          Your refund of {formattedAmount} has been processed. Allow 5-10 business days for funds to
          appear.
        </p>
        {onClose && (
          <div>
            <Button variant="tonal" onClick={onClose}>
              Back to billing
            </Button>
          </div>
        )}
      </Card>
    );
  }

  // ─── INELIGIBLE STATE ────────────────────────────────────────────────────
  if (eligibility && !eligibility.eligible) {
    return (
      <Card className="p-6 flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Refund not available</h2>
        <p className="text-[13px] font-normal text-[var(--color-text-secondary)]">
          Your subscription is outside the 14-day refund window. For help with your account, contact
          our billing team at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--color-primary)] underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        {onClose && (
          <div>
            <Button variant="tonal" onClick={onClose}>
              Back to billing
            </Button>
          </div>
        )}
      </Card>
    );
  }

  // ─── ERROR (AFTER SUBMIT) ────────────────────────────────────────────────
  const errorBanner = result && !result.ok && (
    <div
      role="status"
      aria-live="polite"
      className="text-[13px] font-normal text-[var(--color-danger)] bg-[var(--color-danger-soft)] rounded-lg px-3 py-2"
    >
      {result.error === 'refund_already_processed' ? (
        <>Already refunded — see your receipt history for the prior refund.</>
      ) : (
        <>
          We couldn&apos;t process your refund. Contact{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--color-primary)] underline">
            {SUPPORT_EMAIL}
          </a>{' '}
          and we&apos;ll handle it manually.
        </>
      )}
    </div>
  );

  // ─── FORM (eligible) ─────────────────────────────────────────────────────
  return (
    <>
      <Card className="p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)]">Request a refund</h2>
          <p className="text-[13px] font-normal text-[var(--color-text-secondary)]">
            Your subscription is eligible for refund — submitted within the 14-day window.
          </p>
        </div>

        {errorBanner}

        <div className="flex flex-col gap-2">
          <label
            htmlFor="refund-reason"
            className="text-[13px] font-semibold text-[var(--color-text)]"
          >
            Tell us why (optional)
          </label>
          <textarea
            id="refund-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON_CHARS))}
            maxLength={MAX_REASON_CHARS}
            rows={4}
            aria-describedby="refund-reason-counter"
            className="w-full text-[13px] font-normal rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            placeholder="Optional — helps us improve the product"
          />
          <span
            id="refund-reason-counter"
            className="text-[11px] font-normal text-[var(--color-text-tertiary)] self-end"
          >
            {charCount} / {MAX_REASON_CHARS}
          </span>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          {onClose && (
            <Button variant="tonal" onClick={onClose}>
              Keep my subscription
            </Button>
          )}
          <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={submitting}>
            Request refund
          </Button>
        </div>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm refund"
        size="sm"
      >
        <div className="flex flex-col gap-4 p-6">
          <p className="text-[13px] font-normal text-[var(--color-text)]">
            Request a refund? Your subscription will be cancelled immediately and a credit will be
            issued to your original payment method within 5-10 business days.
          </p>
          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
            <Button variant="tonal" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Keep my subscription
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmSubmit();
              }}
              loading={submitting}
              disabled={submitting}
            >
              Request refund
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
