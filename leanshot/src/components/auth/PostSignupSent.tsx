/**
 * Phase 5 Plan 05-02 Task 3 — PostSignupSent (verify-sent interstitial).
 *
 * Surfaces after a successful `signUp` or `attachEmailToAnon` POST. Shows the
 * "check your email" copy + a Resend button + a Back-to-signin link. Reads
 * the most recent email via `getUser()` so the user sees confirmation of which
 * inbox to check.
 */
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { getUser, resendVerification } from '@/lib/auth';

export function PostSignupSent() {
  const [email, setEmail] = useState<string>('');
  const [resending, setResending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void getUser().then(({ user }) => {
      if (user?.email) setEmail(user.email);
    });
  }, []);

  const onResend = async (): Promise<void> => {
    if (!email) {
      toast('No email on file to resend to.', 'error');
      return;
    }
    setResending(true);
    try {
      const { error } = await resendVerification(email);
      if (error) toast(error.message, 'error');
      else toast('Verification email re-sent.', 'success');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 text-center py-8">
      <Mail className="size-12 mx-auto text-[var(--color-primary)]" aria-hidden />
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">Check your email</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-2">
          {email ? (
            <>
              We sent a verification link to <strong>{email}</strong>. Click it to finish setting
              up your account.
            </>
          ) : (
            <>We sent a verification link to your email. Click it to finish setting up.</>
          )}
        </p>
      </header>
      <Button onClick={onResend} loading={resending} variant="secondary" block>
        Resend email
      </Button>
      <p className="text-[13px]">
        <a href="#/auth/signin" className="text-[var(--color-primary)] hover:underline">
          Back to sign in
        </a>
      </p>
    </div>
  );
}

export default PostSignupSent;
