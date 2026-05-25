/**
 * Phase 19 Plan 19-04 Task 3 (BL-1 / D-23) — SignUpForm conditional referral
 * field tests.
 *
 * Coverage:
 *   T1: flag OFF → no referral-code Input rendered.
 *   T2: flag ON  → Input rendered for non-anon users; signUp + sessionStorage
 *       gets the trimmed code on submit.
 *   T3: flag ON + invalid format → inline error, signUp NOT called.
 *   T4: flag ON + valid code → signUp called; sessionStorage holds the code.
 *   T5: flag ON + empty code → signUp called; sessionStorage NOT touched.
 *
 * Notes:
 *   - We mock @/lib/auth so no real Supabase calls fire from jsdom.
 *   - useFeatureFlag is mocked at module level (per-test we re-import after
 *     swapping the mock's return value via vi.fn().mockReturnValue).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
// useFeatureFlag is the single switch we drive per-test. Default returns false
// (flag OFF) — individual tests override via `vi.mocked(...).mockReturnValue(true)`.
vi.mock('@/lib/feature-flags', () => ({
  useFeatureFlag: vi.fn(() => false),
}));

const signUpMock = vi.fn();
const attachEmailToAnonMock = vi.fn();
const getSessionMock = vi.fn();
const signInWithOAuthProviderMock = vi.fn(async () => ({ error: null }));

let isAppleEnabledFlag = false;

vi.mock('@/lib/auth', () => ({
  signUp: (...args: unknown[]) => signUpMock(...args),
  attachEmailToAnon: (...args: unknown[]) => attachEmailToAnonMock(...args),
  getSession: (...args: unknown[]) => getSessionMock(...args),
  signInWithOAuthProvider: (...args: unknown[]) => signInWithOAuthProviderMock(...args),
  isAppleEnabled: () => isAppleEnabledFlag,
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => () => {
    /* noop */
  },
}));

// Import after vi.mock so the mocks are applied.
import { useFeatureFlag } from '@/lib/feature-flags';
import { SignUpForm } from '../SignUpForm';

beforeEach(() => {
  signUpMock.mockReset();
  attachEmailToAnonMock.mockReset();
  getSessionMock.mockReset().mockResolvedValue({ session: null });
  signInWithOAuthProviderMock.mockReset().mockResolvedValue({ error: null });
  isAppleEnabledFlag = false;
  vi.mocked(useFeatureFlag).mockReturnValue(false);
  sessionStorage.clear();
  // Prevent hashchange side-effect from leaking between tests.
  window.location.hash = '';
});

afterEach(() => {
  sessionStorage.clear();
  window.location.hash = '';
});

describe('SignUpForm — aff_manual_entry referral-code field (Plan 19-04 BL-1)', () => {
  it('T1: flag OFF → no referral-code Input rendered', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(false);
    render(<SignUpForm />);
    expect(screen.queryByLabelText(/referral code/i)).toBeNull();
  });

  it('T2: flag ON + non-anon → referral-code Input is rendered between email and password', async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    render(<SignUpForm />);
    // Wait for the getSession effect to resolve (it's awaited inside useEffect).
    expect(await screen.findByLabelText(/referral code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/password/i).length).toBeGreaterThan(0);
  });

  it('T3: flag ON + invalid code on submit → inline error, signUp NOT called', async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.type(screen.getByLabelText(/^password/i), 'abcdefg1');
    await user.type(await screen.findByLabelText(/referral code/i), 'INVALID UPPERCASE!');

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText(/use 4–80 lowercase letters, digits, or dashes/i),
    ).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('T4: flag ON + valid code on submit → signUp called + sessionStorage holds code', async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    signUpMock.mockResolvedValue({ user: { id: 'u' }, session: null, error: null });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.type(screen.getByLabelText(/^password/i), 'abcdefg1');
    await user.type(await screen.findByLabelText(/referral code/i), 'coachjane-a3f2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // signUp called with the email+password (NOT the aff code — that flows via sessionStorage).
    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(signUpMock).toHaveBeenCalledWith('a@b.com', 'abcdefg1');
    expect(sessionStorage.getItem('leanshot_aff_manual')).toBe('coachjane-a3f2');
  });

  it('T5: flag ON + empty code → signUp called; sessionStorage NOT touched', async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    signUpMock.mockResolvedValue({ user: { id: 'u' }, session: null, error: null });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.type(screen.getByLabelText(/^password/i), 'abcdefg1');
    // Referral-code Input is rendered but left empty.
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('leanshot_aff_manual')).toBeNull();
  });
});

describe('SignUpForm — Apple-button gate (Plan 59-01 AUTH-08)', () => {
  it('T1: Apple button hidden when isAppleEnabled()===false', () => {
    isAppleEnabledFlag = false;
    render(<SignUpForm />);
    expect(screen.queryByRole('button', { name: /sign in with apple/i })).toBeNull();
  });

  it('T2: Apple button shown when isAppleEnabled()===true (non-anon)', () => {
    isAppleEnabledFlag = true;
    render(<SignUpForm />);
    expect(screen.getByRole('button', { name: /sign in with apple/i })).toBeInTheDocument();
  });

  it('T3: clicking Apple button calls signInWithOAuthProvider with "apple"', async () => {
    isAppleEnabledFlag = true;
    const user = userEvent.setup();
    render(<SignUpForm />);
    await user.click(screen.getByRole('button', { name: /sign in with apple/i }));
    expect(signInWithOAuthProviderMock).toHaveBeenCalledTimes(1);
    expect(signInWithOAuthProviderMock).toHaveBeenCalledWith('apple');
  });

  it('T4: Apple button NOT shown in anon mode even when isAppleEnabled()===true', async () => {
    isAppleEnabledFlag = true;
    // Simulate anon session
    getSessionMock.mockResolvedValue({ session: { user: { is_anonymous: true } } });
    render(<SignUpForm />);
    // Wait for the getSession effect to resolve
    await screen.findByText(/save your data/i);
    expect(screen.queryByRole('button', { name: /sign in with apple/i })).toBeNull();
  });
});
