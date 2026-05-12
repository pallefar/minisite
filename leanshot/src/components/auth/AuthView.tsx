/**
 * Phase 5 Plan 05-02 Task 3 — top-level auth container with hash-based sub-routing.
 *
 * Sub-routes (UI-SPEC §1):
 *   - `#/auth/signup`        → SignUpForm (default for #/auth/)
 *   - `#/auth/signin`        → SignInForm
 *   - `#/auth/verify`        → VerifyEmailLanding
 *   - `#/auth/verify-sent`   → PostSignupSent
 *   - `#/auth/forgot`        → ForgotPasswordForm
 *   - `#/auth/set-new-password` → SetNewPasswordForm
 *
 * Hash routing is intentionally hand-rolled (no router) so the no-router invariant
 * stays — App.tsx ↔ AuthView only communicate through `window.location.hash` + state.
 */
import { Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { PostSignupSent } from './PostSignupSent';
import { SetNewPasswordForm } from './SetNewPasswordForm';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import { VerifyEmailLanding } from './VerifyEmailLanding';

type AuthSub = 'signup' | 'signin' | 'verify' | 'verify-sent' | 'forgot' | 'set-new-password';

function parseSub(hash: string): AuthSub {
  // Strip any query string `?...` so `#/auth/signin?promote=1` resolves to `signin`.
  const path = hash.replace(/^#\/auth\/?/, '').split('?')[0] ?? '';
  switch (path) {
    case 'signin':
    case 'verify':
    case 'verify-sent':
    case 'forgot':
    case 'set-new-password':
      return path;
    case 'signup':
    case '':
    default:
      return 'signup';
  }
}

function clearHashAndExit(): void {
  // Replace, don't push — leaving auth must not pollute the back stack.
  history.replaceState(null, '', window.location.pathname);
  // Force a re-render by dispatching `hashchange`.
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export default function AuthView() {
  const [sub, setSub] = useState<AuthSub>(() => parseSub(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setSub(parseSub(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <nav className="max-w-[1200px] mx-auto px-5 py-4 flex items-center justify-between">
        <button
          type="button"
          onClick={clearHashAndExit}
          className="flex items-center gap-2 text-[20px] font-extrabold tracking-tight text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-md"
          aria-label="Back to LeanShot home"
        >
          <span className="size-7 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] inline-flex items-center justify-center">
            <Zap className="size-4" strokeWidth={2.6} />
          </span>
          LeanShot
        </button>
      </nav>

      <main className="max-w-[480px] mx-auto px-5 py-8 md:py-16">
        {sub === 'signup' && <SignUpForm />}
        {sub === 'signin' && <SignInForm />}
        {sub === 'verify' && <VerifyEmailLanding />}
        {sub === 'verify-sent' && <PostSignupSent />}
        {sub === 'forgot' && <ForgotPasswordForm />}
        {sub === 'set-new-password' && <SetNewPasswordForm />}
      </main>
    </div>
  );
}
