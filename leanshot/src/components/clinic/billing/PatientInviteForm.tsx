/**
 * Phase 29 Plan 06 — PatientInviteForm
 *
 * Inline form for clinic admins to send patient consent invites. Calls
 * sendPatientInvite from src/lib/clinic-patient-invite.ts (Plan 29-05).
 *
 * Anti-enumeration (W-1): shows identical "Invite sent" toast regardless of
 * whether the email maps to an existing user — matches Edge Fn W-1 invariant.
 *
 * Consent scope (Plan 29-06 MVP): single checkbox "Read patient activity data"
 * → `scope = {read_activity: true}`. Full multi-scope UI deferred to v1.4.
 *
 * Bundle constraint (CLAUDE.md): lazy-loaded via ClinicBillingCard. Do NOT
 * import this component eagerly.
 */

import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { FieldShell } from '@/components/ui/Input';
import { sendPatientInvite } from '@/lib/clinic-patient-invite';
import { useStore } from '@/lib/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PatientInviteFormProps {
  /** UUID of the organization sending the invite. */
  orgId: string;
  /** Optional slug for display context. */
  orgSlug?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PatientInviteForm({ orgId }: PatientInviteFormProps) {
  const showToast = useStore((s) => s.showToast);

  const [email, setEmail] = useState('');
  const [readActivity, setReadActivity] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const emailId = useId();
  const checkboxId = useId();

  function validate(): boolean {
    if (!email.trim()) {
      setEmailError('Email is required.');
      return false;
    }
    // Basic RFC 5322-ish sanity check.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Enter a valid email address.');
      return false;
    }
    setEmailError(null);
    return true;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!validate()) return;
    if (submitting) return;

    setSubmitting(true);
    try {
      const scope: Record<string, unknown> = {
        read_activity: readActivity,
      };

      const result = await sendPatientInvite(orgId, email.trim(), scope);

      // W-1 invariant: show identical "Invite sent" toast regardless of result.
      // This prevents clinic admins from inferring whether the email exists in
      // auth.users (anti-enumeration).
      if (result.ok || result.error === 'duplicate_pending_invite') {
        showToast('Invite sent.', 'success');
        setEmail('');
        setReadActivity(false);
      } else if (result.error === 'unauthenticated') {
        showToast('Your session expired. Please sign in again.', 'error');
      } else {
        // Any other error: generic message (W-1 discipline — do not echo
        // server error codes that might reveal patient existence).
        showToast('Could not send invite. Try again.', 'error');
      }
    } catch {
      showToast('Network error. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card variant="elevated" span={8} className="mt-4">
      <CardHeader title="Invite patient" />
      <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
        {/* Email field */}
        <FieldShell
          label="Patient email"
          htmlFor={emailId}
          error={emailError ?? undefined}
          required
        >
          <input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="patient@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
            }}
            aria-invalid={emailError !== null}
            aria-describedby={emailError ? `${emailId}-error` : undefined}
            disabled={submitting}
            className="flex-1 min-w-0 bg-transparent py-2.5 px-3 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none"
          />
        </FieldShell>

        {/* Consent scope (Plan 29-06 MVP: single checkbox) */}
        <div className="flex items-start gap-3">
          <input
            id={checkboxId}
            type="checkbox"
            checked={readActivity}
            onChange={(e) => setReadActivity(e.target.checked)}
            disabled={submitting}
            className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] accent-[var(--color-primary)]"
            aria-label="Grant read access to patient activity data"
          />
          <label
            htmlFor={checkboxId}
            className="text-[13px] text-[var(--color-text)] leading-snug cursor-pointer select-none"
          >
            Read patient activity data
            <span className="ms-1 text-[var(--color-text-secondary)]">
              (injections, weights, meals, mood, sleep)
            </span>
          </label>
        </div>

        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          disabled={submitting}
          aria-busy={submitting}
        >
          Send invite
        </Button>
      </form>
    </Card>
  );
}
