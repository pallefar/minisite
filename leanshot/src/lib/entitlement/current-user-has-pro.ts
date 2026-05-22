/**
 * Phase 43 Plan 05 — useCurrentUserHasPro hook + invalidateProCache helper.
 *
 * Purpose: MEMBER-04 D-13 — client-side entitlement check with bounded-staleness
 * cache (60s TTL) so that PaywallUpsell + downstream gating UI can synchronously
 * decide whether to show paid content without hammering supabase on every render.
 *
 * Cache shape:
 *   - Module-scope `Map<userId, { value: boolean; expiresAt: number }>`.
 *   - Insertion-order iteration (JS Map guarantee) backs LRU eviction.
 *   - MAX_ENTRIES=10_000 cap with oldest-first eviction (T-43-05-04 mitigation).
 *   - TTL_MS=60_000 (D-13 bounded staleness; admin can call invalidateProCache
 *     on tier downgrade to short-circuit the 60s window).
 *
 * Cross-user isolation (RESEARCH Pitfall 9 / T-43-05-02 mitigation): every cache
 * read/write is keyed on the userId returned by supabase.auth.getSession(); a
 * sign-out → sign-in to a different account misses the cache and re-fetches.
 *
 * RLS: tier_effective is a security_invoker view; the .eq('user_id', userId)
 * filter combined with the underlying subscriptions / lifetime_purchases
 * self-read policies prevents cross-user reads at the DB layer too.
 *
 * The exported `_proCacheSize` + `_proCacheHas` helpers are TEST-ONLY visibility
 * hooks; they are NOT part of the supported public API for product code.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

// Module-scope cache. Map preserves insertion order → first key is oldest.
const cache = new Map<string, CacheEntry>();

function readCache(userId: string): boolean | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(userId);
    return null;
  }
  return entry.value;
}

function writeCache(userId: string, value: boolean): void {
  // LRU eviction: at capacity, drop the oldest (first-inserted) entry.
  // Only evict when we are inserting a NEW key — overwriting an existing key
  // would otherwise spuriously drop another entry.
  if (!cache.has(userId) && cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  // Re-insertion (delete + set) is intentional: ensures the just-touched key
  // moves to the end of insertion order — needed so subsequent eviction
  // targets the genuinely-oldest entry.
  cache.delete(userId);
  cache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
}

export function invalidateProCache(userId: string | null): void {
  if (!userId) return;
  cache.delete(userId);
}

export function useCurrentUserHasPro(): { has_pro: boolean; loading: boolean } {
  const [state, setState] = useState<{ has_pro: boolean; loading: boolean }>({
    has_pro: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // 1. Resolve current userId via the existing supabase auth singleton.
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id ?? null;

      if (!userId) {
        if (!cancelled) setState({ has_pro: false, loading: false });
        return;
      }

      // 2. Cache hit — synchronous return, no network call.
      const cached = readCache(userId);
      if (cached !== null) {
        if (!cancelled) setState({ has_pro: cached, loading: false });
        return;
      }

      // 3. Cache miss — query the tier_effective view (RLS self-read).
      try {
        const { data, error } = await supabase
          .from('tier_effective')
          .select('has_active')
          .eq('user_id', userId)
          .maybeSingle();
        const hasPro = !error && !!data?.has_active;
        writeCache(userId, hasPro);
        if (!cancelled) setState({ has_pro: hasPro, loading: false });
      } catch {
        // Fail-closed: treat fetch errors as "not pro" rather than blocking UI.
        if (!cancelled) setState({ has_pro: false, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ─── Test-only visibility hooks (NOT a public API) ──────────────────────────

/** @internal test-only */
export function _proCacheSize(): number {
  return cache.size;
}

/** @internal test-only */
export function _proCacheHas(userId: string): boolean {
  return cache.has(userId);
}

/**
 * @internal test-only — populates the cache directly without going through
 * the hook → supabase round trip. Used by the LRU-eviction test to seed
 * MAX_ENTRIES-1 entries in O(1) per entry instead of O(network).
 */
export function _proCachePut(userId: string, value: boolean): void {
  writeCache(userId, value);
}

/** @internal test-only */
export function _proCacheClear(): void {
  cache.clear();
}
