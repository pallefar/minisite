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
import { Mail, KeyRound, Ticket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import {
  attachEmailToAnon,
  getSession,
  isAppleEnabled,
  isFacebookEnabled,
  isGoogleEnabled,
  signInWithOAuthProvider,
  signUp,
} from '@/lib/auth';
import { useFeatureFlag } from '@/lib/feature-flags';

const PASSWORD_REGEX = /^(?=.*\d).{8,}$/;
// Phase 19 Plan 19-04 (BL-1 / D-23) — same regex as stripe-checkout +
// affiliate-attribute. Empty input is valid (the field is optional).
const REFERRAL_CODE_REGEX = /^[a-z0-9-]{4,80}$/;
// sessionStorage key picked up by the post-signup checkout-redirect flow
// (and by any future ?aff_manual=<code> propagation point). Phase 19 Plan
// 19-09 consumes this; key namespace mirrors leanshot_anthropic_key etc.
const AFF_MANUAL_SESSION_KEY = 'leanshot_aff_manual';

export function SignUpForm() {
  const { t } = useTranslation(['onboarding']);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errEmail, setErrEmail] = useState<string | undefined>();
  const [errPassword, setErrPassword] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [isAnon, setIsAnon] = useState(false);
  // Phase 19 Plan 19-04 (BL-1 / D-23) — referral-code field gated by flag.
  const showAffManual = useFeatureFlag('aff_manual_entry');
  const [affManual, setAffManual] = useState('');
  const [errAffManual, setErrAffManual] = useState<string | undefined>();
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
    setErrAffManual(undefined);
    if (!email.trim()) {
      setErrEmail('Email is required');
      return;
    }
    if (!isAnon && !PASSWORD_REGEX.test(password)) {
      setErrPassword('8+ chars including a number');
      return;
    }
    // Phase 19 Plan 19-04 (BL-1 / D-23) — referral code is optional, but if
    // present must match the format used downstream by stripe-checkout +
    // affiliate-attribute. Empty input → skip; invalid → inline error + bail.
    const trimmedAff = affManual.trim();
    if (showAffManual && trimmedAff.length > 0 && !REFERRAL_CODE_REGEX.test(trimmedAff)) {
      setErrAffManual('Use 4–80 lowercase letters, digits, or dashes.');
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
          // Phase 7 Plan 07-07 (D-03) → Phase 22 Plan 22-05: if the address
          // collides with an already-registered (or in-pending-shred-window)
          // account, surface the richer copy so the user understands the
          // email is locked for 7 days post-delete (Conflict #2: window was
          // 30d in Phase 7; backend cron is now 7d per 22-01 File 01).
          // Supabase reports both cases as
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
              'This email is associated with a recently deleted account. After the 7-day window it will be released for sign-up, or contact support at help@leanshot.app to restore it.',
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
      // Phase 19 Plan 19-04 (BL-1 / D-23) — stash the manual referral code
      // (when present + valid) for the post-verify checkout-redirect step to
      // append as `?aff_manual=<code>`. Wrapped in try/catch because private-
      // mode browsers throw on sessionStorage access (same pattern as the
      // localStorage wrappers in src/main.tsx + src/hooks/useTheme.ts).
      if (showAffManual && trimmedAff.length > 0) {
        try {
          sessionStorage.setItem(AFF_MANUAL_SESSION_KEY, trimmedAff);
        } catch {
          /* noop — best-effort */
        }
      }
      window.location.hash = '#/auth/verify-sent';
    } finally {
      setSubmitting(false);
    }
  };

  const onApple = async (): Promise<void> => {
    setSubmitting(true);
    const { error } = await signInWithOAuthProvider('apple');
    setSubmitting(false);
    if (error) toast(error.message, 'error');
  };

  const onGoogle = async (): Promise<void> => {
    setSubmitting(true);
    const { error } = await signInWithOAuthProvider('google');
    setSubmitting(false);
    if (error) toast(error.message, 'error');
  };

  const onFacebook = async (): Promise<void> => {
    setSubmitting(true);
    const { error } = await signInWithOAuthProvider('facebook');
    setSubmitting(false);
    if (error) toast(error.message, 'error');
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

      {showAffManual && !isAnon && (
        <Input
          label="Referral code (optional)"
          type="text"
          autoComplete="off"
          leadingIcon={<Ticket className="size-4" aria-hidden />}
          value={affManual}
          onChange={(e) => {
            setAffManual(e.target.value);
            if (errAffManual) setErrAffManual(undefined);
          }}
          error={errAffManual}
          placeholder="coachjane-a3f2"
          hint="If a coach or partner shared a referral link, paste their code here."
          disabled={submitting}
          aria-invalid={Boolean(errAffManual)}
        />
      )}

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

      {isAppleEnabled() && !isAnon && (
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

      {isGoogleEnabled() && !isAnon && (
        <Button
          type="button"
          variant="ghost"
          block
          disabled={submitting}
          onClick={() => void onGoogle()}
          className="min-h-[44px]"
        >
          {t('onboarding:consumer.auth.continue_google')}
        </Button>
      )}

      {isFacebookEnabled() && !isAnon && (
        <Button
          type="button"
          variant="ghost"
          block
          disabled={submitting}
          onClick={() => void onFacebook()}
          className="min-h-[44px]"
        >
          {t('onboarding:consumer.auth.continue_facebook')}
        </Button>
      )}

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
