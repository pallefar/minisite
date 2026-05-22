/**
 * Phase 43 Plan 05 — useCurrentUserHasPro / invalidateProCache tests.
 *
 * Six behavior gates per the plan's <behavior> block:
 *   T1 — cold call → fetches tier_effective.has_active, caches result.
 *   T2 — second call within 60s → cache hit, NO supabase call.
 *   T3 — call after 60s TTL → re-fetches.
 *   T4 — 10001st distinct userId → evicts oldest (LRU).
 *   T5 — userId=null → { has_pro: false, loading: false } immediately, no fetch.
 *   T6 — invalidateProCache(userId) → clears the entry; next call re-fetches.
 *
 * Mock pattern: supabase.from('tier_effective').select(...).eq(...).maybeSingle()
 *               returns a configurable { data, error } payload.
 *               supabase.auth.getSession() returns a configurable user.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable mock state.
let mockSessionUser: { id: string } | null = null;
let mockTierEffectiveRow: { has_active: boolean } | null = null;
let maybeSingleCallCount = 0;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: mockSessionUser ? { user: mockSessionUser } : null },
        error: null,
      })),
    },
    from: vi.fn((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => {
        maybeSingleCallCount += 1;
        return { data: mockTierEffectiveRow, error: null };
      }),
    })),
  },
}));

async function importModule() {
  // Fresh import each test (caching is module-scope).
  vi.resetModules();
  return import('./current-user-has-pro');
}

beforeEach(() => {
  mockSessionUser = null;
  mockTierEffectiveRow = null;
  maybeSingleCallCount = 0;
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useCurrentUserHasPro + invalidateProCache', () => {
  it('T1: cold call fetches tier_effective.has_active and caches result', async () => {
    mockSessionUser = { id: 'user-A' };
    mockTierEffectiveRow = { has_active: true };
    const { useCurrentUserHasPro } = await importModule();

    const { result } = renderHook(() => useCurrentUserHasPro());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.has_pro).toBe(true);
    expect(maybeSingleCallCount).toBe(1);
  });

  it('T2: second call within 60s returns cached value with NO supabase call', async () => {
    mockSessionUser = { id: 'user-A' };
    mockTierEffectiveRow = { has_active: true };
    const { useCurrentUserHasPro } = await importModule();

    // First mount — populates cache.
    const first = renderHook(() => useCurrentUserHasPro());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(maybeSingleCallCount).toBe(1);

    // Second mount within TTL — should hit cache, no new fetch.
    const second = renderHook(() => useCurrentUserHasPro());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.has_pro).toBe(true);
    expect(maybeSingleCallCount).toBe(1); // unchanged
  });

  it('T3: call after 60s TTL re-fetches', async () => {
    mockSessionUser = { id: 'user-A' };
    mockTierEffectiveRow = { has_active: true };
    const { useCurrentUserHasPro } = await importModule();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

    const first = renderHook(() => useCurrentUserHasPro());
    await vi.waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(maybeSingleCallCount).toBe(1);

    // Advance past 60s TTL.
    vi.setSystemTime(new Date(2026, 0, 1, 12, 1, 1)); // +61s
    const second = renderHook(() => useCurrentUserHasPro());
    await vi.waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(maybeSingleCallCount).toBe(2); // re-fetched
  });

  it('T4: 10001st distinct userId evicts the oldest entry (LRU)', async () => {
    const { useCurrentUserHasPro, _proCacheSize, _proCacheHas } = await importModule();
    mockTierEffectiveRow = { has_active: true };

    // Seed 10_000 distinct user IDs through the cache.
    for (let i = 0; i < 10_000; i++) {
      mockSessionUser = { id: `user-${i}` };
      const r = renderHook(() => useCurrentUserHasPro());
      await waitFor(() => expect(r.result.current.loading).toBe(false));
    }
    expect(_proCacheSize()).toBe(10_000);
    expect(_proCacheHas('user-0')).toBe(true);

    // Insert the 10_001st → oldest (user-0) evicted.
    mockSessionUser = { id: 'user-10000' };
    const r = renderHook(() => useCurrentUserHasPro());
    await waitFor(() => expect(r.result.current.loading).toBe(false));
    expect(_proCacheSize()).toBe(10_000);
    expect(_proCacheHas('user-0')).toBe(false);
    expect(_proCacheHas('user-10000')).toBe(true);
  });

  it('T5: userId=null returns { has_pro: false, loading: false } immediately with no fetch', async () => {
    mockSessionUser = null;
    const { useCurrentUserHasPro } = await importModule();

    const { result } = renderHook(() => useCurrentUserHasPro());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.has_pro).toBe(false);
    expect(maybeSingleCallCount).toBe(0);
  });

  it('T6: invalidateProCache clears the entry; next call re-fetches', async () => {
    mockSessionUser = { id: 'user-A' };
    mockTierEffectiveRow = { has_active: true };
    const { useCurrentUserHasPro, invalidateProCache } = await importModule();

    const first = renderHook(() => useCurrentUserHasPro());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(maybeSingleCallCount).toBe(1);

    act(() => {
      invalidateProCache('user-A');
    });

    const second = renderHook(() => useCurrentUserHasPro());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(maybeSingleCallCount).toBe(2);
  });
});
