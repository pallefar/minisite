/**
 * Phase 24 Plan 24-05 — StepUpTotpPage.
 *
 * D-09: every admin session requires aal2 step-up (re-prompted every sign-in).
 * No "trust this device" cookie. Shown after AdminLayout confirms aal='aal1'.
 *
 * Flow:
 *   1. Lists the user's enrolled TOTP factors via mfa.listFactors().
 *   2. If no factors found, redirects to SetupTotpPage (shouldn't happen in normal flow).
 *   3. Challenges the first TOTP factor.
 *   4. User enters 6-digit OTP code.
 *   5. On verify success (session upgraded to aal2), calls onComplete().
 *
 * SPA routing: LeanShot uses hash routing. StepUpTotpPage is rendered inline
 * by AdminLayout when aal='aal1'. `next` prop allows restoring the intended path
 * after successful step-up (stored in AdminLayout's own state).
 *
 * SECURITY NOTE (Pattern S1 server layer):
 * This component is the UX-layer aal2 gate only. Every admin SECURITY DEFINER
 * Postgres function independently checks `(auth.jwt() ->> 'aal') = 'aal2'`
 * so a bypassed or missing client-side check cannot escalate privileges.
 */
import { useState, useEffect } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

type Phase = 'loading' | 'awaiting-code' | 'verifying' | 'error';

interface StepUpTotpPageProps {
  /** Called on successful aal2 step-up so AdminLayout re-renders the shell. */
  onComplete: () => void;
  /** The path the user was trying to access (informational only). */
  next?: string;
}

export default function StepUpTotpPage({ onComplete, next: _next }: StepUpTotpPageProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [factorId, setFactorId] = useState('');
  const [otpCode, setOtpCode] = useState('');

  // ---------------------------------------------------------------------------
  // Step 1: Resolve the enrolled TOTP factor
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (error || !data) {
        setErrorMsg('Could not load your 2FA factors. Please refresh.');
        setPhase('error');
        return;
      }
      const totp = data.totp?.[0];
      if (!totp) {
        // No TOTP factor — shouldn't reach here normally (AdminLayout gates on has_totp first)
        setErrorMsg('No 2FA factor found. Please complete initial setup.');
        setPhase('error');
        return;
      }
      setFactorId(totp.id);
      setPhase('awaiting-code');
    })().catch((e: unknown) => {
      if (!cancelled) {
        setErrorMsg(e instanceof Error ? e.message : 'Unexpected error. Please refresh.');
        setPhase('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Step 2: Challenge + verify
  // ---------------------------------------------------------------------------
  async function handleVerify() {
    if (!otpCode || otpCode.length !== 6) return;
    setPhase('verifying');

    // Challenge
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error || !ch.data) {
      setErrorMsg('Challenge failed. Please try again.');
      setPhase('awaiting-code');
      setOtpCode('');
      return;
    }

    // Verify
    const verify = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.data.id,
      code: otpCode,
    });
    if (verify.error || !verify.data) {
      setErrorMsg('Invalid code. Please check your authenticator app and try again.');
      setPhase('awaiting-code');
      setOtpCode('');
      return;
    }

    // Session upgraded to aal2 — proceed
    onComplete();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (phase === 'loading') {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
        <Card variant="flat" padding="lg" className="max-w-md w-full text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
        </Card>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
        <Card variant="flat" padding="lg" className="max-w-md w-full">
          <CardHeader title="Authentication error" />
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">{errorMsg}</p>
          <button
            type="button"
            className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
            onClick={() => window.location.reload()}
          >
            Refresh page
          </button>
        </Card>
      </main>
    );
  }

  // Phase: 'awaiting-code' | 'verifying'
  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
      <Card variant="flat" padding="lg" className="max-w-md w-full">
        <CardHeader title="Verify your identity" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Enter the 6-digit code from your authenticator app to access the admin panel.
        </p>

        {errorMsg && (
          <p className="text-sm text-[var(--color-error,red)] mb-3" role="alert">
            {errorMsg}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleVerify();
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <label htmlFor="step-up-code" className="block text-sm font-medium mb-1.5">
              Authenticator code
            </label>
            <input
              id="step-up-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              autoComplete="one-time-code"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional UX: step-up TOTP entry is sole interactive element; immediate focus expected.
              autoFocus
              className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg font-mono text-lg tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              aria-label="6-digit authenticator code"
              disabled={phase === 'verifying'}
            />
          </div>

          <button
            type="submit"
            disabled={otpCode.length !== 6 || phase === 'verifying'}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={phase === 'verifying'}
          >
            {phase === 'verifying' ? 'Verifying…' : 'Continue to admin'}
          </button>
        </form>
      </Card>
    </main>
  );
}
