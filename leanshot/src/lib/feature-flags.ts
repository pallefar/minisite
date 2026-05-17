/**
 * Phase 19 Plan 19-04 Task 3 (BL-1 / D-23) — client-side feature-flag cache.
 *
 * Thin wrapper over `public.feature_flags` (migration 20270101000010). Loads
 * every flag row ONCE at app boot into a module-level Map and exposes
 * `useFeatureFlag(key)` as a React hook that re-renders subscribed components
 * when the cache is updated. No Zustand store; the cache is intentionally
 * lighter-weight (a single Map + a pub/sub Set).
 *
 * Why not a Zustand slice?
 *   - Flags don't mutate during a session; the cache is effectively immutable
 *     after `loadFeatureFlags` resolves. A persisted store + partialize would
 *     be cargo-culted complexity here.
 *   - Components only need re-render on the one-shot cache populate, which is
 *     exactly what the Set-of-subscribers pub/sub gives us in 30 lines.
 *
 * Boot path (called from `src/main.tsx`):
 *   1. hydrate() — Zustand persisted state (unchanged).
 *   2. void loadFeatureFlags(supabase) — fire-and-forget. If the first paint
 *      misses the result, subscribed components re-render when the cache
 *      populates.
 *   3. createRoot().render(...) — React mounts.
 *
 * Failure behavior: on lookup error the cache stays empty and every
 * `useFeatureFlag` call returns the default (`false`). The SignUpForm field
 * gated by `aff_manual_entry` simply stays hidden — the form keeps working.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

// ─── Module state ────────────────────────────────────────────────────────────
const flagCache = new Map<string, boolean>();
type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function notify(): void {
  subscribers.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error('[feature-flags] subscriber threw', err);
    }
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Populate the cache from `public.feature_flags`. Safe to call once at boot.
 * Errors fall through (cache stays empty → every `useFeatureFlag` returns
 * `false`). On success, notifies all subscribed hooks so currently-mounted
 * components re-render against the new state.
 */
export async function loadFeatureFlags(client: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await client.from('feature_flags').select('key, enabled');
    if (error) {
      console.error('[feature-flags] load error', error.message);
      return;
    }
    if (Array.isArray(data)) {
      for (const row of data as Array<{ key: string; enabled: boolean }>) {
        flagCache.set(row.key, Boolean(row.enabled));
      }
    }
    notify();
  } catch (err) {
    console.error('[feature-flags] load threw', err);
  }
}

/**
 * React hook — returns the current value of a flag (default `false`).
 * Re-renders when the cache is repopulated by `loadFeatureFlags` OR by
 * `setFlagForTest` in test contexts.
 */
export function useFeatureFlag(key: string): boolean {
  const [value, setValue] = useState<boolean>(() => flagCache.get(key) ?? false);
  useEffect(() => {
    const cb = (): void => setValue(flagCache.get(key) ?? false);
    subscribers.add(cb);
    // Resync on mount — covers the race where `loadFeatureFlags` resolved
    // BEFORE this component mounted (subscriber hadn't been added yet).
    cb();
    return () => {
      subscribers.delete(cb);
    };
  }, [key]);
  return value;
}

// ─── Test seams ──────────────────────────────────────────────────────────────

/** Test-only: set a flag value and notify subscribers. */
export function setFlagForTest(key: string, enabled: boolean): void {
  flagCache.set(key, enabled);
  notify();
}

/** Test-only: clear the entire cache + notify (returns subscribers to default). */
export function resetFlagsForTest(): void {
  flagCache.clear();
  notify();
}
