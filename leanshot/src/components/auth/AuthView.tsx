/**
 * Phase 5 Plan 05-02 Task 3 — top-level auth container with hash-based sub-routing.
 * Phase 13 Plan 13-04 — restyled to split-screen (DS-04). LAYOUT-ONLY change;
 * routing + Supabase wiring preserved verbatim.
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
 *
 * Phase 13 layout:
 *   - Outer: `h-screen overflow-hidden grid md:grid-cols-[1.1fr_1fr]`
 *   - LEFT (≥ 768 px): <AuthHero /> — decorative hero column (`hidden md:flex`).
 *   - RIGHT (all viewports): <AuthFormShell sub={sub} /> — form column with
 *     segmented Pill v2 switcher + sub-form mount table.
 */
import { useEffect, useState } from 'react';
import { AuthFormShell } from './AuthFormShell';
import { AuthHero } from './AuthHero';

export type AuthSub = 'signup' | 'signin' | 'verify' | 'verify-sent' | 'forgot' | 'set-new-password';

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

export default function AuthView() {
  const [sub, setSub] = useState<AuthSub>(() => parseSub(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setSub(parseSub(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <div className="auth-root h-screen overflow-hidden grid grid-cols-1 md:grid-cols-[1.1fr_1fr] bg-[var(--color-bg)] text-[var(--color-text)]">
      <AuthHero />
      <AuthFormShell sub={sub} />
    </div>
  );
}
