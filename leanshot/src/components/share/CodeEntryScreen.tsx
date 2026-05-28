/**
 * State B — 6-digit code entry for the doctor read-share route.
 *
 * Copy strings are verbatim from `.planning/phases/08-doctor-read-share/08-UI-SPEC.md`
 * §"State B: Code entry". Auto-focus on mount; auto-submit on 6 digits per HI-3
 * UX contract; reduced-motion suppresses the shake animation per
 * UI-SPEC §"Accessibility Contract".
 *
 * INVARIANT — no Zustand store reads, no supabase client imports (verified by
 * Task 1 verify grep). The component owns its own state via `useState`.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/helpers';
import type { RedeemError } from '@/types/share';
import { redeemShare } from './share-client';

interface Props {
  token: string;
  /** Parent (SharePage) re-fires /snapshot on success to fetch patient data. */
  onSuccess: () => void;
}

const ERROR_COPY: Record<RedeemError, string> = {
  'invalid-code': "That code didn't match. Check the code and try again.",
  'rate-limited': 'Too many attempts. Wait a minute and try again.',
  'already-consumed': 'This code has already been used. Ask the patient for a new share link.',
  'not-found': "Couldn't find this share. Ask the patient for a new share link.",
  revoked: 'This share has been revoked. Ask the patient for a new share link.',
  expired: 'This share has expired. Ask the patient for a new share link.',
};

export function CodeEntryScreen({ token, onSuccess }: Props) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<RedeemError | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();

  // Auto-focus on mount per UI-SPEC §"Accessibility Contract".
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (codeValue: string): Promise<void> => {
    if (submitting || codeValue.length !== 6 || !/^\d{6}$/.test(codeValue)) return;
    setSubmitting(true);
    setError(null);
    setShake(false);
    const result = await redeemShare(token, codeValue);
    setSubmitting(false);
    if (result.ok) {
      onSuccess();
      return;
    }
    setError(result.error);
    setCode('');
    inputRef.current?.focus();
    if (!reducedMotion) {
      // One-shot pulse — toggled off after the animation duration so a
      // subsequent wrong submission re-triggers cleanly.
      setShake(true);
      window.setTimeout(() => setShake(false), 500);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(next);
    if (next.length === 6) {
      void submit(next);
    }
  };

  const handleSubmit = (e?: React.FormEvent): void => {
    e?.preventDefault();
    void submit(code);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
      <Card padding="lg" className="w-full max-w-md">
        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Enter the 6-digit code</h1>
            <p className="text-[var(--color-text-secondary)]">
              The patient shared a code with you separately. Enter it below to view their record.
            </p>
          </header>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="share-code" className="sr-only">
              6-digit access code
            </label>
            <input
              ref={inputRef}
              id="share-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={handleChange}
              aria-label="6-digit access code"
              aria-invalid={error !== null || undefined}
              placeholder="000000"
              disabled={submitting}
              className={cn(
                'h-14 w-full rounded-xl border bg-[var(--color-surface)] px-4 text-center font-mono text-3xl numerals-tabular tracking-[0.25em] transition-[border-color,box-shadow]',
                'focus:outline-none focus:border-[var(--color-primary)] focus:shadow-[0_0_0_3px_var(--color-primary-soft)]',
                error
                  ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:shadow-[0_0_0_3px_var(--color-danger-soft)]'
                  : 'border-[var(--color-border)]',
                shake && 'animate-pulse-soft',
              )}
            />
            {error && (
              <p role="alert" className="text-[13px] leading-snug text-[var(--color-danger)] mt-1">
                {ERROR_COPY[error]}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={code.length !== 6 || submitting}
            loading={submitting}
            block
          >
            View record
          </Button>

          <details className="text-[13px] text-[var(--color-text-secondary)]">
            <summary className="cursor-pointer underline decoration-[var(--color-primary)] underline-offset-4">
              What is this?
            </summary>
            <p className="mt-2 leading-snug">
              This is a read-only LeanShot share. The patient invited you to view their tracking
              data. Nothing you do here changes their data.
            </p>
          </details>
        </form>
      </Card>
    </main>
  );
}
