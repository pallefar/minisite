/**
 * Phase 5 Plan 05-02 Task 3 — VerifyEmailLanding.
 *
 * Three states (UI-SPEC §4 + RESEARCH §2 DELEG-1):
 *   - **loading**: spinner while supabase-js parses the email-link token (auto-
 *     detected via `detectSessionInUrl: true` in supabase client config).
 *   - **success**:
 *     - DELEG-1 branch: `user.last_sign_in_at == null` (freshly-promoted anon
 *       OR fresh signup that hasn't completed signin) → redirect to
 *       `#/auth/signin?email=<encoded>&promote=1` (pre-fill + contextual copy).
 *     - Returning user (`last_sign_in_at` already populated): redirect to
 *       dashboard.
 *   - **error**: "Verification link expired or invalid" + Resend button.
 *
 * 5-second timeout safeguard — if `getSession` keeps returning null we treat
 * it as an expired token rather than spinning forever.
 */
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { getSession, resendVerification } from '@/lib/auth';

type Phase = 'loading' | 'success' | 'error';

export function VerifyEmailLanding() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [resendEmail, setResendEmail] = useState('');
  const toast = useToast();
  const settled = useRef(false);

  useEffect(() => {
    const tick = async (): Promise<void> => {
      if (settled.current) return;
      const { session } = await getSession();
      const user = session?.user;
      if (user?.email_confirmed_at) {
        settled.current = true;
        // DELEG-1 routing — has user signed in before with this credential?
        const isFreshlyPromoted = user.last_sign_in_at == null;
        setPhase('success');
        setTimeout(() => {
          if (isFreshlyPromoted) {
            const enc = encodeURIComponent(user.email ?? '');
            window.location.hash = `#/auth/signin?email=${enc}&promote=1`;
          } else {
            // Returning user — leave auth and let selectView route to dashboard.
            history.replaceState(null, '', window.location.pathname);
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }
        }, 1500);
      }
    };

    // Poll up to 5s in 250ms increments. supabase-js's detectSessionInUrl is
    // synchronous post-parse, but the onAuthStateChange dispatch is microtask-
    // queued — so the very first tick may miss it.
    let elapsed = 0;
    const POLL = 250;
    const MAX = 5000;
    const handle = window.setInterval(() => {
      elapsed += POLL;
      void tick();
      if (elapsed >= MAX && !settled.current) {
        window.clearInterval(handle);
        settled.current = true;
        setPhase('error');
      }
    }, POLL);

    return () => {
      window.clearInterval(handle);
    };
  }, []);

  if (phase === 'loading') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <Loader2 className="size-8 animate-spin text-[var(--color-primary)]" aria-hidden />
        <p className="text-[14px] text-[var(--color-text-secondary)]">Verifying your email…</p>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <CheckCircle2 className="size-10 text-[var(--color-success)]" aria-hidden />
        <h1 className="text-[22px] font-bold tracking-tight">Email verified</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Redirecting you to sign in…
        </p>
      </div>
    );
  }

  const onResend = async (): Promise<void> => {
    if (!resendEmail.trim()) {
      toast('Email is required', 'error');
      return;
    }
    const { error } = await resendVerification(resendEmail.trim());
    if (error) toast(error.message, 'error');
    else toast('Verification email sent.', 'success');
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="text-center">
        <XCircle className="size-10 mx-auto text-[var(--color-danger)]" aria-hidden />
        <h1 className="text-[22px] font-bold tracking-tight mt-2">
          Verification link expired or invalid
        </h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
          Enter your email below and we&apos;ll send a new link.
        </p>
      </header>
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        value={resendEmail}
        onChange={(e) => setResendEmail(e.target.value)}
      />
      <Button onClick={onResend} block>
        Resend verification
      </Button>
      <p className="text-[13px] text-center">
        <a href="#/auth/signin" className="text-[var(--color-primary)] hover:underline">
          Back to sign in
        </a>
      </p>
    </div>
  );
}

export default VerifyEmailLanding;
