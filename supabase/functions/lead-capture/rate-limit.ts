/**
 * Per-IP rate-limit helper for the `lead-capture` Edge Function (Phase 15
 * Plan 15-07).
 *
 * Threshold: 5 submissions per 15-minute window per IP-hash. The 6th
 * submission from the same hashed IP in the window must return HTTP 429.
 *
 * Implementation: a Postgres-counter check against the `public.leads` table
 * itself. We `SELECT count(*)` filtered by `(ip_hash = $1 AND created_at >
 * now() - interval '15 minutes')` using the service-role admin client. This
 * sidesteps a dedicated rate-limit table (D-12 + RESEARCH Pattern 6 / A4 —
 * avoid Upstash for this surface) by using the leads table as its own
 * counter source.
 *
 * Caveat: honeypot-flagged rows still count toward the limit. That is
 * intentional — a bot ramming the form should be slowed by the same gate.
 * The `honeypot_flagged` column lets staff segment after the fact if
 * needed.
 *
 * Fail-OPEN posture (carried forward from `clinic-invite/rate-limit.ts`):
 *   Infrastructure errors (DB hiccup, network timeout, anything) MUST NOT
 *   lock legitimate users out. The helper returns `true` (allow) on any
 *   internal failure and logs a stable string.
 *
 * Test seam: `_setCountForTest(n)` overrides the count for the next call
 * (one-shot). The Deno suite uses this to assert the 5-then-429 gate
 * without standing up a real DB.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const RATE_LIMIT_THRESHOLD = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Returns `true` if a new submission from this IP is allowed (count < 5 in
 * the past 15 minutes), `false` if it should be rejected with HTTP 429.
 * Fails OPEN on any error.
 */
export async function checkLeadRateLimit(
  admin: SupabaseClient,
  ipHash: string,
): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    // The supabase-js client returns `count` directly on a `head: true,
    // count: 'exact'` query — no row data is shipped over the wire.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const q = admin
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', windowStart) as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const res = await q;
    if (res?.error) {
      // Fail OPEN — DB hiccup must not lock visitors out.
      console.error('[lead-capture] rate-limit query error', res.error.message ?? 'unknown');
      return true;
    }
    const count = typeof res?.count === 'number' ? res.count : 0;
    return count < RATE_LIMIT_THRESHOLD;
  } catch (e) {
    console.error(
      '[lead-capture] rate-limit threw',
      e instanceof Error ? e.message : 'unknown',
    );
    return true;
  }
}
