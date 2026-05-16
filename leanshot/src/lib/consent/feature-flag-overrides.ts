/**
 * Phase 22 Plan 22-06 — D-08 per-user feature-flag override wrapper.
 *
 * Provides a thin, overrides-first PostHog gate for admin-set per-user
 * feature flags (ADMIN-05). The override cache lives in module scope and
 * is populated once per session via `loadOverrides(currentUserId)` —
 * intended to be wired into the App.tsx post-auth mount path by plan 22-12
 * (NOT here — Pre-emptive warning 4 shared-file choreography).
 *
 * SECURITY contract:
 *   - The SELECT uses a SQL-side `.gt('expires_at', now)` filter
 *     (22-PATTERNS Pitfall 10) so the database returns only currently-active
 *     rows. We re-check `exp > Date.now()` at lookup time as defense-in-depth
 *     against the race where the cache was populated just before expiry.
 *   - RLS policy `feature_flag_overrides_select_own` restricts reads to
 *     `auth.uid() = user_id`, so loadOverrides is safe to call with the
 *     current user id (a hostile user cannot pre-poison the cache with
 *     another user's overrides via this read path).
 *
 * Why module-level Map (not Zustand) — mirrors `src/lib/feature-flags.ts`
 * rationale: overrides don't mutate per-render; one-shot load + sync read.
 */
import posthog from 'posthog-js';
import { supabase } from '@/lib/supabase';

interface OverrideEntry {
  value: boolean;
  exp: number;
}

const overrideCache = new Map<string, OverrideEntry>();

/**
 * Populate the override cache for `userId`. Idempotent — calling twice
 * reseeds the cache (a re-fetch after an override expires will not surface
 * the row, so the existing entry simply lingers until clearOverrideCache).
 * Errors fall through (cache stays empty / unchanged) so a transient
 * Supabase outage degrades to "PostHog default" rather than "feature off".
 */
export async function loadOverrides(userId: string): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('feature_flag_overrides')
      .select('flag_key, value, expires_at')
      .eq('user_id', userId)
      .gt('expires_at', nowIso);
    if (error) {
      console.error('[feature-flag-overrides] load error', error.message);
      return;
    }
    if (Array.isArray(data)) {
      for (const row of data as Array<{
        flag_key: string;
        value: boolean;
        expires_at: string;
      }>) {
        overrideCache.set(row.flag_key, {
          value: Boolean(row.value),
          exp: new Date(row.expires_at).getTime(),
        });
      }
    }
  } catch (err) {
    console.error('[feature-flag-overrides] load threw', err);
  }
}

/**
 * Sync, overrides-first feature flag check.
 *   1. If `flagKey` is in the cache AND its exp is in the future → return
 *      the override value. PostHog is NOT consulted.
 *   2. Otherwise → return `posthog.isFeatureEnabled(flagKey)` (`false` if
 *      PostHog isn't loaded or returns undefined).
 */
export function isFeatureEnabledWithOverride(flagKey: string): boolean {
  const entry = overrideCache.get(flagKey);
  if (entry && entry.exp > Date.now()) {
    return entry.value;
  }
  // PostHog returns `boolean | undefined` (undefined when flag not loaded).
  const ph = posthog.isFeatureEnabled(flagKey);
  return ph === true;
}

/** Test-only / logout helper — empties the override cache. */
export function clearOverrideCache(): void {
  overrideCache.clear();
}
