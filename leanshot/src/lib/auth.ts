/**
 * Phase 5 Plan 05-02 Task 1: Testable Supabase auth wrapper.
 *
 * Source: 05-RESEARCH.md §Pattern 1 (lines 263-355). UI components MUST
 * import auth operations from here — never call `supabase.auth.*` directly
 * outside this module. Centralization buys:
 *   - Mockable seam for unit tests (`vi.mock('@/lib/supabase')`).
 *   - Single-point regression guard for Critical Gotchas #2 (scope:'local')
 *     and #5 (updateUser, NEVER linkIdentity).
 *
 * Every export is async and NEVER throws — errors surface via `{ error }`
 * for the UI to render inline (field-level) or via toast (form-level).
 */
import type { AuthError, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface AuthResult {
  user: User | null;
  session: Session | null;
  error: AuthError | null;
}

/**
 * Build the email-link redirect URL. `window.location.origin` covers
 * production, Vercel previews, and localhost without env-var plumbing.
 * SSR-safe fallback (no `window` in build context) targets production.
 */
function authRedirectTo(hash: string): string {
  if (typeof window === 'undefined') return `https://leanshot-app.vercel.app${hash}`;
  return `${window.location.origin}${hash}`;
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authRedirectTo('/#/auth/verify') },
  });
  return { user: data.user, session: data.session, error };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: data.user, session: data.session, error };
}

export async function signInWithMagicLink(email: string): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authRedirectTo('/#/auth/verify') },
  });
  return { error };
}

/**
 * Sign out from THIS device only.
 *
 * CRITICAL: passes `scope: 'local'`. The default `signOut()` scope is `'global'`
 * which signs out EVERY device of this user — hostile UX for the "I'm done on
 * this laptop" case.
 *
 * Source: 05-RESEARCH.md §1 + §Pitfall 3 + Supabase docs.
 */
export async function signOut(): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  return { error };
}

export async function requestPasswordReset(email: string): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectTo('/#/auth/set-new-password'),
  });
  return { error };
}

/**
 * Apply a new password.
 *
 * On success, ALSO invokes `signOut({ scope: 'others' })` to close the
 * access-token-still-valid window on every other signed-in device — a
 * password change MUST invalidate sessions held by the attacker if the
 * reset flow itself is the recovery path.
 *
 * Source: 05-RESEARCH.md §"Known Threat Patterns" line 1637 (AUTH-04 / SC#2
 * hardening) + Supabase docs `signOut` scope semantics.
 */
export async function setNewPassword(password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (!error) {
    // Best-effort: ignore signOut error here (caller already got user back; the
    // logged-in current session is intentionally preserved by scope='others').
    await supabase.auth.signOut({ scope: 'others' });
  }
  return { user: data.user, session: null, error };
}

export async function resendVerification(email: string): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: authRedirectTo('/#/auth/verify') },
  });
  return { error };
}

/**
 * Anon-promotion step 1 (D-05). Attach an email to the current anonymous
 * `auth.users` row → Supabase mints a verification email under the SAME
 * UID (preserving Phase 4's `ai_messages` and any future RLS-scoped rows).
 *
 * CRITICAL: MUST use `updateUser`, NEVER `linkIdentity` (which is OAuth-only
 * — Supabase server rejects email/password payloads).
 *
 * Source: 05-RESEARCH.md §Pitfall 1 + Phase 4 04-RESEARCH.md §Pitfall 5
 * + .planning/decisions/supabase.md.
 */
export async function attachEmailToAnon(email: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.updateUser({ email });
  return { user: data.user, session: null, error };
}

/**
 * Anon-promotion step 2 (D-05). After verification, set the password on the
 * (now permanent) user — SAME UID, same `ai_messages` history.
 *
 * Same Critical Gotcha #5 reminder: `updateUser`, NEVER `linkIdentity`.
 */
export async function setPasswordOnPromoted(password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.updateUser({ password });
  return { user: data.user, session: null, error };
}

export async function getSession(): Promise<{
  session: Session | null;
  error: AuthError | null;
}> {
  const { data, error } = await supabase.auth.getSession();
  return { session: data.session, error };
}

export async function getUser(): Promise<{ user: User | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.getUser();
  return { user: data.user, error };
}
