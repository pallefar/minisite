// Phase 59 Plan 59-02 — mock for @capacitor-community/apple-sign-in.
// Mirrors the capgo-native-biometric.ts mock convention.
// Default: authorize resolves with a valid identityToken; tests override per-case.
import { vi } from 'vitest';

export const SignInWithApple = {
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
};

export const __mock = {
  reset() {
    SignInWithApple.authorize.mockImplementation(async () => ({
      response: {
        user: null,
        email: null,
        givenName: null,
        familyName: null,
        identityToken: 'mock-token',
        authorizationCode: 'mock-code',
      },
    }));
  },
};
