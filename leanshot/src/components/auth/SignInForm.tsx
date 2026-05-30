/**
 * Phase 5 Plan 05-02 Task 3 — SignInForm.
 *
 * Two modes (URL search param differentiates):
 *   - **Standard signin** (`#/auth/signin`): email + password → `signIn(...)`.
 *   - **DELEG-1 promote** (`#/auth/signin?email=<x>&promote=1`): triggered by
 *     VerifyEmailLanding after the anon user's email-verify link lands. Email
 *     is pre-filled and the button calls `setPasswordOnPromoted(password)`.
 *
 * Forgot-password link → `#/auth/forgot`. Magic-link option calls
 * `signInWithMagicLink` and surfaces a confirmation toast.
 */
import { Mail, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import {
  isAppleEnabled,
  setPasswordOnPromoted,
  signInWithMagicLink,
  signInWithOAuthProvider,
} from '@/lib/auth';
import { signInWithLockout } from '@/lib/auth/sign-in-with-lockout';
import { supabase } from '@/lib/supabase';
import { SignInLockoutBanner } from './SignInLockoutBanner';

const PASSWORD_REGEX = /^(?=.*\d).{8,}$/;

function parseSearch(hash: string): URLSearchParams {
  const qs = hash.split('?')[1] ?? '';
  return new URLSearchParams(qs);
}

export function SignInForm() {
  const { t } = useTranslation(['onboarding']);
  const [params] = useState(() => parseSearch(window.location.hash));
  const isPromote = params.get('promote') === '1';
  const [email, setEmail] = useState(() => params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [errEmail, setErrEmail] = useState<string | undefined>();
  const [errPassword, setErrPassword] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [lockout, setLockout] = useState<{ lockedUntil: Date; reason: 'email' | 'ip' } | null>(
    null,
  );
  const toast = useToast();

  // Re-evaluate on hashchange (e.g., the verify-landing redirect to ?promote=1).
  useEffect(() => {
    const onChange = (): void => {
      const next = parseSearch(window.location.hash);
      const e = next.get('email');
      if (e) setEmail(e);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrEmail(undefined);
    setErrPassword(undefined);
    if (!email.trim()) {
      setErrEmail('Email is required');
      return;
    }
    if (isPromote && !PASSWORD_REGEX.test(password)) {
      setErrPassword('8+ chars including a number');
      return;
    }
    if (!isPromote && !password) {
      setErrPassword('Password is required');
      return;
    }

    setSubmitting(true);
    setLockout(null);
    try {
      if (isPromote) {
        const { error } = await setPasswordOnPromoted(password);
        if (error) {
          setErrPassword(error.message);
          return;
        }
        toast('Welcome to LeanShot — your account is ready.', 'success');
      } else {
        // AUTH-14/15: route the standard sign-in through the brute-force
        // lockout wrapper (open-on-fail — falls through to Supabase if the
        // rate-limit Fn is unreachable, so login never hard-depends on it).
        const result = await signInWithLockout(supabase, email.trim(), password);
        if (!result.ok) {
          if (result.reason === 'locked') {
            setLockout({ lockedUntil: result.lockedUntil, reason: result.lockoutReason });
          } else {
            setErrEmail('Invalid email or password.');
          }
          return;
        }
      }
      // App.tsx's selectView routes to dashboard once signedIn resolves.
      history.replaceState(null, '', window.location.pathname);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } finally {
      setSubmitting(false);
    }
  };

  const onMagicLink = async (): Promise<void> => {
    if (!email.trim()) {
      setErrEmail('Email is required for magic link');
      return;
    }
    const { error } = await signInWithMagicLink(email.trim());
    if (error) {
      toast(error.message, 'error');
    } else {
      toast('Check your email for the sign-in link.', 'success');
    }
  };

  const onApple = async (): Promise<void> => {
    setSubmitting(true);
    const { error } = await signInWithOAuthProvider('apple');
    setSubmitting(false);
    if (error) toast(error.message, 'error');
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">Sign in</h1>
        {isPromote && (
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
            Set your password to finish signing up.
          </p>
        )}
      </header>

      {lockout && <SignInLockoutBanner lockedUntil={lockout.lockedUntil} reason={lockout.reason} />}

      <Input
        label="Email"
        type="email"
        autoComplete="email"
        required
        leadingIcon={<Mail className="size-4" aria-hidden />}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (errEmail) setErrEmail(undefined);
          if (lockout) setLockout(null);
        }}
        error={errEmail}
        disabled={submitting || isPromote}
        aria-invalid={Boolean(errEmail)}
      />
      <Input
        label="Password"
        type="password"
        autoComplete={isPromote ? 'new-password' : 'current-password'}
        required
        leadingIcon={<KeyRound className="size-4" aria-hidden />}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (errPassword) setErrPassword(undefined);
        }}
        error={errPassword}
        hint={isPromote ? '8+ chars including a number' : undefined}
        disabled={submitting}
        aria-invalid={Boolean(errPassword)}
      />

      <Button type="submit" block loading={submitting}>
        {isPromote ? 'Set password' : 'Sign in'}
      </Button>

      {isAppleEnabled() && !isPromote && (
        <Button
          type="button"
          variant="ghost"
          block
          disabled={submitting}
          onClick={() => void onApple()}
          className="min-h-[44px]"
        >
          {t('onboarding:consumer.auth.sign_in_apple')}
        </Button>
      )}

      {!isPromote && (
        <div className="flex flex-col items-center gap-2 text-[13px]">
          <a
            href="#/auth/forgot"
            className="text-[var(--color-primary)] font-semibold hover:underline"
          >
            Forgot password?
          </a>
          <button
            type="button"
            onClick={onMagicLink}
            disabled={submitting}
            className="text-[var(--color-text-secondary)] hover:underline"
          >
            Email me a sign-in link instead
          </button>
        </div>
      )}
    </form>
  );
}

export default SignInForm;
