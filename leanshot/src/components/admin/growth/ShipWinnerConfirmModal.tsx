/**
 * Phase 39 Plan 39-07 — ShipWinnerConfirmModal (D-12).
 *
 * Typed-confirmation modal opened by PaywallExperimentTab / PageExperimentTab
 * when an operator clicks Ship-Winner on a variant whose posterior is < 0.95.
 *
 * Contract:
 *   - Confirm button enabled ONLY when typedValue === "ship-below-95" (exact
 *     match — no whitespace tolerance) AND reason.trim().length > 0.
 *   - onConfirm receives the reason string.
 *   - The Modal primitive supplies role="dialog" + aria-modal="true".
 *   - The typed-confirmation input has aria-describedby pointing at the
 *     explanatory body paragraph (UI-SPEC accessibility table).
 *
 * Audit-trail wiring lives in the parent tab component: the parent's onConfirm
 * handler calls public.admin_ship_below_95 RPC (writes admin_audit_log row)
 * AND THEN invokes the ship-winner-flag Edge Fn. Splitting responsibilities
 * keeps the modal pure-presentational (testable without supabase mocks).
 */
import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

export interface ShipWinnerConfirmModalProps {
  open: boolean;
  variantId: string;
  variantName: string;
  /** Bayesian posterior 0..1; shown verbatim as a percent in the body copy. */
  posterior: number;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}

export function ShipWinnerConfirmModal({
  open,
  variantName: _variantName,
  posterior,
  onConfirm,
  onClose,
}: ShipWinnerConfirmModalProps): React.JSX.Element {
  const [typedValue, setTypedValue] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bodyId = useId();

  const enabled = typedValue === 'ship-below-95' && reason.trim().length > 0 && !submitting;

  async function handleConfirm(): Promise<void> {
    if (!enabled) return;
    setSubmitting(true);
    try {
      await onConfirm(reason);
    } finally {
      setSubmitting(false);
    }
  }

  const pct = Math.round(posterior * 100);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ship variant below 95% confidence?"
      size="md"
      hideClose
    >
      <div className="flex flex-col gap-4">
        <p id={bodyId} className="text-base text-[var(--color-text)]">
          This variant&rsquo;s Bayesian posterior is {pct}%. Shipping below 95% requires a logged
          reason.
        </p>

        <Input
          label="Type ship-below-95 to confirm"
          placeholder="ship-below-95"
          value={typedValue}
          onChange={(e) => setTypedValue(e.target.value)}
          aria-describedby={bodyId}
          autoComplete="off"
          spellCheck={false}
        />

        <Textarea
          label="Reason (logged to audit)"
          placeholder="e.g. retention-segment data already validates the variant"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!enabled}
            loading={submitting}
            onClick={() => void handleConfirm()}
          >
            Ship variant
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default ShipWinnerConfirmModal;
