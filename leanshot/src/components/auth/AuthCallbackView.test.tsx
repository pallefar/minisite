/**
 * Phase 34 Plan 34-04 Task 2 — AuthCallbackView tests (ONBOARD-02).
 *
 * Covers the behaviour contract from 34-04-PLAN.md Task 2 <behavior>:
 *   1. exchangeCodeForSession returns session → reads profiles.completed_onboarding_at
 *      and routes to '/#/onboarding' when null.
 *   2. Same setup but completed_onboarding_at populated → routes to '/#/dashboard'.
 *   3. exchangeCodeForSession returns error → routes to '/#/auth/error'.
 *   4. Renders spinner with role="status" + aria-live="polite".
 *
 * window.location.replace is stubbed via Object.defineProperty (matching the
 * pattern in src/components/clinic/settings/WorkspaceTab.test.tsx).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted ABOVE module-level const declarations.
// Use vi.hoisted() to lift mock fns to the same hoist tier.
const {
  mockExchangeCodeForSession,
  mockFromSelect,
  mockFromEq,
  mockFromMaybeSingle,
} = vi.hoisted(() => ({
  mockExchangeCodeForSession: vi.fn(),
  mockFromSelect: vi.fn(),
  mockFromEq: vi.fn(),
  mockFromMaybeSingle: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
    from: () => ({
      select: (cols: string) => {
        mockFromSelect(cols);
        return {
          eq: (col: string, val: string) => {
            mockFromEq(col, val);
            return {
              maybeSingle: () => mockFromMaybeSingle(),
            };
          },
        };
      },
    }),
  },
}));

let originalLocation: Location;
let replaceMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExchangeCodeForSession.mockReset();
  mockFromSelect.mockReset();
  mockFromEq.mockReset();
  mockFromMaybeSingle.mockReset();

  originalLocation = window.location;
  replaceMock = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      ...originalLocation,
      href: 'http://localhost:3000/auth/callback?code=abc123',
      replace: replaceMock,
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

describe('AuthCallbackView — PKCE code exchange + onboarding routing', () => {
  it('Test 1 — exchangeCodeForSession success + completed_onboarding_at null → redirects to /#/onboarding', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    });
    mockFromMaybeSingle.mockResolvedValueOnce({
      data: { completed_onboarding_at: null },
      error: null,
    });

    const { default: AuthCallbackView } = await import('./AuthCallbackView');
    render(<AuthCallbackView />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/#/onboarding');
    });
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith(
      'http://localhost:3000/auth/callback?code=abc123',
    );
    expect(mockFromSelect).toHaveBeenCalledWith('completed_onboarding_at');
    expect(mockFromEq).toHaveBeenCalledWith('id', 'u1');
  });

  it('Test 2 — exchangeCodeForSession success + completed_onboarding_at populated → redirects to /#/dashboard', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u2' } } },
      error: null,
    });
    mockFromMaybeSingle.mockResolvedValueOnce({
      data: { completed_onboarding_at: '2026-05-01T12:00:00Z' },
      error: null,
    });

    const { default: AuthCallbackView } = await import('./AuthCallbackView');
    render(<AuthCallbackView />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/#/dashboard');
    });
  });

  it('Test 3 — exchangeCodeForSession returns error → redirects to /#/auth/error', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'invalid_request', name: 'AuthError' },
    });

    const { default: AuthCallbackView } = await import('./AuthCallbackView');
    render(<AuthCallbackView />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/#/auth/error');
    });
    // Profile lookup must NOT happen on error path.
    expect(mockFromSelect).not.toHaveBeenCalled();
  });

  it('Test 4 — renders spinner with role="status" and aria-live="polite" while exchanging', async () => {
    // exchangeCodeForSession returns an unresolved promise so the component
    // stays in the 'exchanging' state for the duration of this synchronous
    // assertion (no await).
    mockExchangeCodeForSession.mockReturnValueOnce(new Promise(() => {}));

    const { default: AuthCallbackView } = await import('./AuthCallbackView');
    render(<AuthCallbackView />);

    const status = screen.getByRole('status');
    expect(status).toBeTruthy();
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toMatch(/Signing you in/i);
  });
});
