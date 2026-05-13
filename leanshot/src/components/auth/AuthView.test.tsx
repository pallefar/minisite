/**
 * Phase 13 Plan 13-04 — AuthView split-screen layout tests (DS-04).
 *
 * Covers the behaviour contract from 13-04-PLAN.md task 2:
 *  - Outer grid: `h-screen overflow-hidden grid md:grid-cols-[1.1fr_1fr]`
 *  - Hero column: <aside hidden md:flex aria-hidden="true">
 *  - Form column: <main overflow-y-auto> with `id="auth-form"`
 *  - Hashchange listener preserved
 *  - Pill v2 segmented switcher for signin/signup
 *  - Sub-form mount table verbatim
 *
 * Note: sub-form components (SignInForm, SignUpForm, …) call into Supabase via
 * `@/lib/auth`. We stub them at module-level so the tests stay focused on the
 * shell layout + routing wiring rather than auth side-effects.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthFormShell } from './AuthFormShell';
import AuthView from './AuthView';

vi.mock('./SignInForm', () => ({
  SignInForm: () => <div data-testid="signin-form" />,
}));
vi.mock('./SignUpForm', () => ({
  SignUpForm: () => <div data-testid="signup-form" />,
}));
vi.mock('./ForgotPasswordForm', () => ({
  ForgotPasswordForm: () => <div data-testid="forgot-form" />,
}));
vi.mock('./SetNewPasswordForm', () => ({
  SetNewPasswordForm: () => <div data-testid="set-new-password-form" />,
}));
vi.mock('./VerifyEmailLanding', () => ({
  VerifyEmailLanding: () => <div data-testid="verify-landing" />,
}));
vi.mock('./PostSignupSent', () => ({
  PostSignupSent: () => <div data-testid="verify-sent" />,
}));
vi.mock('@/illustrations/LoginHero', () => ({
  LoginHero: ({ className }: { className?: string }) => (
    <div data-testid="login-hero" className={className} />
  ),
}));

function setHash(hash: string): void {
  window.history.replaceState(null, '', window.location.pathname + hash);
}

describe('AuthView — split-screen layout (DS-04, Plan 13-04)', () => {
  beforeEach(() => {
    setHash('#/auth/signin');
  });
  afterEach(() => {
    setHash('');
  });

  it('renders an outer container with grid + md:grid-cols-[1.1fr_1fr] for hero-LEFT / form-RIGHT split', () => {
    const { container } = render(<AuthView />);
    const root = container.querySelector('div.auth-root');
    expect(root).not.toBeNull();
    expect(root!.className).toMatch(/h-screen/);
    expect(root!.className).toMatch(/overflow-hidden/);
    expect(root!.className).toMatch(/grid/);
    expect(root!.className).toMatch(/md:grid-cols-\[1\.1fr_1fr\]/);
  });

  it('renders AuthHero inside an <aside hidden md:flex aria-hidden="true">', () => {
    const { container } = render(<AuthView />);
    const aside = container.querySelector('aside[aria-hidden="true"]');
    expect(aside).not.toBeNull();
    expect(aside!.className).toMatch(/hidden/);
    expect(aside!.className).toMatch(/md:flex/);
    // LoginHero illustration mounted inside the hero column
    expect(screen.getByTestId('login-hero')).toBeTruthy();
  });

  it('renders AuthFormShell inside a <main id="auth-form" overflow-y-auto>', () => {
    const { container } = render(<AuthView />);
    const main = container.querySelector('main#auth-form');
    expect(main).not.toBeNull();
    expect(main!.className).toMatch(/overflow-y-auto/);
  });

  it('preserves the hashchange listener — switching hash re-renders sub-form', () => {
    setHash('#/auth/signup');
    render(<AuthView />);
    expect(screen.getByTestId('signup-form')).toBeTruthy();

    act(() => {
      setHash('#/auth/signin');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByTestId('signin-form')).toBeTruthy();
  });

  it('renders the segmented Pill switcher with Sign in / Sign up tabs when sub is signin or signup', () => {
    setHash('#/auth/signin');
    render(<AuthView />);
    // Segmented switcher uses role="tablist" via Pill v2 PillGroup
    const tablist = document.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeTruthy();
  });

  it('clicking the Sign up pill pushes #/auth/signup and renders the SignUpForm', async () => {
    setHash('#/auth/signin');
    const user = userEvent.setup();
    render(<AuthView />);
    expect(screen.getByTestId('signin-form')).toBeTruthy();

    const signUpPill = screen.getByRole('button', { name: /sign up/i });
    await user.click(signUpPill);

    expect(window.location.hash).toBe('#/auth/signup');
    expect(screen.getByTestId('signup-form')).toBeTruthy();
  });

  it('does NOT render the segmented switcher when sub is forgot/verify/verify-sent/set-new-password', () => {
    setHash('#/auth/forgot');
    const { unmount } = render(<AuthView />);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.getByTestId('forgot-form')).toBeTruthy();
    unmount();

    setHash('#/auth/verify');
    const { unmount: u2 } = render(<AuthView />);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.getByTestId('verify-landing')).toBeTruthy();
    u2();

    setHash('#/auth/verify-sent');
    const { unmount: u3 } = render(<AuthView />);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.getByTestId('verify-sent')).toBeTruthy();
    u3();

    setHash('#/auth/set-new-password');
    render(<AuthView />);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.getByTestId('set-new-password-form')).toBeTruthy();
  });

  it('mounts the correct sub-form for every hash sub-route', () => {
    const cases: Array<{ hash: string; testId: string }> = [
      { hash: '#/auth/signin', testId: 'signin-form' },
      { hash: '#/auth/signup', testId: 'signup-form' },
      { hash: '#/auth/forgot', testId: 'forgot-form' },
      { hash: '#/auth/set-new-password', testId: 'set-new-password-form' },
      { hash: '#/auth/verify', testId: 'verify-landing' },
      { hash: '#/auth/verify-sent', testId: 'verify-sent' },
    ];

    for (const { hash, testId } of cases) {
      setHash(hash);
      const { unmount } = render(<AuthFormShell sub={hashToSub(hash)} />);
      expect(screen.getByTestId(testId), `expected ${testId} for ${hash}`).toBeTruthy();
      unmount();
    }
  });

  it('hero <aside> is aria-hidden and form <main> is not', () => {
    const { container } = render(<AuthView />);
    const aside = container.querySelector('aside');
    const main = container.querySelector('main#auth-form');
    expect(aside?.getAttribute('aria-hidden')).toBe('true');
    expect(main?.getAttribute('aria-hidden')).toBeNull();
  });
});

// Local helper that mirrors AuthView.parseSub — keeps the AuthFormShell test
// independent of AuthView's hashchange listener.
function hashToSub(
  hash: string,
): 'signup' | 'signin' | 'verify' | 'verify-sent' | 'forgot' | 'set-new-password' {
  const path = hash.replace(/^#\/auth\/?/, '').split('?')[0] ?? '';
  switch (path) {
    case 'signin':
    case 'verify':
    case 'verify-sent':
    case 'forgot':
    case 'set-new-password':
      return path;
    default:
      return 'signup';
  }
}
