/**
 * Phase 7 Plan 07-07 → Phase 22 Plan 22-05 — DeleteAccountModal.
 *
 * Typed-confirmation modal for the destructive account-delete flow. Phase 22
 * rewrote this to:
 *   - Update grace-window copy from the legacy Phase 7 window to 7 days
 *     (Conflict #2 resolution per 22-CONTEXT D-01; backend cron already 7d
 *     per 22-01 File 01).
 *   - Switch typed-confirm gate from "email" to literal "DELETE MY ACCOUNT"
 *     (case-sensitive, exact match) per UI-SPEC §Copywriting line 572-573.
 *   - Invoke `lifecycle-transactional` with template=`deletion_scheduled`
 *     after the RPC succeeds so the user receives the HMAC-signed cancel
 *     link (D-02 affordance Phase 7 didn't have).
 *
 *   - Reads `signedIn.user.email` from the store (still used in the modal
 *     subhead so the user sees which account they're about to delete).
 *   - Destructive button is disabled until the typed value matches the
 *     literal string "DELETE MY ACCOUNT" exactly (case-sensitive). UI-SPEC
 *     locks this — do NOT case-fold or trim.
 *   - On confirm, calls `initiateAccountDeletion()`. The RPC has already
 *     deleted auth.sessions server-side by the time the promise resolves;
 *     the wrapper also calls resetAll + signOut + wipes pre_cloud_backup.
 *   - After success, fire-and-forget invoke of `lifecycle-transactional`
 *     with `{template: 'deletion_scheduled', user_id, data: {days_remaining: 7}}`
 *     (the Edge Fn mints the HMAC cancel token + builds the cancel_url).
 *     A failure to send the confirmation email is NOT a hard error — the
 *     deletion is already scheduled. Log + continue.
 *   - Maps `recent_auth_required` to an inline error (modal stays open so
 *     the user can sign out + back in without re-typing).
 *   - Maps `already_pending` + unknown to toasts (modal closes).
 *
 * Copy is verbatim per 22-UI-SPEC §Copywriting (lines 562-579) — the RTL
 * tests assert on these exact substrings. Do not paraphrase.
 *
 * D-06 compliance (Phase 7): no non-null-assertion selectors. Uses optional
 * chaining + the gate helper's null-tolerant signature so the modal renders
 * even if the store transitions to a logged-out state mid-render.
 */
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import {
  AccountDeleteError,
  initiateAccountDeletion,
  typedConfirmMatches,
} from '@/lib/account-delete';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Phase 22 Plan 22-05: fire-and-forget invoke of the lifecycle-transactional
 * Edge Fn to send the `deletion_scheduled` confirmation email (with the HMAC
 * cancel link). Errors are intentionally swallowed — the account-delete RPC
 * has already scheduled the deletion server-side; the email is a courtesy
 * affordance. If the Edge Fn is unreachable (network, gated-send no-op,
 * Vault key missing) the deletion still proceeds; the user can still cancel
 * via the in-app SoftDeleteCountdownBanner.
 */
async function sendDeletionScheduledEmail(userId: string): Promise<void> {
  try {
    await supabase.functions.invoke('lifecycle-transactional', {
      body: {
        template: 'deletion_scheduled',
        user_id: userId,
        data: { days_remaining: 7 },
      },
    });
  } catch (err) {
    // Swallow — the email is non-critical; deletion already scheduled.
    // Logging via console.warn (project convention — no global logger).
     
    console.warn(
      '[DeleteAccountModal] deletion_scheduled email invoke failed (deletion still scheduled)',
      err,
    );
  }
}

export function DeleteAccountModal({ open, onClose }: DeleteAccountModalProps) {
  const signedIn = useStore((s) => s.signedIn);
  const userId = signedIn?.user?.id ?? null;
  const toast = useToast();

  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Phase 22 UI-SPEC §Copywriting line 572-573: typed-confirm must be the
  // literal "DELETE MY ACCOUNT" — exact match, case-sensitive (per
  // UI-SPEC line 310: "exact-match required, case-sensitive").
  const canConfirm = typedConfirmMatches(typed) && !busy;

  const close = (): void => {
    if (busy) return;
    setTyped('');
    setInlineError(null);
    onClose();
  };

  const handleConfirm = async (): Promise<void> => {
    if (!canConfirm) return;
    setBusy(true);
    setInlineError(null);
    try {
      await initiateAccountDeletion();
      // Success — fire-and-forget the lifecycle email BEFORE we lose the
      // user_id (initiateAccountDeletion wipes the store + signs out).
      if (userId) {
        void sendDeletionScheduledEmail(userId);
      }
      toast("Account scheduled for deletion. We've sent a confirmation email.", 'success');
      setTyped('');
      onClose();
    } catch (e) {
      if (e instanceof AccountDeleteError) {
        if (e.code === 'recent_auth_required') {
          setInlineError(
            'For your security, sign out and sign back in within the last 5 minutes before deleting your account.',
          );
          return;
        }
        if (e.code === 'already_pending') {
          toast('Your account is already scheduled for deletion.', 'info');
          setTyped('');
          onClose();
          return;
        }
      }
      // unknown / not_authenticated / anything else. UI-SPEC line 578.
      toast('Something went wrong. Try again or contact support.', 'error');
      setTyped('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Delete account" size="md">
      <div className="space-y-4">
        {/* UI-SPEC line 569: body intro */}
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          This will permanently delete your LeanShot account, including:
        </p>
        {/* UI-SPEC line 570: bulleted list of categories */}
        <ul className="list-disc list-inside text-[14px] text-[var(--color-text-secondary)] leading-relaxed space-y-1">
          <li>injections</li>
          <li>photos</li>
          <li>weight logs</li>
          <li>AI history</li>
          <li>doctor shares</li>
          <li>affiliate referrals</li>
        </ul>
        {/* Phase 22 Plan 22-05: 7-day grace + re-signup window. Combined into
            one paragraph to keep the modal compact (UI-SPEC §Modal layout
            doesn't lock this line; planner discretion). */}
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          You have 7 days to cancel via the link we&apos;ll email you. Same-email re-signup during
          the 7-day window is blocked. After the window ends, you can re-register with the same
          email.
        </p>
        {/* UI-SPEC line 571: retention disclosure */}
        <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
          Stripe payment records and affiliate ledger entries are retained for 7 years per IRS
          requirements (anonymized).
        </p>
        <Input
          // UI-SPEC line 572 / 573
          label="Type DELETE MY ACCOUNT to confirm"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (inlineError) setInlineError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          placeholder="DELETE MY ACCOUNT"
          error={inlineError ?? undefined}
          disabled={busy}
        />
        <div className="flex gap-2 justify-end">
          {/* UI-SPEC line 574 */}
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          {/* UI-SPEC line 575 / 576 */}
          <Button
            variant="destructive"
            leadingIcon={<Trash2 className="size-4" />}
            disabled={!canConfirm}
            loading={busy}
            onClick={() => {
              void handleConfirm();
            }}
          >
            {busy ? 'Deleting...' : 'Delete account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
