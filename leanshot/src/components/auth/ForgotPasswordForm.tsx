/**
 * Phase 5 Plan 05-02 Task 3 — ForgotPasswordForm (SC#2).
 *
 * Single email input → calls `requestPasswordReset` → Supabase emails a recovery
 * link → user clicks → lands on `#/auth/set-new-password` via the redirectTo we
 * pass in @/lib/auth `requestPasswordReset`.
 */
import { Mail } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { requestPasswordReset } from '@/lib/auth';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [errEmail, setErrEmail] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrEmail(undefined);
    if (!email.trim()) {
      setErrEmail('Email is required');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await requestPasswordReset(email.trim());
      if (error) {
        setErrEmail(error.message);
        return;
      }
      toast('Check your email for the reset link.', 'success');
      window.location.hash = '#/auth/signin';
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">Forgot password?</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
          Enter your email and we&apos;ll send you a reset link.
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
      <Button type="submit" block loading={submitting}>
        Send reset link
      </Button>
      <p className="text-[13px] text-center">
        <a href="#/auth/signin" className="text-[var(--color-primary)] hover:underline">
          Back to sign in
        </a>
      </p>
    </form>
  );
}

export default ForgotPasswordForm;
