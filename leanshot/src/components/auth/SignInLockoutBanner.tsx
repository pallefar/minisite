/**
 * SignInLockoutBanner.tsx — countdown banner shown when sign-in is rate-limited.
 *
 * Phase 66 Plan 66-05 (AUTH-14 + AUTH-15).
 *
 * Props:
 *   - `lockedUntil`: ISO Date when the lockout expires.
 *   - `reason`: 'email' (this email is locked) | 'ip' (this network is locked).
 *
 * Behavior:
 *   - Renders a red banner with `MM:SS` countdown that ticks every second.
 *   - When the countdown reaches `0` it auto-hides (returns null).
 *   - Magic-link CTA points at `#/auth/forgot` (which surfaces the magic-link
 *     option) — per 66-CONTEXT §Specific Ideas, magic link is the documented
 *     backup auth path.
 *   - `prefers-reduced-motion` is respected via plain CSS (no framer-motion
 *     animation here; the countdown is text-only).
 *
 * Theme tokens (verified against `src/index.css`):
 *   --color-danger        (banner border + icon tint)
 *   --color-danger-soft   (banner background)
 *   --color-text-primary  (body copy)
 *   --color-text-secondary (sub-copy)
 *   --color-primary       (magic-link CTA)
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ShieldAlert } from 'lucide-react';

export interface SignInLockoutBannerProps {
  lockedUntil: Date;
  reason: 'email' | 'ip';
  /**
   * Override the magic-link route. Defaults to '#/auth/forgot' which already
   * exposes the magic-link option per Phase 5 ForgotPasswordForm.
   */
  magicLinkHref?: string;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function reasonCopy(reason: 'email' | 'ip'): string {
  return reason === 'email'
    ? 'Too many failed attempts for this account.'
    : 'Too many failed attempts from this network.';
}

export function SignInLockoutBanner({
  lockedUntil,
  reason,
  magicLinkHref = '#/auth/forgot',
}: SignInLockoutBannerProps): ReactElement | null {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = lockedUntil.getTime() - now;

  if (remainingMs <= 0) return null;

  const countdown = formatRemaining(remainingMs);

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl border p-4 text-[14px]"
      style={{
        background: 'var(--color-danger-soft)',
        borderColor: 'var(--color-danger)',
        color: 'var(--color-text-primary)',
      }}
      data-testid="signin-lockout-banner"
    >
      <ShieldAlert
        className="size-5 mt-0.5 shrink-0"
        aria-hidden
        style={{ color: 'var(--color-danger)' }}
      />
      <div className="flex flex-col gap-2">
        <p className="font-semibold">{reasonCopy(reason)}</p>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Try again in{' '}
          <span
            className="font-mono font-semibold"
            aria-label={`${countdown} remaining`}
            data-testid="signin-lockout-countdown"
          >
            {countdown}
          </span>
          , or use a{' '}
          <a
            href={magicLinkHref}
            className="font-semibold hover:underline"
            style={{ color: 'var(--color-primary)' }}
          >
            magic link
          </a>{' '}
          to sign in.
        </p>
      </div>
    </div>
  );
}

export default SignInLockoutBanner;
