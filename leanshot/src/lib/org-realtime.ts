/**
 * Phase 28 Plan 04 — HMAC-derived realtime channel name generator.
 *
 * Provides per-org HMAC-authenticated channel names for Supabase Realtime.
 * The HMAC is computed client-side using the Web Crypto API (crypto.subtle)
 * with the secret fetched once per session via the `get_realtime_channel_keying`
 * SECDEF RPC (migration 20270601100016).
 *
 * Topic naming convention (must match `realtime_topic_authorized` SQL helper):
 *   `org-{first8hex}-{table}`
 *
 * where `first8hex` is the first 8 hex chars (32 bits) of HMAC-SHA-256 over
 * the input string `{orgId}:{table}` with the Vault secret as the key.
 *
 * Security notes:
 *   - 32-bit HMAC truncation has ~3% birthday-bound collision at 10K orgs × 50
 *     tables scale (Pitfall 2). Defense-in-depth: the RLS policy helper ALSO
 *     checks that the matching org_id is in the caller's JWT claim list, so a
 *     collision alone is insufficient to gain access.
 *   - The secret is cached per module load (cleared via `_clearSecretCache()`
 *     in tests). Browser memory is cleared on page reload / session end.
 *   - `get_realtime_channel_keying` is a SECDEF RPC gated to `authenticated`
 *     only; unauthenticated callers receive a 403.
 *
 * This module DOES NOT modify `src/lib/clinic-realtime.ts`.
 * Compose with Phase 9 setAuth-before-subscribe pattern by calling
 * `supabase.realtime.setAuth()` before subscribing to the channel name
 * returned by `channelNameFor(orgId, table)` — same invariant as Pitfall #2.
 *
 * @see src/lib/clinic-realtime.ts — setAuth-before-subscribe + defer-mount safety
 * @see supabase/migrations/20270601100016_realtime_topic_authorized_fn.sql
 */

import { supabase } from './supabase';

/**
 * Module-level secret cache: decoded as ArrayBuffer so Web Crypto can
 * import it directly without repeated hex decoding.
 *
 * Initialized to null; lazily populated on first `channelNameFor` call.
 * Test-only: call `_clearSecretCache()` between test runs.
 */
let _cachedSecretBuffer: ArrayBuffer | null = null;

/**
 * Fetch the realtime channel secret from the SECDEF RPC and decode the
 * hex string into an ArrayBuffer for crypto.subtle.importKey.
 *
 * Caches the result for the lifetime of the module (one RPC call per session).
 */
async function _getSecretBuffer(): Promise<ArrayBuffer> {
  if (_cachedSecretBuffer !== null) return _cachedSecretBuffer;

  const { data, error } = await supabase.rpc('get_realtime_channel_keying');
  if (error)
    throw new Error(`org-realtime: get_realtime_channel_keying RPC failed: ${error.message}`);
  if (!data || typeof data !== 'string') {
    throw new Error(
      'org-realtime: get_realtime_channel_keying returned no data (Vault secret missing?)',
    );
  }

  // Decode 64-char hex string → 32-byte Uint8Array → ArrayBuffer.
  const hex = data as string;
  if (hex.length !== 64) {
    throw new Error(
      `org-realtime: unexpected secret length ${hex.length} (expected 64 hex chars = 32 bytes)`,
    );
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  _cachedSecretBuffer = bytes.buffer;
  return _cachedSecretBuffer;
}

/**
 * Compute the HMAC-SHA-256 channel name for the given org and table.
 *
 * The returned string uniquely (probabilistically) identifies the realtime
 * channel for `(orgId, table)` without embedding the raw org UUID — clients
 * must know the secret to compute a valid channel name.
 *
 * Format: `org-{first8hex}-{table}`
 *   - `first8hex`: first 8 lowercase hex chars of HMAC-SHA-256 over `{orgId}:{table}`
 *   - `table`: the raw table name (e.g. `org_members`, `org_invites`)
 *
 * IMPORTANT: The channel name must be used with `supabase.channel(name, { config: { private: true } })`
 * and `await supabase.realtime.setAuth()` BEFORE calling `.subscribe()` — same
 * as the Phase 9 clinic-realtime pattern (Pitfall #2 invariant).
 *
 * @param orgId - UUID of the organization (from JWT app_metadata.org_ids)
 * @param table - Lowercase table name (e.g. 'org_members')
 * @returns Channel name string matching `realtime_topic_authorized` SQL logic
 */
export async function channelNameFor(orgId: string, table: string): Promise<string> {
  const secretBuffer = await _getSecretBuffer();

  const key = await crypto.subtle.importKey(
    'raw',
    secretBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const input = new TextEncoder().encode(`${orgId}:${table}`);
  const signature = await crypto.subtle.sign('HMAC', key, input);

  // Encode the full 32-byte HMAC as lowercase hex, then take first 8 chars.
  const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `org-${hex.slice(0, 8)}-${table}`;
}

/**
 * Clear the cached secret buffer. TEST-ONLY — exported so vitest can reset
 * module state between test cases without a full module reload.
 *
 * Do NOT call in production code: caching is intentional to avoid repeated
 * RPC round-trips on every channel subscription.
 */
export function _clearSecretCache(): void {
  _cachedSecretBuffer = null;
}
