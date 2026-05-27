/**
 * SignInLockoutBanner.test.tsx
 *
 * Phase 66 Plan 66-05 (AUTH-14 + AUTH-15).
 *
 * Coverage:
 *   T1: banner renders with countdown (M:SS) + magic-link CTA
 *   T2: countdown ticks down each second (advance fake timer + re-render)
 *   T3: banner returns null when lockedUntil is already past
 *   T4: reason='email' vs reason='ip' surface differentiated body copy
 *   T5: magic-link href is overridable
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SignInLockoutBanner } from './SignInLockoutBanner';

describe('<SignInLockoutBanner>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('T1: renders countdown + magic-link CTA', () => {
    const lockedUntil = new Date('2026-05-27T12:05:30.000Z'); // +5:30
    render(<SignInLockoutBanner lockedUntil={lockedUntil} reason="email" />);
    expect(screen.getByTestId('signin-lockout-banner')).toBeInTheDocument();
    expect(screen.getByTestId('signin-lockout-countdown')).toHaveTextContent('5:30');
    expect(screen.getByRole('link', { name: /magic link/i })).toHaveAttribute(
      'href',
      '#/auth/forgot',
    );
  });

  it('T2: countdown ticks down each second', () => {
    const lockedUntil = new Date('2026-05-27T12:00:10.000Z'); // +10s
    render(<SignInLockoutBanner lockedUntil={lockedUntil} reason="ip" />);
    expect(screen.getByTestId('signin-lockout-countdown')).toHaveTextContent('0:10');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('signin-lockout-countdown')).toHaveTextContent('0:07');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('signin-lockout-countdown')).toHaveTextContent('0:02');
  });

  it('T3: returns null when lockout already expired', () => {
    const lockedUntil = new Date('2026-05-27T11:55:00.000Z'); // 5 min in the past
    const { container } = render(
      <SignInLockoutBanner lockedUntil={lockedUntil} reason="email" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('T4: reason="email" vs reason="ip" surface different body copy', () => {
    const lockedUntil = new Date('2026-05-27T12:05:00.000Z');
    const { unmount } = render(
      <SignInLockoutBanner lockedUntil={lockedUntil} reason="email" />,
    );
    expect(screen.getByText(/for this account/i)).toBeInTheDocument();
    unmount();

    render(<SignInLockoutBanner lockedUntil={lockedUntil} reason="ip" />);
    expect(screen.getByText(/from this network/i)).toBeInTheDocument();
  });

  it('T5: magicLinkHref override is honored', () => {
    const lockedUntil = new Date('2026-05-27T12:05:00.000Z');
    render(
      <SignInLockoutBanner
        lockedUntil={lockedUntil}
        reason="email"
        magicLinkHref="#/auth/magic"
      />,
    );
    expect(screen.getByRole('link', { name: /magic link/i })).toHaveAttribute(
      'href',
      '#/auth/magic',
    );
  });
});
