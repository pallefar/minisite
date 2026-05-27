/**
 * Phase 34 Plan 34-07 (ONBOARD-05) — activation-hooks unit tests.
 *
 * fireActivation():
 *   - First call POSTs to /functions/v1/record-activation with bearer auth.
 *   - On success it sets the persisted store flag `activationFiredAt`.
 *   - Subsequent calls return without POSTing.
 *   - Concurrent calls dedupe via an in-module inflight Promise (single fetch).
 *   - `{ already_activated: true }` response still sets the flag (idempotent).
 *   - No auth session → no POST, returns gracefully.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { fireActivation } from './activation-hooks';

// ---------------------------------------------------------------------------
// Hoisted spies — referenced from inside vi.mock factories.
// ---------------------------------------------------------------------------

const { mockGetSession } = vi.hoisted(() => {
  return {
    mockGetSession: vi.fn(),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
  },
}));

// Subject under test — imported AFTER vi.mock registration.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_FETCH = global.fetch;

function mockFetchOk(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn as unknown as typeof global.fetch;
  return fn;
}

function setSession(token: string | null): void {
  mockGetSession.mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  });
}

function resetActivationStore(): void {
  useStore.setState({ activationFiredAt: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = ORIGINAL_FETCH;
  resetActivationStore();
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('fireActivation: first call', () => {
  it('POSTs to /functions/v1/record-activation with bearer auth and correct body', async () => {
    setSession('test-token');
    const fetchFn = mockFetchOk({ activated: true, days_since_signup: 0 });

    await fireActivation({ goal_type: 'lose-weight', action_type: 'first_weight_log' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/record-activation');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ goal_type: 'lose-weight', action_type: 'first_weight_log' });
  });

  it('sets store.activationFiredAt on success response', async () => {
    setSession('test-token');
    mockFetchOk({ activated: true, days_since_signup: 1 });
    await fireActivation({ goal_type: 'build-muscle', action_type: 'first_workout_log' });
    expect(useStore.getState().activationFiredAt).not.toBeNull();
    expect(typeof useStore.getState().activationFiredAt).toBe('string');
  });
});

describe('fireActivation: fire-once semantics', () => {
  it('does NOT POST when store.activationFiredAt is already set', async () => {
    useStore.setState({ activationFiredAt: '2026-05-20T00:00:00Z' });
    const fetchFn = mockFetchOk({ activated: true });
    setSession('test-token');

    await fireActivation({ goal_type: 'lose-weight', action_type: 'first_weight_log' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('concurrent calls produce exactly one POST (inflight dedup)', async () => {
    setSession('test-token');
    let resolveFetch: (v: unknown) => void = () => {};
    const slowResponse = new Promise((res) => {
      resolveFetch = res;
    });
    const fetchFn = vi.fn().mockReturnValue(
      slowResponse.then(() => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ activated: true }),
      })),
    );
    global.fetch = fetchFn as unknown as typeof global.fetch;

    const a = fireActivation({ goal_type: 'lose-weight', action_type: 'first_weight_log' });
    const b = fireActivation({ goal_type: 'lose-weight', action_type: 'first_weight_log' });
    resolveFetch(undefined);
    await Promise.all([a, b]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('already_activated response still sets store flag', async () => {
    setSession('test-token');
    mockFetchOk({ already_activated: true });
    await fireActivation({ goal_type: 'lose-weight', action_type: 'first_weight_log' });
    expect(useStore.getState().activationFiredAt).not.toBeNull();
  });
});

describe('fireActivation: no auth', () => {
  it('does NOT POST when no session token present; returns gracefully', async () => {
    setSession(null);
    const fetchFn = mockFetchOk({ activated: true });

    await expect(
      fireActivation({ goal_type: 'lose-weight', action_type: 'first_weight_log' }),
    ).resolves.toBeDefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(useStore.getState().activationFiredAt).toBeNull();
  });
});
