/**
 * Phase 9 Plan 09-04 — ConsentDialog.
 *
 * Renders the 10-checkbox consent form that the patient sees at invite
 * acceptance time. Composed by ClinicInvitePage in State B (existing
 * logged-in user) and, after signup-confirm bounce, in State D's
 * post-signin trailer.
 *
 * Key contracts:
 *
 *   1. **W-5 defensive scope-init (Pitfall #8 jsonb drift defense).**
 *      The local scope state is built by iterating the canonical
 *      `DATA_TYPE_KEYS` tuple and coercing each value strictly via
 *      `=== true`. Malformed/partial jsonb from the server cannot leak
 *      extra keys, undefined keys, or non-boolean values into the UI or
 *      the RPC payload. The server-side `_validate_consent_scope`
 *      helper (Plan 09-01 deviation) is the second backstop.
 *
 *   2. **Pitfall #9 anonymous-context rule.** This component is
 *      mounted under `/clinic-invite/{token}` which may render to an
 *      unauthenticated browser. ZERO `useStore` calls anywhere in the
 *      clinic-invite/ tree (the verification grep
 *      `grep -rn "useStore" src/components/clinic-invite/` returns 0).
 *      Toast surfaces are local React state, not the Zustand toast slice.
 *
 *   3. **[COUNSEL REVIEW NEEDED]** BAA placeholder banner per
 *      09-CONTEXT.md D-18 deferred-item flag. The legal team must
 *      sign off on the final disclosure copy before public launch.
 *
 *   4. **No `s.user!` non-null assertions** (project anti-pattern).
 */
import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Confirm';
import {
  acceptInviteExisting,
  acceptInviteNew,
  hashInviteToken,
  rejectInvite,
} from '@/lib/clinic';
import { DATA_TYPE_KEYS, DATA_TYPE_LABELS, type ConsentScope } from '@/types/clinic';

/* eslint-disable @typescript-eslint/no-explicit-any */
type LookupInvite = {
  id: string;
  email: string;
  requested_scope: any; // intentionally loose at the boundary — coerced via W-5
  org: { id: string; name: string; logo_storage_path: string | null };
  operator_first_name: string;
  expires_at: string;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ConsentDialogProps {
  invite: LookupInvite;
  /** Raw token from the URL — hashed via Web Crypto before RPC dispatch. */
  rawToken: string;
  /** Determines which RPC the Accept CTA invokes. */
  mode: 'existing' | 'new';
  onAccepted?: () => void;
  onDeclined?: () => void;
}

/**
 * W-5 defensive scope-init: build the local state by iterating the
 * canonical `DATA_TYPE_KEYS` const and coercing each value strictly via
 * `=== true`. Result has EXACTLY the 10 canonical keys with strict-boolean
 * values, regardless of what the server returns.
 */
function initScopeFromRequested(requested: unknown): ConsentScope {
  const src = (requested ?? {}) as Record<string, unknown>;
  return DATA_TYPE_KEYS.reduce<ConsentScope>(
    (acc, k) => ({ ...acc, [k]: src[k] === true }),
    {} as ConsentScope,
  );
}

type ViewState =
  | { kind: 'editing' }
  | { kind: 'submitting' }
  | { kind: 'accepted' }
  | { kind: 'declined' }
  | { kind: 'error'; message: string };

export function ConsentDialog({
  invite,
  rawToken,
  mode,
  onAccepted,
  onDeclined,
}: ConsentDialogProps) {
  const [scope, setScope] = useState<ConsentScope>(() => initScopeFromRequested(invite.requested_scope));
  const [state, setState] = useState<ViewState>({ kind: 'editing' });
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);

  const onCheckboxChange = (key: keyof ConsentScope) => (e: ChangeEvent<HTMLInputElement>) => {
    setScope((prev) => ({ ...prev, [key]: e.target.checked === true }));
  };

  const submitAccept = async (): Promise<void> => {
    setState({ kind: 'submitting' });
    try {
      const invite_token_hash = await hashInviteToken(rawToken);
      const rpc = mode === 'existing' ? acceptInviteExisting : acceptInviteNew;
      const result = await rpc({ invite_token_hash, consent_scope: scope });
      if (result.ok) {
        setState({ kind: 'accepted' });
        onAccepted?.();
      } else {
        setState({ kind: 'error', message: result.error || "Couldn't join. Check your connection and try again." });
      }
    } catch {
      setState({
        kind: 'error',
        message: "Couldn't join. Check your connection and try again.",
      });
    }
  };

  const submitDecline = async (): Promise<void> => {
    setShowDeclineConfirm(false);
    setState({ kind: 'submitting' });
    try {
      const invite_token_hash = await hashInviteToken(rawToken);
      const result = await rejectInvite({ invite_token_hash });
      if (result.ok) {
        setState({ kind: 'declined' });
        onDeclined?.();
      } else {
        setState({ kind: 'error', message: result.error || "Couldn't decline. Check your connection and try again." });
      }
    } catch {
      setState({
        kind: 'error',
        message: "Couldn't decline. Check your connection and try again.",
      });
    }
  };

  // ────────────────────────────────────────────────────────────────────
  // ACCEPTED STATE — "You're connected"
  // ────────────────────────────────────────────────────────────────────
  if (state.kind === 'accepted') {
    return (
      <Card variant="elevated" padding="lg" className="max-w-[640px] mx-auto">
        <h1 className="text-[24px] font-bold tracking-tight">You&apos;re connected</h1>
        <p className="mt-2 text-[14px] text-[var(--color-text-secondary)]">
          {invite.org.name} can now see the data you chose. Manage this in Settings → Active
          organizations.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={() => (window.location.href = '/')}>Go to my account</Button>
          <Button
            variant="ghost"
            onClick={() => (window.location.href = '/#/settings/organizations')}
          >
            Manage this membership
          </Button>
        </div>
      </Card>
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // DECLINED STATE — "Invitation declined" (State F-equivalent display)
  // ────────────────────────────────────────────────────────────────────
  if (state.kind === 'declined') {
    return (
      <Card variant="elevated" padding="lg" className="max-w-[640px] mx-auto">
        <h1 className="text-[24px] font-bold tracking-tight">
          This invitation has already been accepted or declined
        </h1>
        <p className="mt-2 text-[14px] text-[var(--color-text-secondary)]">
          Invitation declined.
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={() => (window.location.href = '/')}>Done</Button>
        </div>
      </Card>
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // EDITING / SUBMITTING / ERROR STATE — main consent form
  // ────────────────────────────────────────────────────────────────────
  const submitting = state.kind === 'submitting';

  return (
    <Card variant="elevated" padding="lg" className="max-w-[640px] mx-auto">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        Invitation from {invite.org.name}
      </p>
      <h1 className="mt-1 text-[26px] font-bold tracking-tight">Choose what to share</h1>
      <p className="mt-2 text-[14px] text-[var(--color-text-secondary)]">
        {invite.operator_first_name} from {invite.org.name} invited you to share your data. Pick
        what they can see. You can change this any time from Settings.
      </p>

      {/* What you're sharing */}
      <section className="mt-6">
        <h2 className="text-[15px] font-semibold">What you&apos;re sharing</h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          These data types are pre-checked based on what {invite.org.name} requested. Uncheck
          anything you don&apos;t want to share before accepting.
        </p>
        <ul className="mt-4 flex flex-col gap-2" role="group" aria-label="Data type consent checkboxes">
          {DATA_TYPE_KEYS.map((k) => {
            const meta = DATA_TYPE_LABELS[k];
            return (
              <li
                key={k}
                className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
              >
                <input
                  id={`consent-${k}`}
                  type="checkbox"
                  checked={scope[k]}
                  onChange={onCheckboxChange(k)}
                  className="mt-1 size-4 accent-[var(--color-primary)]"
                  aria-describedby={`consent-${k}-desc`}
                />
                <label htmlFor={`consent-${k}`} className="flex-1 cursor-pointer">
                  <span className="text-[14px] font-semibold">{meta.label}</span>
                  <span
                    id={`consent-${k}-desc`}
                    className="block text-[12px] text-[var(--color-text-secondary)]"
                  >
                    {meta.description}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
          AI coach conversations, account settings, and anything you delete are never shared. This
          is a LeanShot privacy guarantee.
        </p>
      </section>

      {/* What the org can do */}
      <section className="mt-6">
        <h2 className="text-[15px] font-semibold">What {invite.org.name} can do</h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          View your selected data in their workspace. They cannot edit, delete, or download your
          data. Every access is logged.
        </p>
      </section>

      {/*
        [COUNSEL REVIEW NEEDED] — Phase 9 ships a placeholder banner pending
        legal review per 09-CONTEXT.md D-18 deferred items. Counsel sign-off
        must land before public launch. Do not remove this banner without an
        explicit legal-team sign-off recorded in the SUMMARY for the plan
        that retires it.
      */}
      <div
        role="note"
        aria-label="Legal review pending"
        className="mt-6 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-soft,rgba(255,200,0,0.08))] p-4 text-[13px] text-[var(--color-text)]"
      >
        Legal copy describing data-protection terms appears here before public launch. Internal
        review required.
      </div>

      {state.kind === 'error' && (
        <p className="mt-4 text-[13px] text-[var(--color-danger)]" role="alert">
          {state.message}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => setShowDeclineConfirm(true)}
          disabled={submitting}
        >
          Decline
        </Button>
        <Button variant="primary" onClick={submitAccept} loading={submitting}>
          Accept and join
        </Button>
      </div>

      <ConfirmModal
        open={showDeclineConfirm}
        title="Decline this invitation?"
        message={`You can ask ${invite.org.name} for a new invitation later if you change your mind.`}
        confirmLabel="Decline invitation"
        cancelLabel="Keep reviewing"
        destructive
        onConfirm={submitDecline}
        onCancel={() => setShowDeclineConfirm(false)}
      />
    </Card>
  );
}

export default ConsentDialog;
