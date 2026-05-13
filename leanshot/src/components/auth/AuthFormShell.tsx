/**
 * Phase 13 Plan 13-04 — AuthFormShell: form column wrapper for the
 * split-screen auth view.
 *
 * Responsibilities:
 *   - Scroll container pinned to viewport height (`h-screen overflow-y-auto`)
 *     so only the form panel scrolls when content overflows (chat1.md
 *     landmine 4 — outer container is `h-screen overflow-hidden`, both
 *     panels are 100vh, only this one scrolls).
 *   - Pill v2 `segmented` tab switcher for `Sign in` / `Sign up`, rendered
 *     only when `sub ∈ {'signin','signup'}`. Other sub-routes mount their
 *     own headers; a tab switcher there would be a UX bug.
 *   - "Back to LeanShot home" escape hatch (the Zap button that previously
 *     lived in AuthView's <nav>). Placed at the TOP of the form column so it
 *     stays reachable at <md viewports where AuthHero is hidden.
 *   - Sub-form mount table — preserved verbatim from the legacy AuthView
 *     main body so Phase 5 auth flows continue to function unchanged.
 */
import { Zap } from 'lucide-react';
import { Pill, PillGroup } from '@/components/ui/Pill';
import type { AuthSub } from './AuthView';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { PostSignupSent } from './PostSignupSent';
import { SetNewPasswordForm } from './SetNewPasswordForm';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import { VerifyEmailLanding } from './VerifyEmailLanding';

interface AuthFormShellProps {
  sub: AuthSub;
}

function clearHashAndExit(): void {
  // Replace, don't push — leaving auth must not pollute the back stack.
  history.replaceState(null, '', window.location.pathname);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function goToSub(sub: 'signin' | 'signup'): void {
  // Setting `window.location.hash` triggers the hashchange listener in
  // AuthView, which re-renders this component with the new `sub` prop.
  window.location.hash = `#/auth/${sub}`;
}

export function AuthFormShell({ sub }: AuthFormShellProps) {
  const showSegmented = sub === 'signin' || sub === 'signup';
  return (
    <main
      id="auth-form"
      className="h-screen overflow-y-auto px-6 py-10 md:px-12 md:py-10 bg-[var(--color-surface)] flex flex-col"
    >
      <div className="w-full max-w-[380px] mx-auto my-auto">
        {/* Escape hatch — keep the Zap-wordmark accessible at all viewport sizes */}
        <button
          type="button"
          onClick={clearHashAndExit}
          aria-label="Back to LeanShot home"
          className="inline-flex items-center gap-2 text-[18px] font-extrabold tracking-tight text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] rounded-md mb-8"
        >
          <span className="size-7 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] inline-flex items-center justify-center">
            <Zap className="size-4" strokeWidth={2.6} />
          </span>
          LeanShot
        </button>

        {showSegmented && (
          <PillGroup segmented className="mb-[18px]">
            <Pill active={sub === 'signin'} onClick={() => goToSub('signin')}>
              Sign in
            </Pill>
            <Pill active={sub === 'signup'} onClick={() => goToSub('signup')}>
              Sign up
            </Pill>
          </PillGroup>
        )}

        {sub === 'signup' && <SignUpForm />}
        {sub === 'signin' && <SignInForm />}
        {sub === 'verify' && <VerifyEmailLanding />}
        {sub === 'verify-sent' && <PostSignupSent />}
        {sub === 'forgot' && <ForgotPasswordForm />}
        {sub === 'set-new-password' && <SetNewPasswordForm />}
      </div>
    </main>
  );
}
