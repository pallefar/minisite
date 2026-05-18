/**
 * `_shared/profiles-locale.ts` — Phase 32 plan 32-05 (I18N-04).
 *
 * Edge-side locale resolver. Reads `profiles.locale` for a given userId,
 * caches the result in a per-isolate LRU (size 100) to avoid N+1 DB hits
 * during cron bursts (welcome-series + behavior-triggered run every 4h /
 * 15m respectively; same active users may be touched repeatedly).
 *
 * Contract (per D-08):
 *   - null/undefined userId      → 'en'   (DSAR + system emails)
 *   - DB error                   → 'en'   (defensive: never block email send
 *                                          on a locale lookup failure; warn)
 *   - profile.locale === 'es'    → 'es'
 *   - anything else (incl. null) → 'en'
 *
 * Cache semantics (per feedback_planner_iter1_anti_patterns.md — no hedge):
 *   - Plain Map LRU, NO TTL, NO stale-while-revalidate. If profiles.locale
 *     changes mid-cron-burst, the burst's emails go out with the older
 *     value — acceptable per Pitfall 4 (locale + unit are decoupled;
 *     locale changes are rare and a 4h re-deploy cycle replaces the cache).
 *   - LRU = re-insert on access (move to MRU); evict oldest (first key
 *     iteration order) on insertion at capacity.
 *
 * Test surface: `_shared/profiles-locale.test.ts`.
 */
// Use the npm: specifier so the type matches consumers that instantiate via
// `createClient` from npm:@supabase/supabase-js@2 (esm.sh and npm: variants
// produce nominally-different declarations even with identical runtime shape).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Locale = 'en' | 'es';

const CACHE_CAPACITY = 100;
const cache = new Map<string, Locale>();

function cacheTouch(key: string, value: Locale): void {
  // LRU: delete + re-insert moves the key to MRU end of iteration order.
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_CAPACITY) {
    // Evict the oldest (first iteration entry).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function cacheGet(key: string): Locale | undefined {
  if (!cache.has(key)) return undefined;
  const v = cache.get(key)!;
  // Move to MRU on access.
  cache.delete(key);
  cache.set(key, v);
  return v;
}

/**
 * Resolve a user's preferred locale, defaulting to 'en' on null userId,
 * cache miss + DB error, or any profile.locale value other than 'es'.
 *
 * Reads `profiles.locale` (single column) via service-role SupabaseClient.
 * The caller MUST pass a service-role-scoped client; this helper never
 * elevates privileges itself.
 */
export async function resolveLocale(
  userId: string | null | undefined,
  supabase: SupabaseClient,
): Promise<Locale> {
  if (!userId) return 'en';

  const cached = cacheGet(userId);
  if (cached !== undefined) return cached;

  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase
      .from('profiles')
      .select('locale')
      .eq('id', userId)
      .single() as unknown as Promise<{ data: { locale?: string | null } | null; error: { message?: string } | null }>);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (error) {
      console.warn(
        `[profiles-locale] DB error for user=${userId.slice(0, 8)} — defaulting to en: ${error.message ?? 'unknown'}`,
      );
      // Do NOT cache the error result — the next request may succeed.
      return 'en';
    }

    const raw = (data?.locale ?? '').toString();
    const resolved: Locale = raw === 'es' ? 'es' : 'en';
    cacheTouch(userId, resolved);
    return resolved;
  } catch (e) {
    console.warn(
      `[profiles-locale] threw for user=${userId.slice(0, 8)} — defaulting to en: ${
        e instanceof Error ? e.message : 'unknown'
      }`,
    );
    return 'en';
  }
}

/** Test seam — exposed for unit tests to reset cache between cases. */
export const __internal = {
  cacheSize: () => cache.size,
  cacheClear: () => cache.clear(),
  CACHE_CAPACITY,
};
