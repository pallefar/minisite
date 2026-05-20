/**
 * Phase 5 Plan 05-02 Task 1: auth wrapper unit tests (RED → GREEN).
 *
 * Source: 05-02-PLAN.md Task 1 <behavior>. Mocks the `@/lib/supabase`
 * singleton so test runs do not hit network. Regression-guards the two
 * Critical Gotchas:
 *   - Gotcha #2 (P-PLAN): signOut must pass `{scope: 'local'}` (NEVER global).
 *   - Gotcha #5 (PHASE 4 PITFALL 5): anon-promote uses `updateUser`, NEVER
 *     `linkIdentity` (OAuth-only).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSignUp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignInWithOtp = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockSignOut = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockUpdateUser = vi.fn();
const mockResend = vi.fn();
const mockGetSession = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      signInWithOtp: mockSignInWithOtp,
      signInWithOAuth: mockSignInWithOAuth,
      signOut: mockSignOut,
      resetPasswordForEmail: mockResetPasswordForEmail,
      updateUser: mockUpdateUser,
      resend: mockResend,
      getSession: mockGetSession,
      getUser: mockGetUser,
    },
  },
}));

beforeEach(() => {
  mockSignUp.mockReset();
  mockSignInWithPassword.mockReset();
  mockSignInWithOtp.mockReset();
  mockSignInWithOAuth.mockReset();
  mockSignOut.mockReset();
  mockResetPasswordForEmail.mockReset();
  mockUpdateUser.mockReset();
  mockResend.mockReset();
  mockGetSession.mockReset();
  mockGetUser.mockReset();
  // Phase 34 Plan 34-04: clear apple-enabled localStorage override between tests
  try {
    localStorage.removeItem('leanshot_auth_apple_enabled');
  } catch {
    /* noop */
  }
});

describe('signUp', () => {
  it('passes email + password + emailRedirectTo ending in #/auth/verify', async () => {
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: 'u1' }, session: null }, error: null });
    const { signUp } = await import('./auth');
    const res = await signUp('a@b.co', 'Pass1234');
    expect(mockSignUp).toHaveBeenCalledTimes(1);
    const call = mockSignUp.mock.calls[0]![0];
    expect(call.email).toBe('a@b.co');
    expect(call.password).toBe('Pass1234');
    expect(call.options.emailRedirectTo).toMatch(/#\/auth\/verify$/);
    expect(res).toEqual({ user: { id: 'u1' }, session: null, error: null });
  });
});

describe('signIn', () => {
  it('returns { user, session, error } from signInWithPassword', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'u1' }, session: { access_token: 't' } },
      error: null,
    });
    const { signIn } = await import('./auth');
    const res = await signIn('a@b.co', 'Pass1234');
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'Pass1234' });
    expect(res.session).toEqual({ access_token: 't' });
    expect(res.error).toBeNull();
  });
});

describe('signOut', () => {
  it('passes { scope: "local" } to supabase.auth.signOut (Critical Gotcha #2 — regression guard)', async () => {
    mockSignOut.mockResolvedValueOnce({ error: null });
    const { signOut } = await import('./auth');
    await signOut();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('requestPasswordReset', () => {
  it('passes redirectTo ending in #/auth/set-new-password', async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    const { requestPasswordReset } = await import('./auth');
    await requestPasswordReset('a@b.co');
    expect(mockResetPasswordForEmail).toHaveBeenCalledTimes(1);
    const args = mockResetPasswordForEmail.mock.calls[0]!;
    expect(args[0]).toBe('a@b.co');
    expect((args[1] as { redirectTo: string }).redirectTo).toMatch(/#\/auth\/set-new-password$/);
  });
});

describe('attachEmailToAnon (Critical Gotcha #5 — NEVER linkIdentity)', () => {
  it('calls updateUser({ email }), NOT linkIdentity', async () => {
    mockUpdateUser.mockResolvedValueOnce({ data: { user: { id: 'anon-1' } }, error: null });
    const { attachEmailToAnon } = await import('./auth');
    await attachEmailToAnon('new@x.co');
    expect(mockUpdateUser).toHaveBeenCalledWith({ email: 'new@x.co' });
  });
});

describe('setPasswordOnPromoted', () => {
  it('calls updateUser({ password }), NOT linkIdentity', async () => {
    mockUpdateUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    const { setPasswordOnPromoted } = await import('./auth');
    await setPasswordOnPromoted('Pass1234');
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'Pass1234' });
  });
});

describe('signInWithMagicLink', () => {
  it('calls signInWithOtp with emailRedirectTo ending in #/auth/verify', async () => {
    mockSignInWithOtp.mockResolvedValueOnce({ data: {}, error: null });
    const { signInWithMagicLink } = await import('./auth');
    await signInWithMagicLink('a@b.co');
    const call = mockSignInWithOtp.mock.calls[0]![0];
    expect(call.email).toBe('a@b.co');
    expect(call.options.emailRedirectTo).toMatch(/#\/auth\/verify$/);
  });
});

describe('resendVerification', () => {
  it('calls resend with type: "signup" + emailRedirectTo', async () => {
    mockResend.mockResolvedValueOnce({ data: {}, error: null });
    const { resendVerification } = await import('./auth');
    await resendVerification('a@b.co');
    const call = mockResend.mock.calls[0]![0];
    expect(call.type).toBe('signup');
    expect(call.email).toBe('a@b.co');
    expect(call.options.emailRedirectTo).toMatch(/#\/auth\/verify$/);
  });
});

describe('setNewPassword', () => {
  it('calls updateUser({password}) and then signOut({scope: "others"}) on success (close access-token window on other devices)', async () => {
    mockUpdateUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    mockSignOut.mockResolvedValueOnce({ error: null });
    const { setNewPassword } = await import('./auth');
    await setNewPassword('Pass1234');
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'Pass1234' });
    // Must close access-token-still-valid window on other devices.
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('does NOT call signOut when updateUser fails', async () => {
    mockUpdateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'weak password' },
    });
    const { setNewPassword } = await import('./auth');
    const res = await setNewPassword('weak');
    expect(res.error).toEqual({ message: 'weak password' });
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('getSession / getUser', () => {
  it('getSession returns { session, error }', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: 't' } },
      error: null,
    });
    const { getSession } = await import('./auth');
    const res = await getSession();
    expect(res.session).toEqual({ access_token: 't' });
  });

  it('getUser returns { user, error }', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    const { getUser } = await import('./auth');
    const res = await getUser();
    expect(res.user).toEqual({ id: 'u1' });
  });
});

describe('authRedirectTo (implicit via emailRedirectTo args)', () => {
  it('uses window.location.origin when window is defined', async () => {
    mockSignUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: null });
    const origin = window.location.origin; // jsdom provides http://localhost:3000 by default
    const { signUp } = await import('./auth');
    await signUp('a@b.co', 'Pass1234');
    const call = mockSignUp.mock.calls[0]![0];
    expect(call.options.emailRedirectTo).toBe(`${origin}/#/auth/verify`);
  });
});

// ─── Phase 34 Plan 34-04 (ONBOARD-02) — PKCE OAuth wrapper ────────────────────
// signInWithOAuthProvider wraps supabase.auth.signInWithOAuth with:
//   - PKCE-required PATH redirect (`/auth/callback`, NOT a `#/...` hash)
//   - Apple feature-gate via env > localStorage > false (vendor-gated send
//     pattern per memory `reference_vendor_gated_send_health_check`)
// isAppleEnabled is exported for Plan 34-06 (goal-step OAuth button row).
describe('signInWithOAuthProvider — Google (Phase 34-04 ONBOARD-02)', () => {
  it('calls supabase.auth.signInWithOAuth with provider=google and PATH redirectTo (no `#`)', async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ data: {}, error: null });
    const { signInWithOAuthProvider } = await import('./auth');
    const res = await signInWithOAuthProvider('google');
    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
    const call = mockSignInWithOAuth.mock.calls[0]![0];
    expect(call.provider).toBe('google');
    // PKCE requirement: PATH-based redirect, never hash-based.
    expect(call.options.redirectTo).toBe(`${window.location.origin}/auth/callback`);
    expect(call.options.redirectTo).not.toContain('#');
    expect(res.error).toBeNull();
  });
});

describe('signInWithOAuthProvider — Apple gate (Phase 34-04 ONBOARD-02)', () => {
  it('returns { error: { message: "apple_disabled" } } when no env + no localStorage override; does NOT call signInWithOAuth', async () => {
    const { signInWithOAuthProvider } = await import('./auth');
    const res = await signInWithOAuthProvider('apple');
    expect(mockSignInWithOAuth).not.toHaveBeenCalled();
    expect(res.error).toEqual({ message: 'apple_disabled' });
  });

  it('calls signInWithOAuth({ provider: "apple", ... }) when localStorage flag enables Apple', async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ data: {}, error: null });
    localStorage.setItem('leanshot_auth_apple_enabled', 'true');
    const { signInWithOAuthProvider } = await import('./auth');
    const res = await signInWithOAuthProvider('apple');
    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
    const call = mockSignInWithOAuth.mock.calls[0]![0];
    expect(call.provider).toBe('apple');
    expect(call.options.redirectTo).toBe(`${window.location.origin}/auth/callback`);
    expect(call.options.redirectTo).not.toContain('#');
    expect(res.error).toBeNull();
  });
});

describe('isAppleEnabled (Phase 34-04 ONBOARD-02 — exported for Plan 34-06)', () => {
  it('returns false by default (no env var, no localStorage override)', async () => {
    const { isAppleEnabled } = await import('./auth');
    expect(isAppleEnabled()).toBe(false);
  });

  it('returns true when localStorage("leanshot_auth_apple_enabled") === "true"', async () => {
    localStorage.setItem('leanshot_auth_apple_enabled', 'true');
    const { isAppleEnabled } = await import('./auth');
    expect(isAppleEnabled()).toBe(true);
  });
});
