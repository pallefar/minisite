/**
 * Phase 39 Plan 39-05 Task 1 — getContentTier helper.
 *
 * Returns 'pro' | 'free' from a Promise. The async shape exists because the
 * canonical entitlement source is the `tier_effective` Supabase view (Phase
 * 19 D-04 / Phase 43 contract) — there is no synchronous in-Zustand mirror
 * of `has_active` (the existing store has a `tier` field but the plan
 * mandates we MUST NOT do a tier-string match: Lifetime users would be
 * misclassified).
 *
 * Local cache (module-scope LRU, MAX_ENTRIES=10_000, TTL_MS=60_000) is kept
 * separate from the `current-user-has-pro` cache so that invalidations on
 * either side stay independent (the entitlement hook in Phase 43-05 already
 * exposes invalidateProCache for sub upgrades/downgrades; PharmaContentBlock
 * tier checks do not need the same hook surface, and we want a clear blast
 * radius).
 *
 * Fail-closed: query errors, missing session, or null `has_active` all
 * resolve to 'free' — safer than fail-open since leaking Pro pharma copy
 * to a free user is regulator-visible per D-05.
 */
import { supabase } from '@/lib/supabase';

const TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;

interface CacheEntry {
  value: 'pro' | 'free';
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function readCache(userId: string): 'pro' | 'free' | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(userId);
    return null;
  }
  return entry.value;
}

function writeCache(userId: string, value: 'pro' | 'free'): void {
  if (!cache.has(userId) && cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.delete(userId);
  cache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
}

/**
 * Resolve the current user's effective content tier.
 *
 * Returns 'pro' when `tier_effective.has_active === true` (covers paid
 * subscription, lifetime purchase, and any other has_active=true source the
 * view subsumes per Phase 43 D-04).
 *
 * Returns 'free' for anonymous users, trialing/non-paying users, query
 * errors, missing rows, and any other ambiguity (fail-closed).
 */
export async function getContentTier(): Promise<'pro' | 'free'> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id ?? null;
  if (!userId) return 'free';

  const cached = readCache(userId);
  if (cached !== null) return cached;

  try {
    const { data, error } = await supabase
      .from('tier_effective')
      .select('has_active')
      .eq('user_id', userId)
      .maybeSingle();
    const hasActive = !error && Boolean(data?.has_active);
    const tier: 'pro' | 'free' = hasActive ? 'pro' : 'free';
    writeCache(userId, tier);
    return tier;
  } catch {
    return 'free';
  }
}

/** @internal test-only — flushes the module-scope cache between tests. */
export function _clearTierCacheForTest(): void {
  cache.clear();
}
