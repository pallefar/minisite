// Phase 59 Plan 59-02 Task 2 — unit tests for signInWithAppleNative() (RED phase).
//
// Behavior under test (per 59-02-PLAN.md <behavior>):
//   1. Non-iOS: returns { error: { message: 'native_apple_ios_only' } } without
//      calling SignInWithApple.authorize or supabase.
//   2. iOS + authorize returns no identityToken: returns { error: { message:
//      'apple_no_identity_token' } }; signInWithIdToken NOT called.
//   3. iOS + valid identityToken: calls supabase.auth.signInWithIdToken({
//      provider:'apple', token }) and returns { error: null } on success.
//   4. iOS + authorize throws: returns { error: { message: <err.message> } }.
//
// Uses vi.resetModules() + re-import so each test gets a fresh module with
// the configured mock values, per the biometric.test.ts pattern.
// Runs under vite.config.ts (jsdom) via:
//   npx vitest run --config vite.config.ts src/lib/native/apple-sign-in.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Inline vi.mock — hoisted by vitest so the real native bindings are never loaded.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
  },
}));

vi.mock('@capacitor-community/apple-sign-in', () => ({
  SignInWithApple: {
    authorize: vi.fn(async () => ({
      response: {
        user: null,
        email: null,
        givenName: null,
        familyName: null,
        identityToken: 'mock-token',
        authorizationCode: 'mock-code',
      },
    })),
  },
}));

const mockSignInWithIdToken = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: mockSignInWithIdToken,
    },
  },
}));

describe('signInWithAppleNative()', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSignInWithIdToken.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("non-iOS (web) → returns { error: { message: 'native_apple_ios_only' } } without calling authorize or signInWithIdToken", async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
    const { signInWithAppleNative } = await import('./apple-sign-in');
    const res = await signInWithAppleNative();
    expect(res).toEqual({ error: { message: 'native_apple_ios_only' } });
    expect(SignInWithApple.authorize).not.toHaveBeenCalled();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("iOS + authorize returns no identityToken → { error: { message: 'apple_no_identity_token' } }; signInWithIdToken NOT called", async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
    // Empty string = falsy identityToken → missing-token path
    SignInWithApple.authorize.mockResolvedValue({
      response: {
        user: null,
        email: null,
        givenName: null,
        familyName: null,
        identityToken: '',
        authorizationCode: 'code',
      },
    });
    const { signInWithAppleNative } = await import('./apple-sign-in');
    const res = await signInWithAppleNative();
    expect(res).toEqual({ error: { message: 'apple_no_identity_token' } });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('iOS + valid identityToken → calls signInWithIdToken({ provider:"apple", token, nonce }) and returns { error: null } on success', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
    SignInWithApple.authorize.mockResolvedValue({
      response: {
        user: 'user123',
        email: null,
        givenName: null,
        familyName: null,
        identityToken: 'mock-identity-token',
        authorizationCode: 'code',
      },
    });
    mockSignInWithIdToken.mockResolvedValue({
      data: { user: { id: 'u1' }, session: {} },
      error: null,
    });
    const { signInWithAppleNative } = await import('./apple-sign-in');
    const res = await signInWithAppleNative();
    // CR-01 regression guard: signInWithIdToken MUST be called with a nonce field
    // so GoTrue can verify the nonce claim baked into the Apple JWT. Without it,
    // any valid Apple token for this app can be replayed (token-replay window).
    expect(mockSignInWithIdToken).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'apple',
        token: 'mock-identity-token',
        nonce: expect.any(String), // raw nonce — GoTrue re-hashes and compares to JWT claim
      }),
    );
    expect(res).toEqual({ error: null });
  });

  it('iOS + authorize throws → returns { error: { message: <err.message> } }', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
    SignInWithApple.authorize.mockRejectedValue(new Error('User cancelled'));
    const { signInWithAppleNative } = await import('./apple-sign-in');
    const res = await signInWithAppleNative();
    expect(res).toEqual({ error: { message: 'User cancelled' } });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });
});
