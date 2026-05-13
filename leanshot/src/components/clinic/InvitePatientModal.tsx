/**
 * Phase 9 Plan 09-02 — InvitePatientModal.
 *
 * D-02 (anti-enumeration) UI-layer invariant: the post-send state shows
 * the SAME copy regardless of whether the email matched an existing
 * `auth.users` row server-side. The wrapper (`sendInvite`) returns a
 * server-generated `invite_id` UUID in BOTH branches (W-1) so this UI
 * can never branch on email existence.
 *
 * Scope-preselect (D-04): 10 boolean checkboxes mapped from
 * `DATA_TYPE_KEYS`, all defaulted ON. The patient sees these as
 * suggestions and can uncheck any before accepting in Plan 09-05's
 * ConsentDialog.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { sendInvite } from '@/lib/clinic';
import {
  DATA_TYPE_KEYS,
  DATA_TYPE_LABELS,
  type ConsentScope,
  type DataTypeKey,
} from '@/types/clinic';

export interface InvitePatientModalProps {
  open: boolean;
  orgId: string;
  onClose: () => void;
  /** Optional: parent receives the freshly-generated invite_id for pending-invites list. */
  onInviteSent?: (invite_id: string) => void;
}

// Canonical default scope — all 10 keys ON. Build from DATA_TYPE_KEYS so
// the type system catches drift (planner iter-1 anti-pattern 4).
function makeDefaultScope(): ConsentScope {
  const out = {} as ConsentScope;
  for (const k of DATA_TYPE_KEYS) {
    out[k] = true;
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitePatientModal({
  open,
  orgId,
  onClose,
  onInviteSent,
}: InvitePatientModalProps) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [scope, setScope] = useState<ConsentScope>(() => makeDefaultScope());
  const [submitting, setSubmitting] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const toast = useToast();

  // Auto-focus email on open (Test 16).
  useEffect(() => {
    if (open && emailRef.current && !sentEmail) {
      emailRef.current.focus();
    }
  }, [open, sentEmail]);

  // Reset state when modal closes (so re-opening is clean).
  useEffect(() => {
    if (!open) {
      setEmail('');
      setEmailError(null);
      setScope(makeDefaultScope());
      setSubmitting(false);
      setSentEmail(null);
    }
  }, [open]);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = emailValid && !submitting;

  function toggleScope(k: DataTypeKey): void {
    setScope((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!emailValid) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setEmailError(null);
    const trimmed = email.trim().toLowerCase();
    const r = await sendInvite({
      org_id: orgId,
      email: trimmed,
      requested_scope: scope,
    });
    setSubmitting(false);
    if (!r.ok) {
      // Network/server error: keep form state, toast, modal stays open.
      toast("Couldn't send invitation. Check your connection and try again.", 'error');
      return;
    }
    // SUCCESS — D-02 invariant: universal post-send copy, no email-existence
    // branching. W-1: invite_id is server-generated regardless.
    onInviteSent?.(r.data.invite_id);
    setSentEmail(trimmed);
  }

  function handleInviteAnother(): void {
    setEmail('');
    setEmailError(null);
    setScope(makeDefaultScope());
    setSentEmail(null);
  }

  // ---- Post-send state (D-02 anti-enumeration) -------------------------
  if (sentEmail) {
    return (
      <Modal open={open} onClose={onClose} title="Invite a patient" size="lg" mobileFullscreen>
        <div className="space-y-5" data-testid="invite-sent-state">
          <h3
            id={headingId}
            className="text-[20px] font-bold text-[var(--color-text)]"
          >
            Invitation sent
          </h3>
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
            We sent an invitation to {sentEmail}. They&apos;ll appear in Members → Pending once
            they accept. The invitation expires in 7 days.
          </p>
          <div className="flex flex-col-reverse md:flex-row gap-2 md:justify-end pt-3">
            <Button variant="ghost" onClick={handleInviteAnother}>
              Invite another patient
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---- Compose state --------------------------------------------------
  return (
    <Modal open={open} onClose={onClose} title="Invite a patient" size="lg" mobileFullscreen>
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug">
          Send a private invitation by email. The patient chooses what to share with your
          workspace.
        </p>

        <Input
          ref={emailRef}
          label="Patient email"
          type="email"
          placeholder="patient@example.com"
          hint="We'll send them a private invitation that expires in 7 days."
          error={emailError ?? undefined}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(null);
          }}
          autoComplete="off"
          required
        />

        <fieldset className="space-y-3">
          <legend className="text-[14px] font-semibold text-[var(--color-text)]">
            What would you like access to?
          </legend>
          <p className="text-[12px] text-[var(--color-text-secondary)] leading-snug">
            Pre-check what your workspace typically needs. The patient sees these as suggestions
            and can change them before accepting.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {DATA_TYPE_KEYS.map((k) => {
              const meta = DATA_TYPE_LABELS[k];
              const checkboxId = `invite-scope-${k}`;
              return (
                <label
                  key={k}
                  htmlFor={checkboxId}
                  className="flex items-start gap-2.5 p-2.5 rounded-xl border border-[var(--color-border)] hover:border-[var(--color-primary)] transition-colors cursor-pointer"
                >
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={scope[k]}
                    onChange={() => toggleScope(k)}
                    className="mt-0.5 size-4 accent-[var(--color-primary)]"
                    aria-label={meta.label}
                    aria-describedby={`${checkboxId}-desc`}
                  />
                  <span className="flex-1">
                    <span className="block text-[13px] font-semibold text-[var(--color-text)]">
                      {meta.label}
                    </span>
                    <span
                      id={`${checkboxId}-desc`}
                      className="block text-[11px] text-[var(--color-text-tertiary)] leading-snug"
                    >
                      {meta.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-col-reverse md:flex-row gap-2 md:justify-end pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit} loading={submitting}>
            Send invitation
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default InvitePatientModal;
