/**
 * Phase 5 Plan 05-02 Task 3 — SetNewPasswordForm (SC#2 second leg).
 *
 * Reached via `#/auth/set-new-password` after the user clicks the password-reset
 * email link. Supabase's PASSWORD_RECOVERY event fires (App.tsx will route the
 * user here); this form takes the new password + confirm, applies via
 * `setNewPassword` (which also signs out other devices per AUTH-04 hardening).
 *
 * Client-side regex mirrors server policy (CONF-1).
 */
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { setNewPassword } from '@/lib/auth';

const PASSWORD_REGEX = /^(?=.*\d).{8,}$/;

export function SetNewPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errPassword, setErrPassword] = useState<string | undefined>();
  const [errConfirm, setErrConfirm] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrPassword(undefined);
    setErrConfirm(undefined);
    if (!PASSWORD_REGEX.test(password)) {
      setErrPassword('8+ chars including a number');
      return;
    }
    if (password !== confirm) {
      setErrConfirm('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await setNewPassword(password);
      if (error) {
        setErrPassword(error.message);
        return;
      }
      toast('Password updated. You can sign in.', 'success');
      window.location.hash = '#/auth/signin';
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">Set a new password</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
          Choose a password you&apos;ll remember. Other signed-in devices will be signed out.
        </p>
      </header>
      <Input
        label="New password"
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
      <Input
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        leadingIcon={<KeyRound className="size-4" aria-hidden />}
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          if (errConfirm) setErrConfirm(undefined);
        }}
        error={errConfirm}
        disabled={submitting}
        aria-invalid={Boolean(errConfirm)}
      />
      <Button type="submit" block loading={submitting}>
        Update password
      </Button>
    </form>
  );
}

export default SetNewPasswordForm;
