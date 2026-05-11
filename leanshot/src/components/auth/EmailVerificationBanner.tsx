/**
 * Phase 5 Plan 05-02 Task 3 — EmailVerificationBanner (D-13 / AUTH-06).
 *
 * Renders only when:
 *   - signedIn.user is permanent (not anonymous), AND
 *   - signedIn.user.email_confirmed_at is null/undefined, AND
 *   - `verificationBannerDismissedUntil` is absent OR in the past.
 *
 * Two CTAs: "Resend verification" + "Dismiss for today" (24h dismiss).
 * The dismiss state is persisted via the Zustand store partialize bump so it
 * survives reloads.
 */
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { resendVerification } from '@/lib/auth';
import { useStore } from '@/lib/store';

export function EmailVerificationBanner() {
  const signedIn = useStore((s) => s.signedIn);
  const dismissedUntil = useStore((s) => s.verificationBannerDismissedUntil);
  const dismiss = useStore((s) => s.dismissVerificationBanner);
  const toast = useToast();
  const [resending, setResending] = useState(false);

  const user = signedIn?.user;
  const isPermanent = user && !user.is_anonymous;
  const isUnverified = isPermanent && !user.email_confirmed_at;
  const isDismissed =
    dismissedUntil != null && new Date(dismissedUntil).getTime() > Date.now();

  if (!isUnverified || isDismissed) return null;

  const onResend = async (): Promise<void> => {
    if (!user.email) {
      toast('No email on file', 'error');
      return;
    }
    setResending(true);
    try {
      const { error } = await resendVerification(user.email);
      if (error) toast(error.message, 'error');
      else toast('Verification email sent.', 'success');
    } finally {
      setResending(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Email verification reminder"
      className="mb-5 rounded-xl border border-[var(--color-warning,#a36a00)] bg-[var(--color-warning-soft,rgba(255,189,89,0.12))] p-3.5 flex items-start gap-3"
    >
      <AlertCircle className="size-5 shrink-0 mt-0.5 text-[var(--color-warning,#a36a00)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">Verify your email to sync across devices</p>
        <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5 leading-snug">
          We sent a verification link to <strong>{user.email ?? 'your email'}</strong>. Until then,
          your data only lives on this device.
        </p>
        <div className="flex gap-2 mt-2.5">
          <Button size="sm" variant="secondary" onClick={onResend} loading={resending}>
            Resend
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Dismiss for today
          </Button>
        </div>
      </div>
    </div>
  );
}

export default EmailVerificationBanner;
