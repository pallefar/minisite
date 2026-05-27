/**
 * Phase 59 Plan 59-01 Task 3 — SignInForm Apple-button gate tests.
 *
 * Coverage:
 *   T1: isAppleEnabled()===false (default) → no "Sign in with Apple" button in DOM
 *   T2: isAppleEnabled()===true → "Sign in with Apple" button is visible
 *   T3: isAppleEnabled()===true → clicking the Apple button calls signInWithOAuthProvider('apple')
 *   T4: isAppleEnabled()===true + isPromote mode → Apple button NOT rendered
 *
 * Notes:
 *   - We mock @/lib/auth so no real Supabase/OAuth calls fire from jsdom.
 *   - react-i18next is initialized globally via src/test-setup.ts with the real
 *     EN locale catalogs — no additional mock needed here.
 *   - The window.location.hash is reset in beforeEach to prevent promote-mode
 *     leaking between tests.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInForm } from '../SignInForm';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const signInMock = vi.fn();
const setPasswordOnPromotedMock = vi.fn();
const signInWithMagicLinkMock = vi.fn();
const signInWithOAuthProviderMock = vi.fn(async () => ({ error: null }));

let isAppleEnabledFlag = false;

vi.mock('@/lib/auth', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  setPasswordOnPromoted: (...args: unknown[]) => setPasswordOnPromotedMock(...args),
  signInWithMagicLink: (...args: unknown[]) => signInWithMagicLinkMock(...args),
  signInWithOAuthProvider: (...args: unknown[]) => signInWithOAuthProviderMock(...args),
  isAppleEnabled: () => isAppleEnabledFlag,
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => () => {
    /* noop */
  },
}));

// Import after vi.mock so the mocks are applied.

beforeEach(() => {
  signInMock.mockReset();
  setPasswordOnPromotedMock.mockReset();
  signInWithMagicLinkMock.mockReset();
  signInWithOAuthProviderMock.mockReset().mockResolvedValue({ error: null });
  isAppleEnabledFlag = false;
  // Ensure no ?promote=1 leaks from prior tests.
  window.location.hash = '';
});

afterEach(() => {
  window.location.hash = '';
});

describe('SignInForm — Apple-button gate (Plan 59-01 AUTH-08)', () => {
  it('T1: Apple button hidden when isAppleEnabled()===false', () => {
    isAppleEnabledFlag = false;
    render(<SignInForm />);
    expect(screen.queryByRole('button', { name: /sign in with apple/i })).toBeNull();
  });

  it('T2: Apple button shown when isAppleEnabled()===true', () => {
    isAppleEnabledFlag = true;
    render(<SignInForm />);
    expect(screen.getByRole('button', { name: /sign in with apple/i })).toBeInTheDocument();
  });

  it('T3: clicking Apple button calls signInWithOAuthProvider with "apple"', async () => {
    isAppleEnabledFlag = true;
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.click(screen.getByRole('button', { name: /sign in with apple/i }));
    expect(signInWithOAuthProviderMock).toHaveBeenCalledTimes(1);
    expect(signInWithOAuthProviderMock).toHaveBeenCalledWith('apple');
  });

  it('T4: Apple button NOT shown in promote mode even when isAppleEnabled()===true', () => {
    isAppleEnabledFlag = true;
    window.location.hash = '#/auth/signin?email=user@test.com&promote=1';
    render(<SignInForm />);
    expect(screen.queryByRole('button', { name: /sign in with apple/i })).toBeNull();
  });
});
