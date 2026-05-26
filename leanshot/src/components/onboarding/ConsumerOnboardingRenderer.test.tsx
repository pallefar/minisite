/**
 * Phase 34 Plan 34-06 — ConsumerOnboardingRenderer tests.
 *
 * 10 scenarios per plan spec.
 */

import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────

const signInWithMagicLinkMock = vi.fn(async () => ({ error: null }));
const signInWithOAuthProviderMock = vi.fn(async () => ({ error: null }));
const getSessionMock = vi.fn(async () => ({ session: { access_token: 'access-token' }, error: null }));
let isAppleEnabledFlag = false;
vi.mock('@/lib/auth', () => ({
  signInWithMagicLink: (email: string) => signInWithMagicLinkMock(email),
  signInWithOAuthProvider: (provider: 'google' | 'apple') => signInWithOAuthProviderMock(provider),
  isAppleEnabled: () => isAppleEnabledFlag,
  // WR-03: ConsumerOnboardingRenderer now calls getSession() from @/lib/auth
  // instead of supabase.auth.getSession() directly (CLAUDE.md auth-wrapper rule).
  getSession: () => getSessionMock(),
}));

const readAnonCookieMock = vi.fn(() => 'COOKIE' as string | null);
const clearAnonCookieMock = vi.fn();
vi.mock('@/lib/anonymous/cookie', () => ({
  readAnonCookie: () => readAnonCookieMock(),
  clearAnonCookie: () => clearAnonCookieMock(),
  writeAnonCookie: vi.fn(),
  ANON_COOKIE_NAME: '_ls_anon',
}));

let storeState: { signedIn: { user: { id: string } | null } | null; replayDraftEntries?: vi.Mock } = {
  signedIn: null,
};
const useStoreMock = (selector: (s: unknown) => unknown) => selector(storeState);
(useStoreMock as unknown as { getState: () => unknown }).getState = () => storeState;
vi.mock('@/lib/store', () => ({
  useStore: Object.assign(
    (selector: (s: unknown) => unknown) => useStoreMock(selector),
    { getState: () => storeState },
  ),
}));


const getFeatureFlagMock = vi.fn(() => undefined as string | boolean | undefined);
vi.mock('posthog-js', () => ({
  default: {
    get_distinct_id: vi.fn(() => 'anon-distinct-1'),
    getFeatureFlag: (...args: unknown[]) => getFeatureFlagMock(...args),
  },
}));

import { ConsumerOnboardingRenderer, GOAL_OPTIONS } from './ConsumerOnboardingRenderer';

// ──────────────────────────────────────────────────────────────────────────
// Test scaffolding
// ──────────────────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  isAppleEnabledFlag = false;
  storeState = { signedIn: null };
  getFeatureFlagMock.mockReturnValue(undefined);
  readAnonCookieMock.mockReturnValue('COOKIE');
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ merged: true, draft_entries: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function advanceTo(step: 'intro' | 'goal' | 'auth' | 'ready'): void {
  const targetIndex = { intro: 0, goal: 1, auth: 2, ready: 3 }[step];
  for (let i = 0; i < targetIndex; i++) {
    const continueBtn = screen.getAllByRole('button', { name: /continue/i })[0];
    fireEvent.click(continueBtn);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

describe('ConsumerOnboardingRenderer', () => {
  it('T1: flow=null renders the DEFAULT_STEPS fallback (intro step visible)', () => {
    render(<ConsumerOnboardingRenderer flow={null} />);
    expect(screen.getByText(/Welcome to LeanShot/i)).toBeTruthy();
  });

  it('T2: selecting a goal updates active pill AND POSTs preferences_patch', async () => {
    render(<ConsumerOnboardingRenderer flow={null} />);
    advanceTo('goal');

    const target = GOAL_OPTIONS[0];
    fireEvent.click(screen.getByRole('radio', { name: target.label }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/update-anon-session');
    const body = JSON.parse(String(init.body));
    expect(body.cookie_id).toBe('COOKIE');
    expect(body.preferences_patch).toEqual({ primary_goal: target.id });
  });

  it('T3: auth step shows email + Google buttons by default (Apple gated off)', () => {
    render(<ConsumerOnboardingRenderer flow={null} />);
    advanceTo('goal');
    // pick a goal so the Continue is enabled
    fireEvent.click(screen.getByRole('radio', { name: GOAL_OPTIONS[0].label }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByRole('button', { name: /continue with email/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign in with apple/i })).toBeNull();
  });

  it('T4: isAppleEnabled()===true → Apple button renders (3 buttons total)', () => {
    isAppleEnabledFlag = true;
    render(<ConsumerOnboardingRenderer flow={null} />);
    advanceTo('goal');
    fireEvent.click(screen.getByRole('radio', { name: GOAL_OPTIONS[0].label }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByRole('button', { name: /sign in with apple/i })).toBeTruthy();
  });

  it('T5: Continue with email + valid email calls signInWithMagicLink', async () => {
    render(<ConsumerOnboardingRenderer flow={null} />);
    advanceTo('goal');
    fireEvent.click(screen.getByRole('radio', { name: GOAL_OPTIONS[0].label }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue with email/i }));
    });
    expect(signInWithMagicLinkMock).toHaveBeenCalledWith('test@example.com');
  });

  it('T6: Continue with Google calls signInWithOAuthProvider("google")', async () => {
    render(<ConsumerOnboardingRenderer flow={null} />);
    advanceTo('goal');
    fireEvent.click(screen.getByRole('radio', { name: GOAL_OPTIONS[0].label }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    });
    expect(signInWithOAuthProviderMock).toHaveBeenCalledWith('google');
  });

  it('T7: signedIn user + cookie present → fetch to /functions/v1/merge-anon-session', async () => {
    storeState = { signedIn: { user: { id: 'user-001' } } };
    readAnonCookieMock.mockReturnValue('COOKIE');

    render(<ConsumerOnboardingRenderer flow={null} />);

    await waitFor(() => {
      const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
      expect(calls.some(([u]) => u.includes('/functions/v1/merge-anon-session'))).toBe(true);
    });
    const mergeCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/functions/v1/merge-anon-session'),
    ) as [string, RequestInit];
    const body = JSON.parse(String(mergeCall[1].body));
    expect(body.cookie_ids).toEqual(['COOKIE']);
    expect(body.anon_distinct_id).toBe('anon-distinct-1');
  });

  it('T8: merged=true response triggers clearAnonCookie()', async () => {
    storeState = { signedIn: { user: { id: 'user-001' } } };
    render(<ConsumerOnboardingRenderer flow={null} />);
    await waitFor(() => expect(clearAnonCookieMock).toHaveBeenCalledTimes(1));
  });

  it('T9: every clickable step element has min-h-[44px] tap target class', () => {
    render(<ConsumerOnboardingRenderer flow={null} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it('T10: flow with config (8 D-16 step types) renders without throwing', () => {
    const flow = {
      id: 'flow-active',
      config: [
        { id: 's1', type: 'welcome' },
        { id: 's2', type: 'intro_card' },
        { id: 's3', type: 'goals' },
        { id: 's4', type: 'medication' },
        { id: 's5', type: 'consent' },
        { id: 's6', type: 'body_stats' },
        { id: 's7', type: 'doctor_invite' },
        { id: 's8', type: 'tour' },
      ],
      version: 2,
      variant_id: null,
    } as const;
    expect(() =>
      render(<ConsumerOnboardingRenderer flow={flow as unknown as never} />),
    ).not.toThrow();
  });

  // ── PostHog experiment variant behavior (AUTH-11) ─────────────────────────

  it('T11: getFeatureFlag returns treatment_a → social step rendered (variant path)', () => {
    getFeatureFlagMock.mockReturnValue('treatment_a');
    render(<ConsumerOnboardingRenderer flow={null} />);
    // The social step is injected at position 1 in treatment ordering.
    // Advance to it by clicking Continue on the intro step.
    fireEvent.click(screen.getAllByRole('button', { name: /continue/i })[0]);
    // The social step should be visible — it shows a unique heading and LiveSignupCounter.
    expect(screen.getByText(/Join thousands on their journey/i)).toBeTruthy();
    expect(screen.getByTestId('live-signup-counter')).toBeTruthy();
    // Goal (radiogroup) should NOT be visible yet in treatment_a path.
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(getFeatureFlagMock).toHaveBeenCalledWith('onboarding_flow_variant');
  });

  it('T12: getFeatureFlag returns undefined → DEFAULT_STEPS used (control path)', () => {
    getFeatureFlagMock.mockReturnValue(undefined);
    render(<ConsumerOnboardingRenderer flow={null} />);
    // In control path advancing from intro goes straight to goal, not social.
    fireEvent.click(screen.getAllByRole('button', { name: /continue/i })[0]);
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(getFeatureFlagMock).toHaveBeenCalledWith('onboarding_flow_variant');
  });

  it('T13: getFeatureFlag throws → DEFAULT_STEPS used (safe fallback, no crash)', () => {
    getFeatureFlagMock.mockImplementation(() => { throw new Error('posthog not ready'); });
    expect(() => render(<ConsumerOnboardingRenderer flow={null} />)).not.toThrow();
    // Should still show intro step (first DEFAULT_STEP).
    expect(screen.getByText(/Welcome to LeanShot/i)).toBeTruthy();
  });
});
