/**
 * Phase 25 Plan 25-08 — ClinicianMfaGuard.
 *
 * D-10 (HIPAA-15): Wraps every /clinic/* surface. Enforces AAL2 before
 * rendering clinical content.
 *
 * Gate state machine:
 *   loading   → probe session + factor list asynchronously; render nothing
 *   enroll    → user has no TOTP factor → render SetupClinicianTotp
 *   challenge → user has TOTP but session is AAL1 → render ChallengeClinicianTotp
 *   ok        → session is AAL2 → render children
 *
 * IMPORTANT — NO middleware.ts:
 *   LeanShot is a Vite SPA with hash routing. There is NO middleware.ts.
 *   Security is dual-layer (Pattern S1):
 *   1. UX layer — this component blocks render.
 *   2. DB layer — every clinical SECURITY DEFINER RPC calls assert_aal2().
 *
 * D-10: There is NO "Skip MFA" button on ANY screen this guard renders.
 * Backup codes (Phase 24 admin_backup_codes) are the only emergency escape.
 */
import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import SetupClinicianTotp from '@/components/admin/SetupClinicianTotp';
import { Card, CardHeader } from '@/components/ui/Card';
import {
  getClinicianAal,
  isClinicianTotpEnrolled,
  challengeClinicianTotp,
} from '@/lib/mfa/clinician-mfa';
import { supabase } from '@/lib/supabase';

type GateState = 'loading' | 'enroll' | 'challenge' | 'ok';

// ---------------------------------------------------------------------------
// ChallengeClinicianTotp — inline step-up for already-enrolled clinicians
// ---------------------------------------------------------------------------

interface ChallengeProps {
  onComplete: () => void;
}

function ChallengeClinicianTotp({ onComplete }: ChallengeProps) {
  type CPhase = 'loading' | 'awaiting-code' | 'verifying' | 'error';
  const [phase, setPhase] = useState<CPhase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [factorId, setFactorId] = useState('');
  const [otpCode, setOtpCode] = useState('');

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
    return () => { cancelled = true; };
  }, []);

  async function handleVerify() {
    if (!otpCode || otpCode.length !== 6) return;
    setPhase('verifying');
    setErrorMsg('');

    const result = await challengeClinicianTotp(factorId, otpCode);
    if (result.aal === 'aal2') {
      onComplete();
      return;
    }

    const msg = result.error === 'challenge_failed'
      ? 'Challenge failed. Please try again.'
      : 'Invalid code. Please check your authenticator app and try again.';
    setErrorMsg(msg);
    setPhase('awaiting-code');
    setOtpCode('');
  }

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

  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
      <Card variant="flat" padding="lg" className="max-w-md w-full">
        <CardHeader title="Verify your identity" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Enter the 6-digit code from your authenticator app to access clinical data.
        </p>

        {errorMsg && (
          <p className="text-sm text-[var(--color-error,red)] mb-3" role="alert">
            {errorMsg}
          </p>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); void handleVerify(); }}
          className="flex flex-col gap-4"
        >
          <div>
            <label htmlFor="clinician-step-up-code" className="block text-sm font-medium mb-1.5">
              Authenticator code
            </label>
            <input
              id="clinician-step-up-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              autoComplete="one-time-code"
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
            {phase === 'verifying' ? 'Verifying…' : 'Continue to clinic'}
          </button>
        </form>
      </Card>
    </main>
  );
}

// ---------------------------------------------------------------------------
// ClinicianMfaGuard — main export
// ---------------------------------------------------------------------------

interface ClinicianMfaGuardProps {
  children: ReactNode;
}

/**
 * Wraps any /clinic/* surface. Blocks render until AAL2 is confirmed.
 *
 * Usage:
 *   <ClinicianMfaGuard>
 *     <ClinicDashboard />
 *   </ClinicianMfaGuard>
 */
export function ClinicianMfaGuard({ children }: ClinicianMfaGuardProps) {
  const [state, setState] = useState<GateState>('loading');

  const runGate = async (signal: { cancelled: boolean }) => {
    const aal = await getClinicianAal();
    if (signal.cancelled) return;

    if (aal === null) {
      // No session — parent handles auth; render nothing
      return;
    }

    if (aal === 'aal2') {
      setState('ok');
      return;
    }

    // aal1 — check whether TOTP is already enrolled
    const enrolled = await isClinicianTotpEnrolled();
    if (signal.cancelled) return;

    setState(enrolled ? 'challenge' : 'enroll');
  };

  useEffect(() => {
    const signal = { cancelled: false };
    runGate(signal).catch(() => {
      if (!signal.cancelled) setState('enroll');
    });
    return () => { signal.cancelled = true; };
     
  }, []);

  if (state === 'loading') return null;

  if (state === 'enroll') {
    return (
      <SetupClinicianTotp
        onComplete={() => {
          setState('loading');
          const signal = { cancelled: false };
          runGate(signal).catch(() => setState('enroll'));
        }}
      />
    );
  }

  if (state === 'challenge') {
    return (
      <ChallengeClinicianTotp
        onComplete={() => {
          setState('loading');
          const signal = { cancelled: false };
          runGate(signal).catch(() => setState('challenge'));
        }}
      />
    );
  }

  return <>{children}</>;
}

export default ClinicianMfaGuard;
