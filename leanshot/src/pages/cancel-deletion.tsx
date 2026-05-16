/**
 * Phase 22 Plan 22-05 — /cancel-deletion route.
 *
 * Landing page for the HMAC-signed cancel link emailed by the
 * `deletion_scheduled` lifecycle template (plan 22-02 owns the email
 * + token mint). Reads `?token=<3-part HMAC>` from the URL, calls the
 * `cancel_account_deletion(p_token)` RPC (plan 22-01 File 14), and
 * shows one of four outcomes:
 *
 *   1. success         → "Deletion canceled. Welcome back!" + link
 *                         to /dashboard.
 *   2. invalid token   → "This link is no longer valid." + back link.
 *   3. token expired   → "Your cancel window has expired." + help text.
 *   4. hmac_key_missing→ "Cancel link verification is temporarily
 *                         unavailable." (Vault key not loaded — 22-02
 *                         deferred vendor pass.)
 *   5. no token in URL → friendly "Cancel deletion" page with help text
 *                         and a "Back to settings" link (graceful
 *                         degradation per Pitfall #4 in the executor
 *                         prompt — must not crash on missing token).
 *
 * RPC error mapping (per plan 22-01 File 14 RPC body):
 *   - 'invalid_token'      → invalid
 *   - 'token_expired'      → expired
 *   - 'already_finalized'  → already
 *   - 'hmac_key_missing'   → vault_missing
 *   - everything else      → unknown
 *
 * D-06 compliance (no non-null assertions): every supabase value is
 * narrowed with optional-chaining + early returns.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'no_token' }
  | { kind: 'confirming' }
  | { kind: 'success' }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'already' }
  | { kind: 'vault_missing' }
  | { kind: 'unknown' };

function mapRpcError(message: string | undefined): Outcome {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid_token')) return { kind: 'invalid' };
  if (m.includes('token_expired')) return { kind: 'expired' };
  if (m.includes('already_finalized')) return { kind: 'already' };
  if (m.includes('hmac_key_missing') || m.includes('vault')) return { kind: 'vault_missing' };
  return { kind: 'unknown' };
}

async function callCancelRpc(token: string): Promise<Outcome> {
  try {
    const { error } = await supabase.rpc('cancel_account_deletion', { p_token: token });
    if (!error) return { kind: 'success' };
    return mapRpcError(error.message);
  } catch (err) {
    // Network / unexpected — log + fall through to unknown so the user
    // sees a friendly generic message instead of a stack trace.
     
    console.warn('[cancel-deletion] RPC call threw', err);
    return { kind: 'unknown' };
  }
}

function getTokenFromUrl(): string | null {
  // Both `?token=` (lifecycle-transactional email link contract per
  // plan 22-02 SUMMARY line 111) and `?cancel_token=` (SoftDelete banner
  // alternate naming) are accepted.
  const params = new URLSearchParams(window.location.search);
  const t = params.get('token') ?? params.get('cancel_token');
  if (!t || t.trim().length === 0) return null;
  // Plan 22-02 sends `?token=pending` as a placeholder when the Vault
  // CANCEL_DELETION_HMAC_KEY is not loaded. Treat as "no_token" so the
  // user gets the friendly help-text screen rather than an invalid-token
  // error from the RPC (which would also fire and reach the same UI but
  // with worse copy).
  if (t === 'pending') return null;
  return t;
}

export function CancelDeletionPage() {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  useEffect(() => {
    const token = getTokenFromUrl();
    if (token === null) {
      setOutcome({ kind: 'no_token' });
      return;
    }
    // Auto-fire the RPC on mount per <action> bullet line 211 — the page
    // is a one-shot confirmation, not a click-through. (If product later
    // wants explicit confirm, gate behind a button instead.)
    setOutcome({ kind: 'confirming' });
    let cancelled = false;
    void callCancelRpc(token).then((next) => {
      if (!cancelled) setOutcome(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const back = (
    <Button
      variant="ghost"
      size="md"
      onClick={() => {
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }}
    >
      Back to settings
    </Button>
  );

  let heading = 'Cancel scheduled deletion?';
  let body = 'Click Confirm to cancel the deletion request and restore your account.';
  let action = back;
  let testid = 'cancel-deletion-idle';

  switch (outcome.kind) {
    case 'idle':
    case 'confirming':
      heading = 'Cancel scheduled deletion?';
      body = 'Verifying your cancel link…';
      action = <></>;
      testid = 'cancel-deletion-confirming';
      break;
    case 'success':
      heading = 'Deletion canceled. Welcome back!';
      body = 'Your account is no longer scheduled for deletion. You can return to LeanShot any time.';
      action = (
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            window.location.assign('/');
          }}
        >
          Go to dashboard
        </Button>
      );
      testid = 'cancel-deletion-success';
      break;
    case 'no_token':
      heading = 'Cancel deletion';
      body =
        "If you didn't request this email, no action is needed. To cancel a scheduled deletion, use the link in the confirmation email or the banner inside LeanShot.";
      testid = 'cancel-deletion-no-token';
      break;
    case 'invalid':
      heading = 'This link is no longer valid';
      body =
        "We couldn't verify this cancel link. It may have been used already or tampered with. If your account is still scheduled for deletion, use the in-app banner or contact support.";
      testid = 'cancel-deletion-invalid';
      break;
    case 'expired':
      heading = 'Your cancel window has expired';
      body =
        'The 7-day cancel window has ended for this request. If your account was finalized in error, contact help@leanshot.app within 30 days for recovery options.';
      testid = 'cancel-deletion-expired';
      break;
    case 'already':
      heading = 'No pending deletion found';
      body =
        'There is no scheduled deletion on your account right now — either it was already canceled, or it has already been finalized.';
      testid = 'cancel-deletion-already';
      break;
    case 'vault_missing':
      heading = 'Cancel link temporarily unavailable';
      body =
        "We can't verify cancel links right now. Please try again later or contact help@leanshot.app. Your scheduled deletion has NOT been processed yet.";
      testid = 'cancel-deletion-vault-missing';
      break;
    case 'unknown':
      heading = 'Something went wrong';
      body = 'We could not verify your cancel link. Please try again later or contact support.';
      testid = 'cancel-deletion-unknown';
      break;
  }

  return (
    <main
      data-testid={testid}
      className="max-w-md mx-auto px-4 py-12 flex flex-col items-center text-center gap-6"
    >
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">{heading}</h1>
      <p className="text-[15px] text-[var(--color-text-secondary)] leading-relaxed">{body}</p>
      <div className="flex items-center gap-2">{action}</div>
    </main>
  );
}

export default CancelDeletionPage;
