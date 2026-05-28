/**
 * Phase 27 Plan 27-03 — PaletteAal2Gate: forwardRef imperative-handle gate
 * that wraps a destructive action in an aal2 step-up challenge (D-12).
 *
 * Usage:
 *   const gateRef = useRef<PaletteAal2GateHandle>(null);
 *   <PaletteAal2Gate ref={gateRef} />
 *   await gateRef.current?.run(() => actuallyBanUser(id));
 *
 * Flow:
 *   1. gate.run(action) calls isAal2Fresh(); if fresh → action() immediately
 *   2. else opens a Modal with a 6-digit TOTP input + Verify + Cancel
 *   3. On Verify: discovers the user's first verified TOTP factor via
 *      supabase.auth.mfa.listFactors(), runs mfa.challengeAndVerify({factorId,code}),
 *      persists localStorage timestamp on success, then runs action()
 *   4. On Cancel: rejects with Error('user_cancelled')
 *   5. On verify failure: shows inline error; user can retry or cancel
 *
 * Audit-logging: this gate does NOT write an audit row. The downstream RPC
 * the action invokes (admin_bulk_action_execute, admin_force_password_reset,
 * etc.) audit-logs per row already via log_admin_action (Phase 24). Adding
 * a second row here would double-count. Documented in 27-03-SUMMARY.md.
 */
import { useImperativeHandle, useState, forwardRef, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { requireAal2Fresh } from '@/lib/admin/palette/aal2-step-up';
import { supabase } from '@/lib/supabase';

export interface PaletteAal2GateHandle {
  /**
   * Executes `action` after ensuring aal2 freshness.
   * Resolves on success; rejects with Error('user_cancelled') or
   * Error('aal2_challenge_failed') on the failure paths.
   */
  run(action: () => void | Promise<void>): Promise<void>;
}

/** Discover the user's verified TOTP factorId. */
async function resolveTotpFactorId(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return null;
  const totp = data.totp ?? data.all?.filter((f) => f.factor_type === 'totp') ?? [];
  // Prefer a verified factor (status==='verified').
  const verified = totp.find((f) => f.status === 'verified') ?? totp[0];
  return verified?.id ?? null;
}

interface ModalState {
  open: boolean;
  code: string;
  error: string | null;
  verifying: boolean;
}

const INITIAL: ModalState = { open: false, code: '', error: null, verifying: false };

export const PaletteAal2Gate = forwardRef<PaletteAal2GateHandle>(
  function PaletteAal2Gate(_props, ref) {
    const [state, setState] = useState<ModalState>(INITIAL);
    // Pending action + resolve/reject for the in-flight gate.run() promise.
    const pending = useRef<{
      action: () => void | Promise<void>;
      resolve: () => void;
      reject: (e: Error) => void;
    } | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Focus the TOTP input when the modal opens (replaces autoFocus prop per jsx-a11y).
    useEffect(() => {
      if (state.open && inputRef.current) {
        inputRef.current.focus();
      }
    }, [state.open]);

    const closeAndReject = (reason: string) => {
      const p = pending.current;
      pending.current = null;
      setState(INITIAL);
      p?.reject(new Error(reason));
    };

    const submitCode = async () => {
      const p = pending.current;
      if (!p) return;
      setState((s) => ({ ...s, verifying: true, error: null }));

      try {
        await requireAal2Fresh(async () => {
          const factorId = await resolveTotpFactorId();
          if (!factorId) {
            throw new Error('aal2_challenge_failed');
          }
          return { factorId, code: state.code };
        });
        // Step-up succeeded — clear modal then run action.
        pending.current = null;
        setState(INITIAL);
        await p.action();
        p.resolve();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'aal2_challenge_failed';
        setState((s) => ({
          ...s,
          verifying: false,
          error: msg === 'aal2_challenge_failed' ? 'Invalid code. Try again.' : msg,
        }));
      }
    };

    useImperativeHandle(
      ref,
      (): PaletteAal2GateHandle => ({
        async run(action) {
          return new Promise<void>((resolve, reject) => {
            // Short-circuit when no pending modal is active.
            pending.current = { action, resolve, reject };
            (async () => {
              try {
                // Fast path: if already fresh, run inline without showing modal.
                let fresh = false;
                try {
                  // requireAal2Fresh would call onChallenge() if stale; we want
                  // to check freshness silently first so we can show the modal.
                  const { isAal2Fresh } = await import('@/lib/admin/palette/aal2-step-up');
                  fresh = await isAal2Fresh();
                } catch {
                  fresh = false;
                }
                if (fresh) {
                  pending.current = null;
                  await action();
                  resolve();
                  return;
                }
                // Stale → open modal to collect TOTP.
                setState({ open: true, code: '', error: null, verifying: false });
              } catch (e) {
                pending.current = null;
                reject(e instanceof Error ? e : new Error('unknown'));
              }
            })();
          });
        },
      }),
      [],
    );

    return (
      <Modal
        open={state.open}
        onClose={() => closeAndReject('user_cancelled')}
        title="Verify TOTP"
        size="sm"
        hideClose={state.verifying}
        dismissible={!state.verifying}
      >
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            This action requires a fresh second-factor challenge. Enter the 6-digit code from your
            authenticator app.
          </p>
          <Input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={state.code}
            onChange={(e) =>
              setState((s) => ({ ...s, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))
            }
            placeholder="123456"
            aria-label="TOTP code"
            aria-invalid={state.error !== null}
            disabled={state.verifying}
          />
          {state.error && (
            <p role="alert" className="text-[13px] text-[var(--color-danger,#c14b4b)]">
              {state.error}
            </p>
          )}
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => closeAndReject('user_cancelled')}
              disabled={state.verifying}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitCode()}
              disabled={state.verifying || state.code.length !== 6}
              aria-busy={state.verifying}
            >
              Verify
            </Button>
          </div>
        </div>
      </Modal>
    );
  },
);

export default PaletteAal2Gate;
