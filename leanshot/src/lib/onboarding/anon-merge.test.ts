/**
 * Phase 59 Plan 59-03 (AUTH-10) — anon-merge helper tests.
 *
 * Four behaviors per plan spec:
 *   1. No cookie present → no-ops and returns { merged: false }
 *   2. Cookie present → POSTs to /functions/v1/merge-anon-session with cookie_ids + anon_distinct_id
 *   3. Network failure → swallowed (best-effort) → returns { merged: false }
 *   4. Success response → returns { merged: true, draft_entries }; cookie cleared in finally
 *
 * Security (T-59-08): helper takes only accessToken — no userId param accepted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeAnonSession } from './anon-merge';

// ──────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────

const readAnonCookieMock = vi.fn(() => null as string | null);
const clearAnonCookieMock = vi.fn();
vi.mock('@/lib/anonymous/cookie', () => ({
  readAnonCookie: () => readAnonCookieMock(),
  clearAnonCookie: () => clearAnonCookieMock(),
  writeAnonCookie: vi.fn(),
  ANON_COOKIE_NAME: '_ls_anon',
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ merged: true, draft_entries: [{ type: 'injection' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('import.meta', {
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key-test',
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

describe('mergeAnonSession', () => {
  it('B1: no cookie present → returns { merged: false } without fetching', async () => {
    readAnonCookieMock.mockReturnValue(null);
    const result = await mergeAnonSession({ accessToken: 'tok' });
    expect(result).toEqual({ merged: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('B2: cookie present → POSTs to /functions/v1/merge-anon-session with correct body', async () => {
    readAnonCookieMock.mockReturnValue('cookie-uuid-123');
    const result = await mergeAnonSession({
      accessToken: 'user-access-token',
      distinctId: 'posthog-id',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/merge-anon-session');
    const body = JSON.parse(String(init.body));
    expect(body.cookie_ids).toEqual(['cookie-uuid-123']);
    expect(body.anon_distinct_id).toBe('posthog-id');
    // Must use the accessToken passed in, not a user id.
    expect(String(init.headers)).not.toContain('userId');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer user-access-token',
    );
    expect(result.merged).toBe(true);
    expect(result.draft_entries).toHaveLength(1);
  });

  it('B3: network failure → swallowed; returns { merged: false }; cookie still cleared', async () => {
    readAnonCookieMock.mockReturnValue('cookie-uuid-456');
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    const result = await mergeAnonSession({ accessToken: 'tok' });
    expect(result).toEqual({ merged: false });
    // Cookie must be cleared even on failure (finally block).
    expect(clearAnonCookieMock).toHaveBeenCalledTimes(1);
  });

  it('B4: no accessToken → falls back to anon key in Authorization header', async () => {
    readAnonCookieMock.mockReturnValue('cookie-uuid-789');
    await mergeAnonSession({});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // When no accessToken, Authorization should use the anon key placeholder.
    const auth = (init.headers as Record<string, string>)['Authorization'];
    expect(auth).toMatch(/^Bearer /);
    // clearAnonCookie must be called (finally block).
    expect(clearAnonCookieMock).toHaveBeenCalledTimes(1);
  });

  it('B5 (WR-02): non-ok HTTP response → returns { merged: false } and does not attempt res.json()', async () => {
    readAnonCookieMock.mockReturnValue('cookie-uuid-err');
    // Simulate a 401 response (e.g. expired token between session mint and merge call).
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await mergeAnonSession({ accessToken: 'expired-tok' });

    expect(result).toEqual({ merged: false });
    // Cookie must still be cleared in finally even on HTTP error.
    expect(clearAnonCookieMock).toHaveBeenCalledTimes(1);
    // Warning must be emitted distinguishing HTTP failure from clean no-op.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
    warnSpy.mockRestore();
  });
});
