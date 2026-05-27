/**
 * Phase 25 Plan 25-08 — SetupClinicianTotp.
 *
 * D-10 (HIPAA-15): Clinician TOTP enrollment is a HARD-CUT.
 * This component has NO "Skip", "Remind me later", or "Cancel" button.
 * Backup codes (Phase 24 admin_backup_codes) are the only escape hatch.
 *
 * Flow:
 *   1. Auto-enrolls TOTP factor on mount via enrollClinicianTotp().
 *   2. Displays QR code + base32 secret for manual entry.
 *   3. User scans QR and enters 6-digit code.
 *   4. On verify success (session now AAL2) → calls onComplete().
 *
 * SPA routing: LeanShot has no react-router. This component is rendered
 * inline by ClinicianMfaGuard — no URL navigation needed.
 */
import { useState, useEffect } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import {
  enrollClinicianTotp,
  challengeClinicianTotp,
} from '@/lib/mfa/clinician-mfa';

type Phase = 'enrolling' | 'awaiting-code' | 'verifying' | 'error';

interface SetupClinicianTotpProps {
  /** Called by ClinicianMfaGuard after successful enrollment + AAL2 elevation. */
  onComplete: () => void;
}

export default function SetupClinicianTotp({ onComplete }: SetupClinicianTotpProps) {
  const [phase, setPhase] = useState<Phase>('enrolling');
  const [errorMsg, setErrorMsg] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [factorId, setFactorId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // ---------------------------------------------------------------------------
  // Step 1: Enroll TOTP factor on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await enrollClinicianTotp();
        if (cancelled) return;
        setQrCode(result.qrCode);
        setSecret(result.secret);
        setFactorId(result.factorId);
        setPhase('awaiting-code');
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : 'Enrollment failed. Please try again.');
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; };
     
  }, []);

  // ---------------------------------------------------------------------------
  // Step 2: Challenge + verify
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (phase === 'enrolling') {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
        <Card variant="flat" padding="lg" className="max-w-md w-full text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">Setting up clinic 2FA…</p>
        </Card>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
        <Card variant="flat" padding="lg" className="max-w-md w-full">
          <CardHeader title="2FA Setup Error" />
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">{errorMsg}</p>
          <button
            type="button"
            className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
            onClick={() => { setPhase('enrolling'); setErrorMsg(''); }}
          >
            Try again
          </button>
        </Card>
      </main>
    );
  }

  // Phase: 'awaiting-code' | 'verifying'
  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
      <Card variant="flat" padding="lg" className="max-w-md w-full">
        <CardHeader title="Set up two-factor authentication" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          All clinical staff must verify their identity with a second factor before accessing
          patient data. Scan this QR code with your authenticator app (e.g. Google Authenticator,
          Authy), then enter the 6-digit code below.
        </p>

        {qrCode && (
          <div className="flex justify-center mb-4">
            <img
              src={qrCode}
              alt="Scan with your authenticator app"
              className="w-48 h-48 border border-[var(--color-border)] rounded"
            />
          </div>
        )}

        {/* Manual entry secret — collapsed by default */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowSecret((s: boolean) => !s)}
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] underline"
          >
            {showSecret ? 'Hide' : 'Show'} manual entry key
          </button>
          {showSecret && secret && (
            <p
              className="mt-2 font-mono text-xs break-all px-3 py-2 bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded"
              aria-label="Manual authenticator key"
            >
              {secret}
            </p>
          )}
        </div>

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
            <label htmlFor="clinician-totp-code" className="block text-sm font-medium mb-1.5">
              Authenticator code
            </label>
            <input
              id="clinician-totp-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              autoComplete="one-time-code"
              className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg font-mono text-lg tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              aria-label="6-digit authenticator code"
              disabled={phase === 'verifying'}
            />
          </div>

          {/* CRITICAL (D-10): NO "Skip" or "Remind me later" button here. */}
          <button
            type="submit"
            disabled={otpCode.length !== 6 || phase === 'verifying'}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={phase === 'verifying'}
          >
            {phase === 'verifying' ? 'Verifying…' : 'Activate clinic 2FA'}
          </button>
        </form>

        <p className="mt-4 text-xs text-[var(--color-text-secondary)]">
          Lost access to your authenticator? Use a backup code or contact your clinic administrator
          to reset your 2FA.
        </p>
      </Card>
    </main>
  );
}
