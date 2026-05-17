/**
 * Phase 29 Plan 06 — ConsentAcceptScreen
 *
 * Patient-side consent screen rendered at `/accept-clinic-invite?token=...`.
 *
 * Flow (D-08):
 *   1. On mount: read `token` from URLSearchParams. If absent → not_found error.
 *   2. Call previewInvite(token) → show org name + scope summary + email input.
 *   3. On Accept: call acceptInvite(token, email).
 *      - On {ok: true}: window.location.assign(redirect_url) — magic-link action_url.
 *      - On {error: 'magic_link_failed'}: show recovery message + link to /login.
 *      - On {error: 'invite_not_found'}: set error='not_found'.
 *   4. On Decline: navigate to '/'.
 *
 * Anti-enumeration (T-29-06-01): 404 from /preview renders the IDENTICAL
 * EmptyState "Invite not found" for both invalid AND expired tokens.
 *
 * Bundle constraint (CLAUDE.md): lazy-loaded via App.tsx. Do NOT import eagerly.
 */

import { AlertCircle } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FieldShell } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { acceptInvite, previewInvite, type PreviewInviteData } from '@/lib/clinic-patient-invite';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Summarize the scope_summary jsonb into a human-readable list.
 * The server returns a Record<string, unknown>; we render the true-value keys.
 */
function summarizeScope(scope: Record<string, unknown>): string[] {
  const LABELS: Record<string, string> = {
    read_activity: 'Read your activity data (injections, weights, meals, mood, sleep)',
    injections: 'Read your injection logs',
    weights: 'Read your weight logs',
    photos: 'Read your progress photos',
    symptoms: 'Read your symptom logs',
    meals: 'Read your nutrition logs',
    workouts: 'Read your workout logs',
    supplements: 'Read your supplement logs',
    mood: 'Read your mood logs',
    sleep: 'Read your sleep logs',
    doctor_report: 'Access your doctor report',
  };

  return Object.entries(scope)
    .filter(([, v]) => Boolean(v))
    .map(([k]) => LABELS[k] ?? k);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ErrorKind = 'not_found' | 'network' | null;
type AcceptState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'magic_link_failed'; redirectUrl: string }
  | { phase: 'success' };

export default function ConsentAcceptScreen() {
  const [preview, setPreview] = useState<PreviewInviteData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [error, setError] = useState<ErrorKind>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [acceptState, setAcceptState] = useState<AcceptState>({ phase: 'idle' });

  const emailId = useId();

  // ── Extract token + fetch preview on mount ──────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token || token.trim() === '') {
      // Anti-enumeration: no token → same "not found" UI as invalid token.
      setError('not_found');
      setLoadingPreview(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await previewInvite(token.trim());
        if (cancelled) return;

        if (result.ok) {
          setPreview(result.data);
        } else {
          // Any error from preview (invite_not_found, expired, used) renders
          // identical "not found" EmptyState (anti-enumeration invariant).
          setError('not_found');
        }
      } catch {
        if (!cancelled) setError('network');
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Accept handler ───────────────────────────────────────────────────────
  async function handleAccept(): Promise<void> {
    if (acceptState.phase === 'submitting') return;

    // Validate email.
    if (!email.trim()) {
      setEmailError('Your email is required to accept the invite.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(null);

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') ?? '';

    setAcceptState({ phase: 'submitting' });
    try {
      const result = await acceptInvite(token.trim(), email.trim());

      if (result.ok) {
        setAcceptState({ phase: 'success' });
        // Magic-link action_url → Supabase Auth verifies → /dashboard?welcome=clinic
        window.location.assign(result.data.redirect_url);
        return;
      }

      if (result.error === 'magic_link_failed' && 'redirect_url' in result) {
        // Invite was accepted in DB but magic-link generation failed.
        // Show recovery UI with redirect_url (fallback login path).
        setAcceptState({ phase: 'magic_link_failed', redirectUrl: result.redirect_url });
        return;
      }

      if (result.error === 'invite_not_found') {
        // Anti-enumeration: re-render as "not found" (same for invalid/expired/used).
        setError('not_found');
        setAcceptState({ phase: 'idle' });
        return;
      }

      // Generic failure — reset to idle + surface message.
      setAcceptState({ phase: 'idle' });
      setEmailError('Could not accept invite. The link may have expired. Please request a new one.');
    } catch {
      setAcceptState({ phase: 'idle' });
      setEmailError('Network error. Please check your connection and try again.');
    }
  }

  // ── Render: loading ──────────────────────────────────────────────────────
  if (loadingPreview) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-11 w-32 mt-6" />
        </div>
      </div>
    );
  }

  // ── Render: error (anti-enumeration — identical UI for invalid AND expired) ─
  if (error === 'not_found') {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4">
        <Card variant="elevated" className="w-full max-w-md p-8">
          <EmptyState
            illustration={<AlertCircle size={40} aria-hidden />}
            title="Invite not found"
            body="This invite is invalid or has expired. Please ask your clinic to send a new invite."
          />
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" onClick={() => { window.location.href = '/'; }}>
              Go to LeanShot
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (error === 'network') {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4">
        <Card variant="elevated" className="w-full max-w-md p-8">
          <EmptyState
            title="Connection error"
            body="Could not load invite details. Please check your connection and try again."
            cta={
              <Button variant="primary" onClick={() => { window.location.reload(); }}>
                Try again
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  // ── Render: magic_link_failed recovery ───────────────────────────────────
  if (acceptState.phase === 'magic_link_failed') {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4">
        <Card variant="elevated" className="w-full max-w-md p-8">
          <div className="space-y-4 text-center">
            <h1 className="text-[20px] font-bold text-[var(--color-text)]">
              Invite accepted!
            </h1>
            <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
              Your invite was accepted, but we could not send a sign-in link automatically.
              Please use the link below to log in or reset your password.
            </p>
            <Button
              variant="primary"
              onClick={() => { window.location.href = acceptState.redirectUrl; }}
            >
              Sign in
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Render: preview + accept form ────────────────────────────────────────
  if (!preview) {
    // Should not reach here (loadingPreview=false + error=null + preview=null is transient).
    return null;
  }

  const scopeItems = summarizeScope(preview.scope_summary);
  const isSubmitting = acceptState.phase === 'submitting';
  const isSuccess = acceptState.phase === 'success';

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4 py-10">
      <Card variant="elevated" className="w-full max-w-lg p-8">
        {/* Org logo */}
        {preview.org_logo_url && (
          <div className="flex justify-center mb-6">
            <img
              src={preview.org_logo_url}
              alt=""
              aria-hidden
              className="h-12 w-auto object-contain rounded-lg"
            />
          </div>
        )}

        {/* Heading */}
        <h1 className="text-[22px] font-bold text-[var(--color-text)] text-center leading-snug mb-2">
          {preview.org_name}
        </h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] text-center mb-6">
          invites you to track your treatment via LeanShot
        </p>

        {/* Consent scope */}
        {scopeItems.length > 0 && (
          <div className="mb-6 rounded-xl bg-[var(--color-surface-elevated)] p-4 space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)] mb-3">
              This clinic will have access to
            </p>
            <ul className="space-y-1.5 list-none">
              {scopeItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-[var(--color-text)]">
                  <span className="mt-0.5 text-[var(--color-success)] shrink-0" aria-hidden>✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Email input (required for magic-link generation) */}
        <div className="mb-6">
          <FieldShell
            label="Your email address"
            htmlFor={emailId}
            error={emailError ?? undefined}
            required
          >
            <input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              aria-invalid={emailError !== null}
              disabled={isSubmitting || isSuccess}
              className="flex-1 min-w-0 bg-transparent py-2.5 px-3 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none"
            />
          </FieldShell>
          <p className="mt-1.5 text-[12px] text-[var(--color-text-tertiary)] leading-snug">
            Enter the email this invite was sent to. We&apos;ll send you a sign-in link.
          </p>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="primary"
            block
            loading={isSubmitting}
            disabled={isSubmitting || isSuccess}
            aria-busy={isSubmitting}
            onClick={() => { void handleAccept(); }}
            data-testid="consent-accept-button"
          >
            Accept invite
          </Button>
          <Button
            variant="secondary"
            block
            disabled={isSubmitting || isSuccess}
            onClick={() => { window.location.href = '/'; }}
          >
            Decline
          </Button>
        </div>

        <p className="mt-4 text-[11px] text-[var(--color-text-tertiary)] text-center leading-snug">
          By accepting, you consent to this clinic accessing your LeanShot data as listed above.
          You can revoke this access at any time from your account settings.
        </p>
      </Card>
    </div>
  );
}
