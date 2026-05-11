/**
 * Per-user rate-limit helper for the `ai-chat` Edge Function.
 *
 * Phase 4 D-01 + AI-02 + T-04-02 mitigation.
 *
 * Calls the security-definer `increment_rate_limit` RPC (authored in
 * `supabase/migrations/20260512000001_rate_limit_counters.sql`) across three
 * sliding windows. Thresholds from `.planning/decisions/supabase.md`:
 *   minute → 30 hits
 *   hour   → 60 hits
 *   day    → 200 hits
 *
 * Fail-OPEN posture (RESEARCH §5 line 1314): if the RPC errors (DB hiccup,
 * connection blip), we log and continue rather than locking the user out.
 * The Moonshot account's own billing cap is the real backstop; an Edge
 * Function-level rate-limit failure must not degrade UX.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

interface WindowConfig {
  name: 'minute' | 'hour' | 'day';
  limit: number;
}

const WINDOWS: readonly WindowConfig[] = [
  { name: 'minute', limit: 30 },
  { name: 'hour', limit: 60 },
  { name: 'day', limit: 200 },
] as const;

/** Truncate `d` to the start of the given window. */
function bucketStart(d: Date, window: WindowConfig['name']): Date {
  const out = new Date(d.getTime());
  if (window === 'minute') {
    out.setSeconds(0, 0);
  } else if (window === 'hour') {
    out.setMinutes(0, 0, 0);
  } else {
    out.setHours(0, 0, 0, 0);
  }
  return out;
}

/**
 * Returns `false` if any of the minute/hour/day windows is over its limit,
 * otherwise `true`. Fails OPEN on RPC error (logs + continues — does not
 * return `false` on infrastructure failure).
 */
export async function checkAndIncrement(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const now = new Date();
  for (const w of WINDOWS) {
    const start = bucketStart(now, w.name);
    const { data, error } = await admin.rpc('increment_rate_limit', {
      p_user_id: userId,
      p_window: w.name,
      p_bucket_start: start.toISOString(),
    });
    if (error) {
      // Fail OPEN — DB hiccup must not lock users out.
      console.error('[ai-chat] rate-limit RPC error', error.message);
      continue;
    }
    const hits = typeof data === 'number' ? data : Number(data);
    if (Number.isFinite(hits) && hits > w.limit) {
      return false;
    }
  }
  return true;
}
