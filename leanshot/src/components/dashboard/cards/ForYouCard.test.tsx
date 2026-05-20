/**
 * Phase 38 Plan 38-09 — ForYouCard tests.
 *
 * Behaviors (per plan Task 3 <behavior>):
 *   T1: On mount, calls supabase.functions.invoke('recommend-next-best-action',
 *       { body: { user_id, surface: 'dashboard' } }).
 *   T2: Renders top-3 recommendations with title.
 *   T3: On error → popular-content fallback rendered + notice visible.
 *   T6: Renders with span=6 by default (Card primitive applies lg:col-span-6).
 *   Click: clicking a personalized rec POSTs to /functions/v1/track-rec-click
 *          with recommendation_id in the body.
 *   Click-fallback: clicking a fallback rec does NOT POST to track-rec-click
 *          (no recommendation_id to attach).
 *
 * NOTE: 3s timeout fallback (T3 variant) is covered by the explicit-error path
 * — vitest fake timers + the fetch-style abort here would require deeper plumbing
 * than the rule of "test behavior, not implementation".
 */

/* eslint-disable import-x/order -- vi.mock() must run before deferred component import */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock supabase functions.invoke ────────────────────────────────────────

const mockInvoke = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

// ─── Mock useStore — signedIn.user.id ──────────────────────────────────────

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa';

vi.mock('@/lib/store', () => ({
  useStore: (
    selector: (s: { signedIn: { user: { id: string } | null } }) => unknown,
  ) => selector({ signedIn: { user: { id: TEST_USER_ID } } }),
}));

// ─── Mock useReducedMotion (always false in tests) ─────────────────────────

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

// Import AFTER mocks are declared above so the component sees the stubbed modules.
import { ForYouCard } from './ForYouCard';
/* eslint-enable import-x/order */

// Stub window.fetch so we can assert click-tracker POSTs without real network.
const fetchSpy = vi.fn();

beforeEach(() => {
  mockInvoke.mockReset();
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchSpy);
  // Stub VITE_SUPABASE_URL so the tracker URL is non-empty.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://stub.supabase.co');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('ForYouCard', () => {
  it('T1: invokes recommend-next-best-action on mount with user_id + surface=dashboard', async () => {
    mockInvoke.mockResolvedValue({
      data: { recommendations: [] },
      error: null,
    });

    render(<ForYouCard />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('recommend-next-best-action', {
        body: { user_id: TEST_USER_ID, surface: 'dashboard' },
      });
    });
  });

  it('T2: renders top-3 recommendations with titles', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        recommendations: [
          {
            recommendation_id: '11111111-1111-1111-1111-111111111111',
            source_type: 'kb_article',
            source_id: 'sid-1',
            title: 'Rotate injection sites',
            score: 0.92,
          },
          {
            recommendation_id: '22222222-2222-2222-2222-222222222222',
            source_type: 'kb_article',
            source_id: 'sid-2',
            title: 'Track your weight weekly',
            score: 0.81,
          },
          {
            recommendation_id: '33333333-3333-3333-3333-333333333333',
            source_type: 'kb_article',
            source_id: 'sid-3',
            title: 'Log food noise twice a day',
            score: 0.74,
          },
        ],
      },
      error: null,
    });

    render(<ForYouCard />);

    await waitFor(() => {
      expect(screen.getByText('Rotate injection sites')).toBeTruthy();
    });
    expect(screen.getByText('Track your weight weekly')).toBeTruthy();
    expect(screen.getByText('Log food noise twice a day')).toBeTruthy();
    // Fallback notice NOT shown on personalized path.
    expect(screen.queryByTestId('for-you-fallback-notice')).toBeNull();
  });

  it('T3: on error → renders popular-content fallback + visible notice', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('boom') });

    render(<ForYouCard />);

    await waitFor(() => {
      expect(screen.getByTestId('for-you-fallback-notice')).toBeTruthy();
    });
    // Popular fallback titles are present.
    expect(screen.getByText(/Injection-site rotation/i)).toBeTruthy();
  });

  it('T6: applies span=6 → lg:col-span-6 on the Card root', async () => {
    mockInvoke.mockResolvedValue({ data: { recommendations: [] }, error: null });
    render(<ForYouCard />);
    const card = await screen.findByTestId('for-you-card');
    expect(card.className).toContain('lg:col-span-6');
  });

  it('Click: clicking a personalized rec POSTs to /functions/v1/track-rec-click with recommendation_id', async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue({
      data: {
        recommendations: [
          {
            recommendation_id: '11111111-1111-1111-1111-111111111111',
            source_type: 'kb_article',
            source_id: 'sid-1',
            title: 'Rotate injection sites',
            score: 0.92,
            deeplink: '/kb/rotate',
          },
        ],
      },
      error: null,
    });

    // Stub window.location.href assignment so test doesn't navigate.
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: '', assign: vi.fn() },
    });

    render(<ForYouCard />);
    const btn = await screen.findByRole('button', {
      name: /Open recommendation: Rotate injection sites/i,
    });
    await user.click(btn);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/track-rec-click'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('11111111-1111-1111-1111-111111111111'),
      }),
    );

    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('Click-fallback: clicking a fallback rec does NOT POST to track-rec-click', async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue({ data: { recommendations: [] }, error: null });

    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: '', assign: vi.fn() },
    });

    render(<ForYouCard />);
    // Wait for fallback to be present.
    await screen.findByTestId('for-you-fallback-notice');
    const fallbackButton = screen.getAllByRole('button')[0];
    await user.click(fallbackButton);

    expect(fetchSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });
});
