/**
 * Phase 66 Plan 66-03 — Shared TOTP enrollment flow (admin + consumer).
 *
 * Extracted from Phase 25 `SetupTotpPage.tsx` so both admin (forced) and
 * consumer (opt-in) surfaces share a single enrollment UX path. Copy
 * varies via the `mode` prop; the underlying Supabase Auth calls are
 * identical.
 *
 * Stages:
 *   - 'idle'          → initial state (consumer surface only; admin auto-enrolls)
 *   - 'enrolling'     → calling supabase.auth.mfa.enroll
 *   - 'awaiting-code' → QR shown, user typing 6-digit code
 *   - 'verifying'     → calling supabase.auth.mfa.challenge + verify
 *   - 'showing-codes' → backup codes shown ONCE, user must check "I saved these"
 *   - 'confirming'    → finalising (admin: set_has_totp_true RPC; consumer: noop)
 *   - 'error'         → recoverable error with retry CTA
 *
 * Backup codes:
 *   - Admin mode calls `issue_backup_codes` RPC (Phase 24 server-side HMAC).
 *   - Consumer mode generates plaintext codes client-side and persists them
 *     hashed via the `consumer_backup_codes_issue` RPC (mirrors admin flow;
 *     the RPC name is the consumer-surface convention per UI-SPEC §66-03).
 *   - In both modes plaintext is shown ONCE, never stored client-side.
 *
 * Uses `enrollTotp` + `verifyTotpChallenge` + `generateBackupCodes` from
 * Plan 66-02 `@/lib/auth/totp-shared`.
 */
import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { enrollTotp, verifyTotpChallenge } from '@/lib/auth/totp-shared';
import { supabase } from '@/lib/supabase';

export type TotpEnrollMode = 'admin' | 'consumer';

export interface TotpEnrollFlowProps {
  /**
   * Admin surface uses Phase 25 copy + auto-enrolls on mount.
   * Consumer surface uses Phase 66 opt-in copy + requires an explicit
   * "Start enrollment" click before the QR is requested.
   */
  mode: TotpEnrollMode;
  /** Called once after the user confirms they have saved their backup codes. */
  onSuccess: () => void;
  /**
   * Optional cancel handler for consumer surface (e.g. close panel without
   * enrolling). Admin surface has no cancel — enrollment is forced.
   */
  onCancel?: () => void;
}

type Stage =
  | 'idle'
  | 'enrolling'
  | 'awaiting-code'
  | 'verifying'
  | 'showing-codes'
  | 'confirming'
  | 'error';

interface Copy {
  heading: string;
  intro: string;
  startCta: string;
}

const COPY: Record<TotpEnrollMode, Copy> = {
  admin: {
    heading: 'Set up MFA for admin access',
    intro:
      'Admin access requires two-factor authentication. Scan the QR code with your authenticator app (e.g. Google Authenticator, Authy), then enter the 6-digit code.',
    startCta: 'Begin enrollment',
  },
  consumer: {
    heading: 'Add 2-factor authentication',
    intro:
      'Two-factor authentication adds a second sign-in step using a code from your phone. Scan the QR code with an authenticator app, then enter the 6-digit code to confirm.',
    startCta: 'Start setup',
  },
};

export default function TotpEnrollFlow({ mode, onSuccess, onCancel }: TotpEnrollFlowProps) {
  // Admin surface auto-enrolls (Phase 25 behaviour preserved).
  // Consumer surface starts at 'idle' and waits for explicit user click.
  const [stage, setStage] = useState<Stage>(mode === 'admin' ? 'enrolling' : 'idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const copy = COPY[mode];

  // ---------------------------------------------------------------------------
  // Enrollment step — start QR-code generation.
  //
  // Admin: runs on mount (auto-enrolls).
  // Consumer: runs after user clicks "Start setup" (stage transitions to
  //           'enrolling' in the click handler).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (stage !== 'enrolling') return;
    let cancelled = false;

    (async () => {
      // If a TOTP factor is already enrolled (e.g. page reload mid-flow),
      // short-circuit — admin surface treats this as "already done", consumer
      // surface should never hit this path because SecuritySettingsPage gates
      // entry on listEnrolledFactors().length === 0, but guard anyway.
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const existingTotp = factorsData?.totp?.[0];
      if (existingTotp && existingTotp.status === 'verified') {
        if (!cancelled) onSuccess();
        return;
      }

      const result = await enrollTotp({
        issuer: mode === 'admin' ? 'LeanShot Admin' : 'LeanShot',
        friendlyName: 'Authenticator',
      });
      if (cancelled) return;
      if (result.error || !result.data) {
        setErrorMsg(result.error?.message ?? 'Enrollment failed. Please try again.');
        setStage('error');
        return;
      }
      setQrCode(result.data.totp.qr_code);
      setFactorId(result.data.id);
      setStage('awaiting-code');
    })().catch((e: unknown) => {
      if (!cancelled) {
        setErrorMsg(e instanceof Error ? e.message : 'Unexpected error. Please refresh.');
        setStage('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [stage, mode, onSuccess]);

  // ---------------------------------------------------------------------------
  // Verify the 6-digit code, then issue backup codes server-side.
  // ---------------------------------------------------------------------------
  async function handleVerify() {
    if (otpCode.length !== 6 || stage === 'verifying') return;
    setStage('verifying');
    setErrorMsg('');

    const verifyResult = await verifyTotpChallenge({ factorId, code: otpCode });
    if (!verifyResult.ok) {
      setErrorMsg(
        verifyResult.error?.message ??
          'Invalid code. Please check your authenticator app and try again.',
      );
      setStage('awaiting-code');
      setOtpCode('');
      return;
    }

    // Session is now aal2 — issue backup codes from server. Admin surface uses
    // the Phase 24 RPC; consumer surface uses the Phase 66 consumer RPC. The
    // consumer RPC ships in Plan 66-01 / 66-02 schema; if not yet deployed at
    // runtime the call will 404 and the user sees a recoverable error.
    const rpcName = mode === 'admin' ? 'issue_backup_codes' : 'consumer_backup_codes_issue';
    const { data: codesData, error: codesErr } = await supabase.rpc(rpcName);
    if (codesErr || !codesData) {
      setErrorMsg(codesErr?.message ?? 'Could not issue backup codes. Contact support.');
      setStage('error');
      return;
    }
    setBackupCodes(codesData as string[]);
    setStage('showing-codes');
  }

  // ---------------------------------------------------------------------------
  // Confirm backup codes saved → finalise → fire onSuccess.
  // ---------------------------------------------------------------------------
  async function handleConfirm() {
    if (!savedConfirmed || stage === 'confirming') return;
    setStage('confirming');

    if (mode === 'admin') {
      const { error } = await supabase.rpc('set_has_totp_true');
      if (error) {
        setErrorMsg(error.message ?? 'Failed to activate 2FA. Contact support.');
        setStage('error');
        return;
      }
    }
    // Consumer mode: no profile flag flip required — `listEnrolledFactors`
    // is the source of truth for "is the user MFA-enabled?".
    onSuccess();
  }

  // ---------------------------------------------------------------------------
  // Download backup codes as a TXT file.
  // ---------------------------------------------------------------------------
  function handleDownload() {
    const text = [
      'LeanShot 2-factor authentication — backup codes',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Store these somewhere safe. Each code can be used ONCE if you lose access',
      'to your authenticator app. Codes cannot be displayed again.',
      '',
      ...backupCodes,
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leanshot-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Render branches.
  // ---------------------------------------------------------------------------

  if (stage === 'idle') {
    return (
      <Card variant="flat" padding="lg" className="max-w-md w-full">
        <CardHeader title={copy.heading} />
        <p className="text-sm text-text-secondary mb-4">{copy.intro}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStage('enrolling')}
            className="py-2.5 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm"
          >
            {copy.startCta}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="py-2.5 px-4 rounded-lg border border-border text-text font-semibold text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </Card>
    );
  }

  if (stage === 'enrolling') {
    return (
      <Card variant="flat" padding="lg" className="max-w-md w-full text-center">
        <p className="text-sm text-text-secondary" role="status">
          Setting up 2FA…
        </p>
      </Card>
    );
  }

  if (stage === 'error') {
    return (
      <Card variant="flat" padding="lg" className="max-w-md w-full">
        <CardHeader title="2FA Setup Error" />
        <p className="text-sm text-text-secondary mb-4" role="alert">
          {errorMsg}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setErrorMsg('');
              setStage(mode === 'admin' ? 'enrolling' : 'idle');
            }}
            className="py-2.5 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm"
          >
            Try again
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="py-2.5 px-4 rounded-lg border border-border text-text font-semibold text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </Card>
    );
  }

  if (stage === 'showing-codes' || stage === 'confirming') {
    return (
      <Card variant="flat" padding="lg" className="max-w-lg w-full">
        <CardHeader title="Save your backup codes" />
        <p className="text-sm text-text-secondary mb-4">
          These 10 codes are shown <strong>only once</strong>. If you lose access to your
          authenticator app, a backup code is the only way to regain access.
        </p>

        <div
          className="grid grid-cols-2 gap-2 mb-4 font-mono text-sm"
          data-testid="backup-codes-list"
        >
          {backupCodes.map((code) => (
            <div
              key={code}
              className="px-3 py-2 bg-surface-soft border border-border rounded text-center"
            >
              {code}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleDownload}
          className="text-sm font-semibold text-primary hover:underline mb-4 block"
        >
          Download codes
        </button>

        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={savedConfirmed}
            onChange={(e) => setSavedConfirmed(e.target.checked)}
            className="mt-1"
            aria-label="I have saved these backup codes in a safe place"
          />
          <span className="text-sm">
            I have saved these backup codes in a safe place. I understand they cannot be displayed
            again.
          </span>
        </label>

        <button
          type="button"
          disabled={!savedConfirmed || stage === 'confirming'}
          onClick={handleConfirm}
          className="w-full py-2.5 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          aria-busy={stage === 'confirming'}
        >
          {stage === 'confirming' ? 'Activating…' : "I've saved these"}
        </button>
      </Card>
    );
  }

  // stage === 'awaiting-code' | 'verifying'
  return (
    <Card variant="flat" padding="lg" className="max-w-md w-full">
      <CardHeader title={copy.heading} />
      <p className="text-sm text-text-secondary mb-4">{copy.intro}</p>

      {qrCode && (
        <div className="flex justify-center mb-4">
          <img
            src={qrCode}
            alt="Scan with your authenticator app"
            className="w-48 h-48 border border-border rounded"
          />
        </div>
      )}

      {errorMsg && (
        <p className="text-sm text-danger mb-3" role="alert">
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
          <label htmlFor="totp-code" className="block text-sm font-semibold mb-1.5">
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
            className="w-full px-3 py-2 border border-border rounded-lg font-mono text-lg tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="6-digit authenticator code"
            disabled={stage === 'verifying'}
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={otpCode.length !== 6 || stage === 'verifying'}
            className="flex-1 py-2.5 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={stage === 'verifying'}
          >
            {stage === 'verifying' ? 'Verifying…' : 'Verify and continue'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="py-2.5 px-4 rounded-lg border border-border text-text font-semibold text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
