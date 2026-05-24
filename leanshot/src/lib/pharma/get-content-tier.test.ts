/**
 * Phase 39 Plan 39-05 Task 1 — getContentTier tests.
 *
 * Contract: `getContentTier(): Promise<'pro' | 'free'>`.
 *
 * Implementation reads tier_effective.has_active (Phase 19/43 contract) via
 * the same supabase query the `useCurrentUserHasPro` hook uses (Plan 43-05),
 * leveraging the module-scope LRU cache exposed by current-user-has-pro.ts
 * so PharmaContentBlock's render doesn't pay a network round-trip on every
 * mount when the entitlement is already cached.
 *
 * Why has_active (NOT a tier='paid' string match): Phase 43 D-04 unified
 * Pro subscription + Lifetime + Trial into the single boolean — string
 * matching on tier would silently miss Lifetime users.
 *
 * Branches:
 *   T1: signed-in + has_active=true                 -> 'pro'
 *   T2: signed-in + has_active=false (trialing)     -> 'free'
 *   T3: signed-in + tier_effective query errors     -> 'free' (fail-closed)
 *   T4: anonymous (no session)                      -> 'free'
 *   T5: signed-in + Lifetime tier (has_active=true) -> 'pro'
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();
const supabaseGetSessionMock = vi.fn<() => Promise<{ data: { session: { user: { id: string } } | null } }>>();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => supabaseGetSessionMock() },
    from: (table: string) => fromMock(table),
  },
}));

import { getContentTier, _clearTierCacheForTest } from './get-content-tier';

function buildFromChain(result: { data: { has_active: boolean } | null; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => result,
      }),
    }),
  };
}

describe('getContentTier', () => {
  beforeEach(() => {
    fromMock.mockReset();
    supabaseGetSessionMock.mockReset();
    _clearTierCacheForTest();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("T1: returns 'pro' when tier_effective.has_active=true for current user", async () => {
    supabaseGetSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-pro-1' } } } });
    fromMock.mockReturnValue(buildFromChain({ data: { has_active: true }, error: null }));
    await expect(getContentTier()).resolves.toBe('pro');
    expect(fromMock).toHaveBeenCalledWith('tier_effective');
  });

  it("T2: returns 'free' when tier_effective.has_active=false (trialing or non-paying)", async () => {
    supabaseGetSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-trial-1' } } } });
    fromMock.mockReturnValue(buildFromChain({ data: { has_active: false }, error: null }));
    await expect(getContentTier()).resolves.toBe('free');
  });

  it("T3: returns 'free' when query errors (fail-closed default)", async () => {
    supabaseGetSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-err-1' } } } });
    fromMock.mockReturnValue(buildFromChain({ data: null, error: new Error('rls denied') }));
    await expect(getContentTier()).resolves.toBe('free');
  });

  it("T4: returns 'free' when no session (anonymous user) — never queries supabase", async () => {
    supabaseGetSessionMock.mockResolvedValue({ data: { session: null } });
    await expect(getContentTier()).resolves.toBe('free');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("T5: Lifetime user resolves has_active=true → 'pro' (Phase 43 contract: NO tier-string match)", async () => {
    // Lifetime is encoded as has_active=true in tier_effective; legacy string-match
    // on tier='paid' would have missed this. The plan-mandated path reads has_active only.
    supabaseGetSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-lifetime-1' } } } });
    fromMock.mockReturnValue(buildFromChain({ data: { has_active: true }, error: null }));
    await expect(getContentTier()).resolves.toBe('pro');
  });

  it("T6: cache hit on second call avoids second supabase query", async () => {
    supabaseGetSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-cache-1' } } } });
    fromMock.mockReturnValue(buildFromChain({ data: { has_active: true }, error: null }));
    await expect(getContentTier()).resolves.toBe('pro');
    expect(fromMock).toHaveBeenCalledTimes(1);
    await expect(getContentTier()).resolves.toBe('pro');
    expect(fromMock).toHaveBeenCalledTimes(1); // still 1 — cache served
  });
});
