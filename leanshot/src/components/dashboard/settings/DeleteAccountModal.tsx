/**
 * Phase 7 Plan 07-07 — DeleteAccountModal.
 *
 * Typed-confirmation modal for the destructive account-delete flow:
 *   - Reads `signedIn.user.email` from the store.
 *   - Destructive button is disabled until the typed value (case-insensitive,
 *     trimmed) matches the user's email — gate is the pure helper
 *     `typedConfirmMatches` from @/lib/account-delete.
 *   - On confirm, calls `initiateAccountDeletion()`. The RPC has already
 *     deleted auth.sessions server-side by the time the promise resolves;
 *     the wrapper also calls resetAll + signOut + wipes pre_cloud_backup.
 *   - Maps `recent_auth_required` to an inline error (modal stays open so
 *     the user can sign out + back in without re-typing).
 *   - Maps `already_pending` + unknown to toasts (modal closes).
 *
 * Copy is verbatim per 07-07-PLAN <behavior> — the e2e + RTL tests assert on
 * these exact substrings. Do not paraphrase.
 *
 * D-06 compliance: no non-null-assertion selectors (per the Phase 7 D-06
 * sweep tracked by 07-09). Uses optional chaining + the gate helper's
 * null-tolerant signature so the modal renders even if the store transitions
 * to a logged-out state mid-render.
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

export interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
}

export function DeleteAccountModal({ open, onClose }: DeleteAccountModalProps) {
  const signedIn = useStore((s) => s.signedIn);
  const email = signedIn?.user?.email ?? null;
  const toast = useToast();

  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const canConfirm = typedConfirmMatches(typed, email) && !busy;

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
      toast("Account scheduled for deletion in 30 days. You've been signed out.", 'success');
      setTyped('');
      onClose();
    } catch (e) {
      if (e instanceof AccountDeleteError) {
        if (e.code === 'recent_auth_required') {
          // Modal stays open so the user can sign out + back in without
          // losing context.
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
      // unknown / not_authenticated / anything else.
      toast('Could not start account deletion. Please try again or contact support.', 'error');
      setTyped('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Delete my account" size="md">
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          This starts a 30-day soft-delete. For 30 days you can undo by contacting support at
          help@leanshot.app. After 30 days your data is permanently destroyed and unrecoverable.
        </p>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Photos are immediately moved to a locked location — they become unreadable the instant you
          confirm, even before the 30-day window ends.
        </p>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Same-email re-signup during the 30-day window is blocked. After the window ends, the email
          is released.
        </p>
        <Input
          label="Type your email to confirm"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (inlineError) setInlineError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          placeholder={email ?? ''}
          error={inlineError ?? undefined}
          disabled={busy}
        />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            leadingIcon={<Trash2 className="size-4" />}
            disabled={!canConfirm}
            loading={busy}
            onClick={() => {
              void handleConfirm();
            }}
          >
            Schedule deletion in 30 days
          </Button>
        </div>
      </div>
    </Modal>
  );
}
