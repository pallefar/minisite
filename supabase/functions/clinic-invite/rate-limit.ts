/**
 * Per-key rate-limit helpers for the `clinic-invite` Edge Function
 * (Phase 9 Plan 09-06).
 *
 * Three key families per the plan's must_haves.truths:
 *   - `clinic_invite_send:{operator_uid}`   — 20/hour  (DB-backed via Phase 4)
 *   - `clinic_invite_lookup:{ip_or_token}`  — 10/minute (in-memory per instance)
 *   - `clinic_invite_accept:{invite_id}`    — 5/minute  (in-memory per instance)
 *
 * Why two backends?
 *   The Phase 4 `increment_rate_limit` RPC was authored with a `p_user_id uuid`
 *   parameter that has a foreign-key reference to `auth.users(id)`. For
 *   operator `/send` calls we have the operator's verified `user.id` and can
 *   key on that perfectly. But for anonymous `/lookup` (by IP or by hashed
 *   token) and acceptance `/accept` (by invite_id which isn't an auth.users
 *   row), the FK rejects synthesized keys. Rather than ship a new DB-side
 *   table just for clinic rate-limit keys, we use an in-memory Map per Deno
 *   instance for those two families. This is intentional:
 *
 *     a) The brute-force threat model for /lookup (T-09-32) is satisfied
 *        because 128-bit tokens are infeasible to guess even at unlimited
 *        QPS. The 10/min/IP limit just papers over the noise from a
 *        misconfigured client; it is NOT the security floor.
 *     b) /accept is JWT-authed and the consumed_at flag in the invites row
 *        is the actual replay barrier. The 5/min/invite_id throttle just
 *        defends against pathological client retry loops.
 *
 *   Phase 10 may upgrade these to a Redis-backed limiter or a non-FK-bound
 *   rate_limit_keys table; this implementation is the minimum that satisfies
 *   the plan's must_haves without over-investing in infra for low-leverage
 *   limits.
 *
 * Fail-OPEN posture (carries forward Phase 4 RESEARCH §5 line 1314):
 *   Infrastructure errors (DB hiccup, Map full, anything) MUST NOT lock
 *   legitimate users out. Every helper here returns `true` (allow) on its
 *   own internal failure.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// =============================================================================
// DB-backed: operator /send rate limit
// =============================================================================

/**
 * Returns `false` if the operator has sent more than 20 invites in the
 * current hour bucket, otherwise `true`. Fails OPEN on RPC error.
 *
 * Implementation note: we reuse the Phase 4 `increment_rate_limit` RPC
 * which keys on (user_id, window, bucket_start). We pass `window='hour'`
 * and the start-of-hour bucket. Threshold of 20 is local to this helper
 * (Phase 4's helper hard-coded 60/hour for ai-chat).
 */
export async function checkSendRateLimit(
  admin: SupabaseClient,
  operatorUid: string,
): Promise<boolean> {
  try {
    const now = new Date();
    const bucketStart = new Date(now.getTime());
    bucketStart.setMinutes(0, 0, 0);
    const { data, error } = await admin.rpc('increment_rate_limit', {
      p_user_id: operatorUid,
      p_window: 'hour',
      p_bucket_start: bucketStart.toISOString(),
    });
    if (error) {
      // Fail OPEN — DB hiccup must not lock operators out.
      console.error('[clinic-invite] send rate-limit RPC error', error.message);
      return true;
    }
    const hits = typeof data === 'number' ? data : Number(data);
    if (Number.isFinite(hits) && hits > 20) {
      return false;
    }
    return true;
  } catch (e) {
    console.error(
      '[clinic-invite] send rate-limit threw',
      e instanceof Error ? e.message : 'unknown',
    );
    return true;
  }
}

// =============================================================================
// In-memory: anonymous /lookup + JWT-authed /accept rate limits
// =============================================================================

interface InMemoryBucket {
  windowStartMs: number;
  hits: number;
}

const LOOKUP_BUCKETS = new Map<string, InMemoryBucket>();
const ACCEPT_BUCKETS = new Map<string, InMemoryBucket>();

const LOOKUP_LIMIT = 10;
const LOOKUP_WINDOW_MS = 60_000; // 1 minute
const ACCEPT_LIMIT = 5;
const ACCEPT_WINDOW_MS = 60_000; // 1 minute

/** Cheap GC — drop expired buckets when a map grows beyond a soft cap. */
function gc(map: Map<string, InMemoryBucket>, windowMs: number, now: number): void {
  if (map.size < 1024) return;
  for (const [k, b] of map) {
    if (now - b.windowStartMs > windowMs * 2) map.delete(k);
  }
}

function incrementInMemory(
  map: Map<string, InMemoryBucket>,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  gc(map, windowMs, now);
  const existing = map.get(key);
  if (!existing || now - existing.windowStartMs >= windowMs) {
    map.set(key, { windowStartMs: now, hits: 1 });
    return true;
  }
  existing.hits += 1;
  return existing.hits <= limit;
}

/**
 * Returns `false` if the key has exceeded 10 lookups in the past 60s,
 * otherwise `true`. The key is typically the client IP (when available)
 * or the truncated token hash. Pitfall #12 brute-force defense.
 */
export function checkLookupRateLimit(key: string): boolean {
  try {
    return incrementInMemory(LOOKUP_BUCKETS, key, LOOKUP_LIMIT, LOOKUP_WINDOW_MS);
  } catch {
    return true; // fail OPEN
  }
}

/**
 * Returns `false` if the invite_id has been used more than 5 times in
 * the past 60s, otherwise `true`. Defends against pathological client
 * retry loops; the consumed_at flag is the real replay barrier.
 */
export function checkAcceptRateLimit(inviteId: string): boolean {
  try {
    return incrementInMemory(ACCEPT_BUCKETS, inviteId, ACCEPT_LIMIT, ACCEPT_WINDOW_MS);
  } catch {
    return true; // fail OPEN
  }
}

// Exported for unit-test reset.
export function _resetInMemoryRateLimits(): void {
  LOOKUP_BUCKETS.clear();
  ACCEPT_BUCKETS.clear();
}
