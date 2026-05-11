import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export interface DisclaimerBodyProps {
  onAcknowledge: () => void;
}

/**
 * Disclaimer copy + primary button, suitable for inline use inside OnboardingFlow's
 * step card chrome (no Modal wrapper). Used by Step 0 of OnboardingFlow.
 *
 * Copy floor per CONTEXT D-12; phrasing is Phase 2 v1 (Phase 7 legal review owns final).
 */
export function DisclaimerBody({ onAcknowledge }: DisclaimerBodyProps) {
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-[var(--color-text)] leading-relaxed">
        <strong>Not medical advice.</strong> LeanShot helps you track GLP-1 medications, body
        metrics, food, activity, and symptoms. The drug-level chart shows a modeled estimate based
        on population pharmacokinetics — not a measured serum level. Always consult your healthcare
        provider for clinical decisions.
      </p>
      <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
        Your data stays on this device unless you choose to sync. We do not share your health data
        with third parties.
      </p>
      <Button block onClick={onAcknowledge}>
        I understand
      </Button>
    </div>
  );
}

export interface DisclaimerModalProps {
  open: boolean;
  onAcknowledge: () => void;
}

/**
 * Blocking medical disclaimer modal. Used by App.tsx as the dashboard-render
 * fallback when `user && acknowledgedDisclaimer !== 'v1'` (D-11).
 *
 * Composes <Modal> with `dismissible={false}` + `hideClose` so the ONLY exit
 * is the explicit "I understand" button (D-09 — no decline path).
 */
export function DisclaimerModal({ open, onAcknowledge }: DisclaimerModalProps) {
  return (
    <Modal
      open={open}
      onClose={() => {
        /* no-op: D-09 forbids decline / dismiss paths */
      }}
      title="Before you start"
      size="md"
      hideClose
      dismissible={false}
    >
      <DisclaimerBody onAcknowledge={onAcknowledge} />
    </Modal>
  );
}
