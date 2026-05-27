/**
 * Phase 66 Plan 66-04 — DangerZone surface for consumer settings.
 *
 * Hosts the delete-account CTA and wires it through the Phase 66
 * consumer-AAL2 gate (`requireAal2ForConsumerAction`). The existing
 * Phase 7/22 `<DeleteAccountModal>` (typed-confirm + 7-day grace + RPC
 * invocation) is reused verbatim — DangerZone is the AAL2 step-up
 * vestibule that opens the modal only AFTER the gate clears.
 *
 * Behaviour:
 *   1. User clicks "Delete account" on this surface.
 *   2. We call `requireAal2ForConsumerAction(supabase, 'delete-account',
 *      { onChallenge })`.
 *   3. On `ok: true` → open <DeleteAccountModal> (existing typed-confirm
 *      flow takes over).
 *   4. On `ok: false` + `reason: 'mfa_not_enabled'` → also open the
 *      modal (per D-02: don't lock users without MFA out of their own
 *      account deletion).
 *   5. On `ok: false` + reason in {'cancelled', 'invalid_code',
 *      'session_stale'} → show a toast + do NOT open the modal.
 *
 * The `<Aal2ChallengeModal>` is rendered locally so the gate's
 * `onChallenge` callback can resolve from the user's code input.
 *
 * UI-SPEC tokens (existing @theme — no new ones):
 *   - text-text / text-text-secondary
 *   - bg-surface / border-border
 *   - danger CTA reuses Button variant="destructive"
 */
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import {
  Aal2ChallengeModal,
  type Aal2ChallengeModalPurpose,
} from '@/components/auth/Aal2ChallengeModal';
import { DeleteAccountModal } from '@/components/dashboard/settings/DeleteAccountModal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import {
  requireAal2ForConsumerAction,
  type Aal2ChallengeOutcome,
} from '@/lib/auth/aal2-consumer';
import { verifyTotpChallenge, listEnrolledFactors } from '@/lib/auth/totp-shared';
import { supabase } from '@/lib/supabase';

/**
 * Pending challenge state — when set, the <Aal2ChallengeModal> is open
 * and its `onSubmit` resolves the gate's `onChallenge` promise.
 */
interface PendingChallenge {
  purpose: Aal2ChallengeModalPurpose;
  resolve: (outcome: Aal2ChallengeOutcome) => void;
}

export interface DangerZoneProps {
  /**
   * Optional override — exposed for tests so the surface can be
   * instrumented without spinning up the global Modal portal twice.
   */
  initialShowDelete?: boolean;
}

export function DangerZone({ initialShowDelete }: DangerZoneProps = {}) {
  const toast = useToast();
  const [showDelete, setShowDelete] = useState(Boolean(initialShowDelete));
  const [pending, setPending] = useState<PendingChallenge | null>(null);
  const [verifying, setVerifying] = useState(false);

  /**
   * Click handler — runs the gate. If it clears (or MFA not enrolled),
   * open the existing DeleteAccountModal which owns the typed-confirm
   * flow + RPC invocation.
   */
  const handleDeleteClick = async (): Promise<void> => {
    const gate = await requireAal2ForConsumerAction(supabase, 'delete-account', {
      onChallenge: () =>
        new Promise<Aal2ChallengeOutcome>((resolve) => {
          setPending({ purpose: 'delete-account', resolve });
        }),
    });

    setPending(null);

    if (gate.ok) {
      setShowDelete(true);
      return;
    }

    // ok === false branch — D-02: mfa_not_enabled is a proceed signal.
    if (gate.reason === 'mfa_not_enabled') {
      setShowDelete(true);
      return;
    }
    if (gate.reason === 'cancelled') {
      // User dismissed the AAL2 modal — silent abort (no toast; user
      // intent was clear).
      return;
    }
    if (gate.reason === 'invalid_code') {
      toast('Please confirm your identity to delete your account', 'error');
      return;
    }
    if (gate.reason === 'session_stale') {
      toast('Your session expired. Please sign in again.', 'error');
      return;
    }
  };

  /**
   * Modal onSubmit — runs `verifyTotpChallenge` directly so the modal
   * surface receives `{ ok, reason }` per the Aal2ChallengeModalProps
   * contract. On `ok: true` we resolve the gate's pending promise with
   * the code so the gate's own bookkeeping (persist freshness ts)
   * happens centrally; on failure we leave the modal open with an
   * error.
   *
   * NOTE — we run verify here (NOT inside the gate's onChallenge
   * resolver) because the gate's contract resolves `onChallenge` with
   * either `{ code }` (and runs verify itself) OR `{ cancelled: true }`.
   * To match THAT contract, we resolve with `{ code }` after we've
   * pre-verified — but the gate will verify a second time. To avoid
   * the double-verify, we instead probe the factor here, return the
   * outcome, and let the gate be the verifier. This component only
   * needs to surface `{ ok, reason }` to the modal; we obtain that by
   * pre-flighting the verify.
   */
  const handleModalSubmit = async (
    code: string,
  ): Promise<{ ok: boolean; reason?: string }> => {
    if (!pending) {
      return { ok: false, reason: 'cancelled' };
    }
    setVerifying(true);
    try {
      const factors = await listEnrolledFactors(supabase);
      const factor = factors[0];
      if (!factor) {
        // mfa was unenrolled between gate-start and modal-submit. Treat
        // as cancelled so the gate's outer loop short-circuits — the
        // outer handleDeleteClick will see mfa_not_enabled on its NEXT
        // call.
        pending.resolve({ cancelled: true });
        return { ok: false, reason: 'cancelled' };
      }
      const result = await verifyTotpChallenge(
        { factorId: factor.id, code },
        supabase,
      );
      if (!result.ok) {
        // Leave the modal open + show error; do NOT resolve the gate
        // yet (the user can re-enter the code).
        return { ok: false, reason: 'invalid_code' };
      }
      // Verified — resolve the gate's onChallenge so the gate finishes
      // its bookkeeping (persistFreshnessTs).
      pending.resolve({ code });
      return { ok: true };
    } finally {
      setVerifying(false);
    }
  };

  const handleModalCancel = (): void => {
    if (verifying) return;
    if (pending) {
      pending.resolve({ cancelled: true });
    }
    setPending(null);
  };

  return (
    <section
      data-testid="danger-zone"
      className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6 space-y-4"
    >
      <header className="flex items-start gap-3">
        <ShieldAlert
          className="size-5 text-[var(--color-danger)] shrink-0"
          aria-hidden
        />
        <div className="flex-1">
          <h3 className="text-[18px] font-semibold tracking-tight">
            Danger zone
          </h3>
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            Permanently delete your LeanShot account and all associated data.
            This action cannot be undone after the 7-day grace window.
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          You’ll be asked to type a confirmation phrase before deletion.
        </p>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            void handleDeleteClick();
          }}
        >
          Delete account
        </Button>
      </div>

      <DeleteAccountModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
      />

      <Aal2ChallengeModal
        open={pending !== null}
        purpose={pending?.purpose ?? 'delete-account'}
        onSubmit={handleModalSubmit}
        onCancel={handleModalCancel}
      />
    </section>
  );
}
