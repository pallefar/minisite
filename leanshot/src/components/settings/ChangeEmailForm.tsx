/**
 * Phase 66 Plan 66-04 — Change-email form with AAL2 step-up gate.
 *
 * A minimal stub change-email form (per planner Task 2 — "if no such
 * form exists yet, create a minimal stub one that calls
 * supabase.auth.updateUser({ email })"). The existing in-app callsite
 * is `<ChangeEmailRow>` (inline in `src/components/dashboard/settings/
 * SettingsPage.tsx`), but it's not exported as a reusable surface and
 * doesn't compose with the Phase 66 step-up gate. This component is
 * the canonical AAL2-gated entry point for future settings surfaces
 * that need a standalone "change email" affordance.
 *
 * Behaviour:
 *   1. User enters new email + clicks "Send confirmation".
 *   2. We call `requireAal2ForConsumerAction(supabase, 'change-email',
 *      { onChallenge })`.
 *   3. On `ok: true` (or `mfa_not_enabled` per D-02) → run
 *      `supabase.auth.updateUser({ email })`. Supabase sends the
 *      confirmation link to the NEW address; the change is not
 *      effective until the user clicks the link.
 *   4. On `ok: false` for any non-`mfa_not_enabled` reason → surface a
 *      toast + do NOT call updateUser.
 *
 * Reuses Phase 5 logic via `supabase.auth.updateUser({ email })`
 * directly (the inline ChangeEmailRow uses `attachEmailToAnon` which is
 * a thin wrapper around the same call; we use the canonical API here
 * to keep the dependency surface narrow).
 */
import { useState } from 'react';
import {
  Aal2ChallengeModal,
  type Aal2ChallengeModalPurpose,
} from '@/components/auth/Aal2ChallengeModal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import {
  requireAal2ForConsumerAction,
  type Aal2ChallengeOutcome,
} from '@/lib/auth/aal2-consumer';
import { listEnrolledFactors, verifyTotpChallenge } from '@/lib/auth/totp-shared';
import { supabase } from '@/lib/supabase';

interface PendingChallenge {
  purpose: Aal2ChallengeModalPurpose;
  resolve: (outcome: Aal2ChallengeOutcome) => void;
}

export interface ChangeEmailFormProps {
  /**
   * Current email — shown as placeholder so the user can see which
   * address they're replacing. Optional; falls back to a generic
   * placeholder.
   */
  currentEmail?: string;
  /**
   * Called after a successful confirmation-email send so the parent
   * surface can hide the form (or refresh adjacent UI).
   */
  onSent?: (newEmail: string) => void;
}

export function ChangeEmailForm({ currentEmail, onSent }: ChangeEmailFormProps) {
  const toast = useToast();
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChallenge | null>(null);

  const handleSubmit = async (): Promise<void> => {
    const trimmed = next.trim();
    if (!trimmed) {
      setError('Email is required');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const gate = await requireAal2ForConsumerAction(
        supabase,
        'change-email',
        {
          onChallenge: () =>
            new Promise<Aal2ChallengeOutcome>((resolve) => {
              setPending({ purpose: 'change-email', resolve });
            }),
        },
      );

      setPending(null);

      // D-02 — mfa_not_enabled is a proceed signal. Any other failure
      // reason aborts WITHOUT calling updateUser.
      if (gate.ok === false && gate.reason !== 'mfa_not_enabled') {
        if (gate.reason === 'cancelled') {
          // Silent abort — user closed the modal.
          return;
        }
        if (gate.reason === 'invalid_code') {
          toast('Please confirm your identity to change your email', 'error');
          return;
        }
        if (gate.reason === 'session_stale') {
          toast('Your session expired. Please sign in again.', 'error');
          return;
        }
        return;
      }

      const { error: updateErr } = await supabase.auth.updateUser({
        email: trimmed,
      });
      if (updateErr) {
        setError(updateErr.message);
        return;
      }
      toast(`Check ${trimmed} to confirm the change.`, 'success');
      setNext('');
      onSent?.(trimmed);
    } finally {
      setBusy(false);
    }
  };

  const handleModalSubmit = async (
    code: string,
  ): Promise<{ ok: boolean; reason?: string }> => {
    if (!pending) {
      return { ok: false, reason: 'cancelled' };
    }
    const factors = await listEnrolledFactors(supabase);
    const factor = factors[0];
    if (!factor) {
      pending.resolve({ cancelled: true });
      return { ok: false, reason: 'cancelled' };
    }
    const result = await verifyTotpChallenge(
      { factorId: factor.id, code },
      supabase,
    );
    if (!result.ok) {
      return { ok: false, reason: 'invalid_code' };
    }
    pending.resolve({ code });
    return { ok: true };
  };

  const handleModalCancel = (): void => {
    if (pending) {
      pending.resolve({ cancelled: true });
    }
    setPending(null);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="change-email-form">
      <Input
        label="New email"
        type="email"
        value={next}
        onChange={(e) => {
          setNext(e.target.value);
          if (error) setError(null);
        }}
        placeholder={currentEmail ?? 'you@example.com'}
        autoComplete="email"
        error={error ?? undefined}
        disabled={busy}
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          onClick={() => {
            void handleSubmit();
          }}
        >
          Send confirmation
        </Button>
      </div>
      <Aal2ChallengeModal
        open={pending !== null}
        purpose={pending?.purpose ?? 'change-email'}
        onSubmit={handleModalSubmit}
        onCancel={handleModalCancel}
      />
    </div>
  );
}
