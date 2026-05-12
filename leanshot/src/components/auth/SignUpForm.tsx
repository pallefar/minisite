/**
 * Phase 5 Plan 05-02 Task 3 — SignUpForm.
 *
 * Two branches:
 *   - **Fresh signup** (no current session): calls `signUp(email, password)` →
 *     Supabase mints a new user + verification email → `#/auth/verify-sent`.
 *   - **Anon-promotion** (D-05 / DELEG-1): on mount detects
 *     `session.user.is_anonymous`; submit calls `attachEmailToAnon(email)` (and
 *     does NOT set the password yet — that happens on the verify-landing redirect
 *     to `#/auth/signin?promote=1`).
 *
 * Client-side password policy mirrors the server (CONF-1, RESEARCH §9):
 *   `^(?=.*\d).{8,}$` — 8+ chars including at least one digit.
 */
import { Mail, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { attachEmailToAnon, getSession, signUp } from '@/lib/auth';

const PASSWORD_REGEX = /^(?=.*\d).{8,}$/;

export function SignUpForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errEmail, setErrEmail] = useState<string | undefined>();
  const [errPassword, setErrPassword] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [isAnon, setIsAnon] = useState(false);
  const toast = useToast();

  // Detect anon state on mount (D-05).
  useEffect(() => {
    let cancelled = false;
    void getSession().then(({ session }) => {
      if (cancelled) return;
      setIsAnon(Boolean(session?.user?.is_anonymous));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrEmail(undefined);
    setErrPassword(undefined);
    if (!email.trim()) {
      setErrEmail('Email is required');
      return;
    }
    if (!isAnon && !PASSWORD_REGEX.test(password)) {
      setErrPassword('8+ chars including a number');
      return;
    }
    setSubmitting(true);
    try {
      if (isAnon) {
        const { error } = await attachEmailToAnon(email.trim());
        if (error) {
          setErrEmail(error.message);
          return;
        }
        toast('We sent a verification link — click it to finish setting your password.', 'success');
      } else {
        const { error } = await signUp(email.trim(), password);
        if (error) {
          // Phase 7 Plan 07-07 (D-03): if the address collides with an
          // already-registered (or in-pending-shred-window) account,
          // surface the richer copy so the user understands the email is
          // locked for 30 days post-delete. Supabase reports both cases as
          // "User already registered" / sqlstate 23505 — we can't (and
          // shouldn't) distinguish them from the anon JWT context because
          // `pending_account_deletions` SELECT is RLS-scoped to owner. The
          // safe disposition is to ALWAYS surface the richer copy on
          // already-registered errors; legitimate "you already signed up,
          // please sign in" callers see equally valid information (the
          // mention of pending-deletion is a low-stakes hint, not PII).
          const isAlreadyRegistered =
            /already\s*registered/i.test(error.message) ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (error as any).code === '23505';
          if (isAlreadyRegistered) {
            setErrEmail(
              'This email is associated with a recently deleted account. After the 30-day window it will be released for sign-up, or contact support at help@leanshot.app to restore it.',
            );
            return;
          }
          // Map server errors to fields.
          if (/email/i.test(error.message)) setErrEmail(error.message);
          else setErrPassword(error.message);
          return;
        }
        toast('Check your email to verify your account.', 'success');
      }
      window.location.hash = '#/auth/verify-sent';
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">
          {isAnon ? 'Save your data' : 'Create your account'}
        </h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
          {isAnon
            ? "Add your email so your data syncs across devices. We'll send a verification link."
            : 'Sign up to sync your injections across every device.'}
        </p>
      </header>

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
        }}
        error={errEmail}
        disabled={submitting}
        aria-invalid={Boolean(errEmail)}
      />

      {!isAnon && (
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          leadingIcon={<KeyRound className="size-4" aria-hidden />}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errPassword) setErrPassword(undefined);
          }}
          error={errPassword}
          hint="8+ chars including a number"
          disabled={submitting}
          aria-invalid={Boolean(errPassword)}
        />
      )}

      <Button type="submit" block loading={submitting}>
        {isAnon ? 'Send verification link' : 'Create account'}
      </Button>

      <p className="text-[13px] text-center text-[var(--color-text-secondary)]">
        Already have an account?{' '}
        <a
          href="#/auth/signin"
          className="text-[var(--color-primary)] font-semibold hover:underline"
        >
          Sign in
        </a>
      </p>
    </form>
  );
}

export default SignUpForm;
