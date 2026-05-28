/**
 * Phase 25 Plan 25-08 — PatientMfaCard.
 *
 * D-11 (HIPAA-15): Optional TOTP enrollment card in patient Settings.
 * This card is informational — it NEVER blocks access.
 * The user can dismiss / ignore it entirely.
 *
 * States:
 *   idle-not-enrolled → shows enrollment CTA
 *   enrolling         → shows QR + secret + 6-digit input
 *   idle-enrolled     → shows enrolled badge + Disable button
 *   disabling         → confirm dialog before unenroll
 *
 * Security: unenroll requires an explicit confirmation. No step-up required
 * because patient MFA is optional by D-11 — forcing a step-up to disable
 * optional MFA would be circular.
 */
import { Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { challengeClinicianTotp } from '@/lib/mfa/clinician-mfa';
import {
  isPatientTotpEnrolled,
  enrollPatientTotp,
  unenrollPatientTotp,
} from '@/lib/mfa/patient-mfa';
import { supabase } from '@/lib/supabase';

type CardState =
  | 'loading'
  | 'idle-not-enrolled'
  | 'enrolling'
  | 'awaiting-verify'
  | 'verifying'
  | 'idle-enrolled'
  | 'confirm-disable'
  | 'disabling';

export function PatientMfaCard() {
  const toast = useToast();

  const [cardState, setCardState] = useState<CardState>('loading');
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  // For disable flow, we need to get the existing factor ID from listFactors
  const [enrolledFactorId, setEnrolledFactorId] = useState('');

  // ---------------------------------------------------------------------------
  // Check current enrollment status on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const enrolled = await isPatientTotpEnrolled();
        if (cancelled) return;
        if (enrolled) {
          // Get the factor ID for potential disable flow
          const { data } = await supabase.auth.mfa.listFactors();
          if (!cancelled) {
            const totp = data?.totp?.[0];
            if (totp) setEnrolledFactorId(totp.id);
          }
        }
        if (!cancelled) setCardState(enrolled ? 'idle-enrolled' : 'idle-not-enrolled');
      } catch {
        if (!cancelled) setCardState('idle-not-enrolled');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  async function handleStartEnroll() {
    setCardState('enrolling');
    setErrorMsg('');
    try {
      const result = await enrollPatientTotp();
      setFactorId(result.factorId);
      setQrCode(result.qrCode);
      setSecret(result.secret);
      setCardState('awaiting-verify');
    } catch {
      setErrorMsg('Could not start enrollment. Please try again.');
      setCardState('idle-not-enrolled');
    }
  }

  async function handleVerify() {
    if (!otpCode || otpCode.length !== 6) return;
    setCardState('verifying');
    setErrorMsg('');

    const result = await challengeClinicianTotp(factorId, otpCode);
    if (result.aal === 'aal2') {
      toast('Authenticator app linked successfully.', 'success');
      setOtpCode('');
      setCardState('idle-enrolled');
      return;
    }
    const msg =
      result.error === 'challenge_failed'
        ? 'Challenge failed. Please try again.'
        : 'Invalid code. Please check your authenticator app.';
    setErrorMsg(msg);
    setCardState('awaiting-verify');
    setOtpCode('');
  }

  async function handleDisable() {
    if (!enrolledFactorId) return;
    setCardState('disabling');
    try {
      await unenrollPatientTotp(enrolledFactorId);
      toast('Authenticator app removed.', 'success');
      setEnrolledFactorId('');
      setCardState('idle-not-enrolled');
    } catch {
      toast('Could not remove authenticator. Please try again.', 'error');
      setCardState('idle-enrolled');
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (cardState === 'loading') {
    return (
      <Card variant="flat" padding="lg">
        <div className="h-16 animate-pulse bg-[var(--color-surface-elevated)] rounded" />
      </Card>
    );
  }

  if (cardState === 'idle-not-enrolled') {
    return (
      <Card variant="flat" padding="lg">
        <CardHeader
          title="Two-factor authentication"
          icon={<Shield className="size-4 text-[var(--color-text-secondary)]" aria-hidden />}
        />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Add an extra layer of security to your account. Linking an authenticator app means
          you&apos;ll need a 6-digit code in addition to your password when signing in from a new
          device. <span className="font-medium">This is optional.</span>
        </p>
        <Button variant="secondary" onClick={() => void handleStartEnroll()}>
          Set up authenticator app
        </Button>
      </Card>
    );
  }

  if (cardState === 'enrolling') {
    return (
      <Card variant="flat" padding="lg">
        <CardHeader title="Setting up…" />
        <p className="text-sm text-[var(--color-text-secondary)]">Preparing your QR code…</p>
      </Card>
    );
  }

  if (cardState === 'awaiting-verify' || cardState === 'verifying') {
    return (
      <Card variant="flat" padding="lg">
        <CardHeader title="Link your authenticator app" />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
        </p>

        {qrCode && (
          <div className="flex justify-center mb-4">
            <img
              src={qrCode}
              alt="Scan with your authenticator app"
              className="w-40 h-40 border border-[var(--color-border)] rounded"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowSecret((s: boolean) => !s)}
          className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] underline mb-4 block"
        >
          {showSecret ? 'Hide' : 'Show'} manual entry key
        </button>
        {showSecret && secret && (
          <p className="font-mono text-xs break-all px-3 py-2 bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded mb-4">
            {secret}
          </p>
        )}

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
          className="flex flex-col gap-3"
        >
          <div>
            <label htmlFor="patient-mfa-code" className="block text-sm font-medium mb-1.5">
              Authenticator code
            </label>
            <input
              id="patient-mfa-code"
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
              disabled={cardState === 'verifying'}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={otpCode.length !== 6 || cardState === 'verifying'}
              loading={cardState === 'verifying'}
            >
              {cardState === 'verifying' ? 'Verifying…' : 'Confirm'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOtpCode('');
                setErrorMsg('');
                setCardState('idle-not-enrolled');
              }}
              disabled={cardState === 'verifying'}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  if (cardState === 'confirm-disable') {
    return (
      <Card variant="flat" padding="lg">
        <CardHeader
          title="Remove authenticator app?"
          icon={<ShieldOff className="size-4 text-[var(--color-error,red)]" aria-hidden />}
        />
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          This will remove the authenticator app from your account. Sensitive actions (like account
          deletion) will fall back to email verification.
        </p>
        <div className="flex gap-2">
          <Button variant="destructive" onClick={() => void handleDisable()}>
            Remove
          </Button>
          <Button variant="ghost" onClick={() => setCardState('idle-enrolled')}>
            Keep authenticator
          </Button>
        </div>
      </Card>
    );
  }

  // idle-enrolled | disabling
  return (
    <Card variant="flat" padding="lg">
      <CardHeader
        title="Two-factor authentication"
        icon={<ShieldCheck className="size-4 text-green-600" aria-hidden />}
      />
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-xs font-semibold border border-green-200">
          <ShieldCheck className="size-3" aria-hidden />
          Authenticator app active
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        Your account is protected with an authenticator app. Sensitive actions also require this
        code.
      </p>
      <Button
        variant="ghost"
        onClick={() => setCardState('confirm-disable')}
        disabled={cardState === 'disabling'}
      >
        Remove authenticator app
      </Button>
    </Card>
  );
}
