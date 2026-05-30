/**
 * Phase 71 Plan 71-01 Task 3 — useChangelog published-only query filter (PU-03).
 *
 * Defense-in-depth half 2: the changelog_entries SELECT chain MUST include
 * `.eq('status', 'published')` so drafts/archived never reach the in-app
 * What's New drawer — even for an admin (whose RLS would otherwise let them
 * SELECT drafts). RLS (the migration) is half 1; this filter is half 2.
 *
 * Chainable supabase mock style (see changelog-store.test.ts makeBuilder).
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: mockGetSession },
    from: mockFrom,
  },
}));

interface BuilderResult {
  data: unknown;
  error: { message: string } | null;
}

/** Records every chained call so the test can assert the .eq('status',...) leg. */
function makeBuilder(result: BuilderResult, eqSpy: ReturnType<typeof vi.fn>) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: eqSpy.mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: BuilderResult) => unknown) => Promise.resolve(resolve(result)),
  };
  return builder;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockFrom.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useChangelog status filter (PU-03)', () => {
  it('the changelog_entries SELECT includes .eq("status","published")', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u-1' }, access_token: 'tok-1' } },
      error: null,
    });

    const entriesEqSpy = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'changelog_entries') {
        return makeBuilder({ data: [], error: null }, entriesEqSpy);
      }
      if (table === 'user_changelog_dismissed') {
        return makeBuilder({ data: { last_seen_published_at: null }, error: null }, vi.fn());
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { useChangelog } = await import('../changelog-store');
    const { result } = renderHook(() => useChangelog());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The SELECT chain must filter on the published status.
    expect(entriesEqSpy).toHaveBeenCalledWith('status', 'published');
  });
});
