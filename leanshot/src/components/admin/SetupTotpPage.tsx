/**
 * Phase 24 Plan 24-05 — SetupTotpPage.
 *
 * D-06: On first admin request where profiles.has_totp is false, AdminLayout
 * renders this page instead of the admin shell. No grace window.
 *
 * D-07: TOTP via Supabase Auth mfa.enroll/challenge/verify.
 * D-08: 10 HMAC-hashed backup codes issued + shown ONCE after enrollment.
 *
 * Flow:
 *   1. Auto-enrolls the user's TOTP factor on mount.
 *   2. Displays QR code from data.totp.qr_code (data-URI from Supabase Auth).
 *   3. User scans QR + enters 6-digit OTP code.
 *   4. On verify success (session upgraded to aal2), calls admin.issue_backup_codes RPC.
 *   5. Displays the 10 backup codes ONCE (copy-to-clipboard button).
 *   6. User must check "I have saved these codes" to proceed.
 *   7. Calls admin.set_has_totp_true() RPC then redirects to /admin.
 *
 * SPA routing: LeanShot uses hash routing (no react-router). SetupTotpPage
 * is rendered inline by AdminLayout — no hash route navigation needed here.
 * AdminLayout passes `onComplete` which triggers the re-render to AdminShell.
 */
import { useState, useEffect } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { enrollTotp, verifyTotp } from '@/lib/admin/totp';

type Phase = 'enrolling' | 'awaiting-code' | 'verifying' | 'showing-codes' | 'confirming' | 'error';

interface SetupTotpPageProps {
  /** Called by AdminLayout after setup completes so the gate re-renders to AdminShell. */
  onComplete: () => void;
}

export default function SetupTotpPage({ onComplete }: SetupTotpPageProps) {
  const [phase, setPhase] = useState<Phase>('enrolling');
  const [errorMsg, setErrorMsg] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  // ---------------------------------------------------------------------------
  // Step 1: Enroll TOTP factor on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Check if a TOTP factor is already enrolled (e.g. page reload mid-flow)
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const existingTotp = factorsData?.totp?.[0];
      if (existingTotp) {
        // Already enrolled — just need to step up
        onComplete();
        return;
      }

      const result = await enrollTotp({ issuer: 'LeanShot Admin', friendlyName: 'Authenticator' });
      if (cancelled) return;
      if (result.error || !result.data) {
        setErrorMsg(result.error?.message ?? 'Enrollment failed. Please try again.');
        setPhase('error');
        return;
      }
      setQrCode(result.data.totp.qr_code);
      setFactorId(result.data.id);
      setPhase('awaiting-code');
    })().catch((e: unknown) => {
      if (!cancelled) {
        setErrorMsg(e instanceof Error ? e.message : 'Unexpected error. Please refresh.');
        setPhase('error');
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // ---------------------------------------------------------------------------
  // Step 2: Verify OTP code entered by user
  // ---------------------------------------------------------------------------
  async function handleVerify() {
    if (!otpCode || otpCode.length !== 6) return;
    setPhase('verifying');

    const result = await verifyTotp({ factorId, code: otpCode });
    if (result.error || !result.data) {
      setErrorMsg('Invalid code. Please check your authenticator app and try again.');
      setPhase('awaiting-code');
      setOtpCode('');
      return;
    }

    // Session is now aal2 — issue backup codes from server
    const { data: codesData, error: codesErr } = await supabase.rpc('issue_backup_codes');
    if (codesErr || !codesData) {
      setErrorMsg(codesErr?.message ?? 'Could not issue backup codes. Contact support.');
      setPhase('error');
      return;
    }
    setBackupCodes(codesData as string[]);
    setPhase('showing-codes');
  }

  // ---------------------------------------------------------------------------
  // Step 3: Confirm backup codes saved → set has_totp = true → complete
  // ---------------------------------------------------------------------------
  async function handleConfirm() {
    if (!savedConfirmed) return;
    setPhase('confirming');

    const { error } = await supabase.rpc('set_has_totp_true');
    if (error) {
      setErrorMsg(error.message ?? 'Failed to activate 2FA. Contact support.');
      setPhase('error');
      return;
    }
    onComplete();
  }

  async function handleCopyAll() {
    const text = backupCodes.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: select + copy via execCommand
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (phase === 'enrolling') {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
        <Card variant="flat" padding="lg" className="max-w-md w-full text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">Setting up 2FA…</p>
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
            className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
            onClick={() => { setPhase('enrolling'); setErrorMsg(''); }}
          >
            Try again
          </button>
        </Card>
      </main>
    );
  }

  if (phase === 'showing-codes' || phase === 'confirming') {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
        <Card variant="flat" padding="lg" className="max-w-lg w-full">
          <CardHeader title="Save your backup codes" />
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            These 10 codes are shown <strong>only once</strong>. If you lose access to your
            authenticator app, a backup code is the only way to regain access (or a superadmin
            can reset your 2FA).
          </p>

          <div className="grid grid-cols-2 gap-2 mb-6 font-mono text-sm">
            {backupCodes.map((code) => (
              <div
                key={code}
                className="px-3 py-2 bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded text-center"
              >
                {code}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleCopyAll}
            className="text-sm text-[var(--color-primary)] hover:underline mb-6 block"
          >
            Copy all to clipboard
          </button>

          <label className="flex items-start gap-3 mb-6 cursor-pointer">
            <input
              type="checkbox"
              checked={savedConfirmed}
              onChange={(e) => setSavedConfirmed(e.target.checked)}
              className="mt-1"
              aria-label="I have saved these backup codes in a safe place"
            />
            <span className="text-sm">
              I have saved these backup codes in a safe place. I understand they cannot be
              displayed again.
            </span>
          </label>

          <button
            type="button"
            disabled={!savedConfirmed || phase === 'confirming'}
            onClick={handleConfirm}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={phase === 'confirming'}
          >
            {phase === 'confirming' ? 'Activating…' : 'Activate 2FA'}
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
          Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy),
          then enter the 6-digit code.
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
            <label htmlFor="totp-code" className="block text-sm font-medium mb-1.5">
              Authenticator code
            </label>
            <input
              id="totp-code"
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

          <button
            type="submit"
            disabled={otpCode.length !== 6 || phase === 'verifying'}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={phase === 'verifying'}
          >
            {phase === 'verifying' ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
      </Card>
    </main>
  );
}
