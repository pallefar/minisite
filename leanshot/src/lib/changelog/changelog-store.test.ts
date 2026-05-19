/**
 * Phase 42 Plan 42-09 Task 1 — useChangelog() hook tests.
 *
 * Covers the 4 behaviours in 42-09-PLAN.md:
 *   1. fetches changelog_entries + own user_changelog_dismissed and returns
 *      {entries, lastSeenAt, hasUnread, markRead}.
 *   2. hasUnread === true iff any entry.published_at > lastSeenAt.
 *   3. markRead() POSTs /functions/v1/changelog-mark-read with the bearer
 *      token and refetches user_changelog_dismissed on success.
 *   4. Anonymous (no session) → {entries: [], hasUnread: false} with no
 *      toast / no thrown error.
 *
 * The supabase singleton is mocked end-to-end so the unit suite never hits
 * the network. fetch() is patched directly for markRead() observability.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ChangelogRow {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  published_at: string;
}

const mockGetSession = vi.fn();
const mockFrom = vi.fn();
const fetchSpy = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: mockGetSession },
    from: mockFrom,
  },
}));

interface SupabaseError {
  message: string;
  code?: string;
}

function makeBuilder(rows: ChangelogRow[] | { last_seen_published_at: string | null } | null, err: SupabaseError | null = null) {
  // chainable thenable to match supabase-js typing
  const result = { data: rows, error: err };
  const builder = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(resolve(result)),
  };
  return builder;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockFrom.mockReset();
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  // VITE env shim: useChangelog reads VITE_SUPABASE_URL for the Edge Fn URL.
  // jsdom-mode vitest exposes import.meta.env via vite's define plugin.
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useChangelog', () => {
  it('Test 1: fetches entries + dismissed row and returns the documented shape', async () => {
    const entries: ChangelogRow[] = [
      {
        id: '1',
        slug: 'v1-3-dark-mode',
        title: 'Dark mode, everywhere',
        body_md: '# Dark',
        published_at: '2026-05-19T00:00:00Z',
      },
    ];
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1' }, access_token: 'tok-1' } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'changelog_entries') return makeBuilder(entries);
      if (table === 'user_changelog_dismissed')
        return makeBuilder({ last_seen_published_at: '2026-01-01T00:00:00Z' });
      throw new Error(`unexpected table ${table}`);
    });

    const { useChangelog } = await import('./changelog-store');
    const { result } = renderHook(() => useChangelog());

    await waitFor(() => {
      expect(result.current.entries.length).toBe(1);
    });
    expect(result.current.entries[0]?.slug).toBe('v1-3-dark-mode');
    expect(result.current.lastSeenAt).toBe('2026-01-01T00:00:00Z');
    expect(typeof result.current.markRead).toBe('function');
  });

  it('Test 2: hasUnread === true iff any entry.published_at > lastSeenAt', async () => {
    const entries: ChangelogRow[] = [
      {
        id: '1',
        slug: 'a',
        title: 't',
        body_md: '',
        published_at: '2026-05-19T00:00:00Z',
      },
    ];
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1' }, access_token: 'tok-1' } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'changelog_entries') return makeBuilder(entries);
      if (table === 'user_changelog_dismissed')
        return makeBuilder({ last_seen_published_at: '2026-01-01T00:00:00Z' });
      throw new Error('unexpected');
    });

    const { useChangelog } = await import('./changelog-store');
    const { result } = renderHook(() => useChangelog());
    await waitFor(() => expect(result.current.entries.length).toBe(1));
    expect(result.current.hasUnread).toBe(true);
  });

  it('Test 3: markRead() POSTs to /functions/v1/changelog-mark-read with bearer + refetches dismissed', async () => {
    const entries: ChangelogRow[] = [
      { id: '1', slug: 'a', title: 't', body_md: '', published_at: '2026-05-19T00:00:00Z' },
    ];
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1' }, access_token: 'tok-1' } },
      error: null,
    });

    let dismissedCalls = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'changelog_entries') return makeBuilder(entries);
      if (table === 'user_changelog_dismissed') {
        dismissedCalls += 1;
        return makeBuilder({
          last_seen_published_at: dismissedCalls === 1 ? null : '2026-05-19T00:00:00Z',
        });
      }
      throw new Error('unexpected');
    });

    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const { useChangelog } = await import('./changelog-store');
    const { result } = renderHook(() => useChangelog());

    await waitFor(() => expect(result.current.entries.length).toBe(1));

    await act(async () => {
      await result.current.markRead();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/changelog-mark-read');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(init.method).toBe('POST');
    // Refetch happened — dismissed row queried twice (initial + post-markRead).
    expect(dismissedCalls).toBeGreaterThanOrEqual(2);
    expect(result.current.lastSeenAt).toBe('2026-05-19T00:00:00Z');
  });

  it('Test 4: anonymous (no session) → entries=[], hasUnread=false, no throw', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    // from() should NEVER be called when there is no session — assert via mock count.
    mockFrom.mockImplementation(() => {
      throw new Error('from() must not be called without a session');
    });

    const { useChangelog } = await import('./changelog-store');
    const { result } = renderHook(() => useChangelog());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.entries).toEqual([]);
    expect(result.current.hasUnread).toBe(false);
    expect(result.current.lastSeenAt).toBeNull();
  });
});
