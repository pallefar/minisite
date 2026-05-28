/**
 * Phase 66 Plan 66-04 — Consumer AAL2 step-up modal.
 *
 * Renders the TOTP-code prompt the user must satisfy before one of the
 * three sensitive consumer actions (delete-account / export-all-data /
 * change-email) proceeds. This is the UI seam for
 * `requireAal2ForConsumerAction` (Plan 66-02) — callers pass an
 * `onChallenge` callback that opens this modal; on submit, the caller
 * invokes the gate which in turn calls `verifyTotpChallenge` with the
 * code entered here.
 *
 * Contract (matches UI-SPEC §Component contracts → <Aal2ChallengeModal>
 *   AND the planner's `<Aal2ChallengeModalProps>` interface):
 *
 *   - `open`: parent controls visibility
 *   - `purpose`: drives the subtitle copy (also surfaced to onSubmit so
 *     telemetry/audit-log tagging stays grep-able from this surface)
 *   - `onSubmit(code)`: resolves to `{ ok: true }` on success or
 *     `{ ok: false, reason?: string }` on failure. The modal stays open
 *     on `{ ok: false }`, surfaces the error, clears the input, and
 *     auto-focuses for retry.
 *   - `onCancel()`: parent closes the modal AND aborts the gated action.
 *
 * Behaviour:
 *   - 6-digit numeric code input, auto-focused on open, paste-friendly
 *     (sanitises non-digits + truncates to 6 chars)
 *   - Confirm button disabled until 6 digits entered + during loading
 *   - Loading spinner via Button.loading while onSubmit is pending
 *   - Cancel link calls onCancel (button styled as ghost text-link)
 *   - Modal is non-dismissible while submitting (prevents accidental
 *     cancel mid-verify); ESC + backdrop still close otherwise
 *
 * Tokens (UI-SPEC §Tokens — all pre-existing @theme; no new ones):
 *   - color-surface / color-text / color-text-secondary
 *   - color-border / color-primary / color-danger
 *
 * Typography ceiling respected: 11px label uppercase + 13/14px body +
 * 18px heading; weights 400/600 only.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

/**
 * Three purposes match the canonical `Aal2ConsumerPurpose` union
 * exported by `@/lib/auth/aal2-consumer`. Re-declared here (rather than
 * imported) so the modal stays import-light + can be rendered by any
 * caller — including those not directly calling the gate (e.g. preview
 * stories).
 */
export type Aal2ChallengeModalPurpose = 'delete-account' | 'export-all-data' | 'change-email';

export interface Aal2ChallengeModalProps {
  open: boolean;
  purpose: Aal2ChallengeModalPurpose;
  /**
   * Submit handler — receives the 6-digit code; resolves to a result
   * envelope. On `{ ok: true }` the modal closes (parent flips `open`).
   * On `{ ok: false }` the modal surfaces the error inline + clears the
   * input so the user can re-enter.
   */
  onSubmit: (code: string) => Promise<{ ok: boolean; reason?: string }>;
  /**
   * Cancel handler — closes the modal AND aborts the gated caller
   * action. Disabled while a submit is in-flight (we don't want to
   * surface "cancelled" mid-verify and confuse the caller's state).
   */
  onCancel: () => void;
}

const SUBTITLE: Record<Aal2ChallengeModalPurpose, string> = {
  'delete-account': 'to delete your account',
  'export-all-data': 'to export your data',
  'change-email': 'to change your email',
};

/**
 * Map a gate `reason` enum to a user-facing error string. The reasons
 * here are the subset the modal can render — `cancelled` is never shown
 * (the user IS the cancel), `mfa_not_enabled` is short-circuited by the
 * caller (modal never opens). That leaves `invalid_code` (most common)
 * + `session_stale` (edge case — session expired while modal was open).
 */
function renderError(reason: string | undefined): string {
  if (reason === 'invalid_code') return 'That code didn’t match. Try again.';
  if (reason === 'session_stale') {
    return 'Your session expired. Please sign in again.';
  }
  return 'Something went wrong. Try again.';
}

export function Aal2ChallengeModal({ open, purpose, onSubmit, onCancel }: Aal2ChallengeModalProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset internal state every time the modal opens — prevents stale
  // error/text from a previous open carrying over.
  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
      // Auto-focus the input on open. RAF defer so Modal's mount
      // animation doesn't fight the focus call.
      const t = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(t);
    }
    return undefined;
  }, [open]);

  const canConfirm = code.length === 6 && !busy;

  const handleSubmit = async (): Promise<void> => {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit(code);
      if (!result.ok) {
        setError(renderError(result.reason));
        setCode('');
        // Re-focus input so the user can re-enter without reaching
        // for the mouse.
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      // Success — parent flips `open` to false; we don't manage close
      // here (single source of truth = parent).
    } catch (err) {
      // Unknown thrown error — surface a generic message.
      setError(renderError(undefined));
      setCode('');
      // Defensive log (project convention — no global logger).

      console.warn('[Aal2ChallengeModal] onSubmit threw', err);
    } finally {
      setBusy(false);
    }
  };

  const handleClose = (): void => {
    if (busy) return;
    onCancel();
  };

  /**
   * Paste-friendly digits-only handler. Strips non-digits + truncates
   * to 6 characters so a user pasting from an authenticator app (which
   * sometimes includes a leading space or a separator) still lands in
   * a clean state.
   */
  const handleChange = (raw: string): void => {
    const digits = raw.replace(/\D+/g, '').slice(0, 6);
    setCode(digits);
    if (error) setError(null);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Confirm your identity"
      size="sm"
      dismissible={!busy}
    >
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Enter your 6-digit authenticator code {SUBTITLE[purpose]}.
        </p>
        <Input
          ref={inputRef}
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="123456"
          error={error ?? undefined}
          disabled={busy}
          aria-label="6-digit authenticator code"
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canConfirm}
            loading={busy}
            onClick={() => {
              void handleSubmit();
            }}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
