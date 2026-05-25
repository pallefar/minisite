/**
 * Phase 9 Plan 09-04 — InviteSignupForm (State D: new-user signup).
 *
 * Slim form: email is pre-filled from the lookup response (read-only) and
 * the patient supplies a password ≥ 8 chars. Submits through
 * `supabase.auth.signUp` — the single-identity serializer that mitigates
 * Pitfall #1 (race between standalone signup + invite-accept signup).
 *
 * On "User already registered" → transitions the page to State C
 * (sign-in path) by calling `onCollision()`. The parent ClinicInvitePage
 * owns the actual state-machine pivot.
 *
 * No `useStore` calls (Pitfall #9 anonymous-context rule).
 * No `s.user!` non-null assertions (project anti-pattern).
 */
import { KeyRound, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';

export interface InviteSignupFormProps {
  email: string;
  orgName: string;
  /** Called when the server reports the email is already registered (Pitfall #1 → State C). */
  onAlreadyRegistered: () => void;
  /** Called after signup succeeds (confirmation email sent). Parent renders pending state. */
  onSignupSent?: (email: string) => void;
}

export function InviteSignupForm({
  email,
  orgName,
  onAlreadyRegistered,
  onSignupSent,
}: InviteSignupFormProps) {
  const { t } = useTranslation(['clinic', 'common']);
  const [password, setPassword] = useState('');
  const [errPassword, setErrPassword] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [errToast, setErrToast] = useState<string | undefined>();

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setErrPassword(undefined);
    setErrToast(undefined);
    if (password.length < 8) {
      setErrPassword(t('clinic:invite.signup.err_password_short'));
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.href },
      });
      if (error) {
        // Pitfall #1: Supabase Auth UNIQUE(email) is the single-identity
        // serializer. On collision, transition to State C — never silently
        // create a duplicate auth.users row.
        if (/already\s*registered/i.test(error.message)) {
          onAlreadyRegistered();
          return;
        }
        setErrToast(error.message);
        return;
      }
      // Supabase signal for an email-collision under the new-user branch:
      // `data.user.identities` is an empty array on a freshly returned row
      // that maps to an existing confirmed account.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        onAlreadyRegistered();
        return;
      }
      setSent(true);
      onSignupSent?.(email);
    } catch (err) {
      setErrToast(err instanceof Error ? err.message : t('clinic:invite.signup.err_create_account'));
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async (): Promise<void> => {
    setResending(true);
    setErrToast(undefined);
    try {
      await supabase.auth.resend({ type: 'signup', email });
    } catch (err) {
      setErrToast(err instanceof Error ? err.message : t('clinic:invite.signup.err_resend'));
    } finally {
      setResending(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────
  // Confirmation-pending state
  // ────────────────────────────────────────────────────────────────────
  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-[24px] font-bold tracking-tight">{t('clinic:invite.signup.confirm_title', { email })}</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          {t('clinic:invite.signup.confirm_body', { email })}
        </p>
        {errToast && (
          <p className="text-[13px] text-[var(--color-danger)]" role="alert">
            {errToast}
          </p>
        )}
        <div>
          <Button variant="ghost" onClick={resend} loading={resending}>
            {t('clinic:invite.signup.resend')}
          </Button>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Signup form
  // ────────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">{t('clinic:invite.signup.title')}</h1>
        <p className="mt-1 text-[14px] text-[var(--color-text-secondary)]">
          {t('clinic:invite.signup.body', { orgName })}
        </p>
      </header>
      <Input
        label={t('clinic:invite.signup.label_email')}
        type="email"
        value={email}
        readOnly
        leadingIcon={<Mail className="size-4" />}
        hint={t('clinic:invite.signup.hint_email')}
        aria-readonly="true"
      />
      <Input
        label={t('clinic:invite.signup.label_password')}
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        leadingIcon={<KeyRound className="size-4" />}
        hint={t('clinic:invite.signup.hint_password')}
        error={errPassword}
      />
      {errToast && (
        <p className="text-[13px] text-[var(--color-danger)]" role="alert">
          {errToast}
        </p>
      )}
      <Button type="submit" variant="primary" loading={submitting} block>
        {t('clinic:invite.signup.cta')}
      </Button>
    </form>
  );
}

export default InviteSignupForm;
