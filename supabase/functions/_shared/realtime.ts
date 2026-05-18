/**
 * Phase 29 Plan 03 — Deno-compatible HMAC channel name helper for Edge Functions.
 *
 * Mirrors the logic in `src/lib/org-realtime.ts` (Phase 28 Plan 04) but
 * is self-contained under `supabase/functions/_shared/` so that Edge Functions
 * can import it without violating the A7 invariant from 28-ADDENDUM:
 * "Deno code lives in `_shared/`, never imported from `src/`."
 *
 * Unlike the browser-side version, this Deno variant does NOT cache the secret
 * (Edge Functions are short-lived and stateless; cold-start caching is irrelevant).
 * It accepts the raw hex secret directly so callers can retrieve it from Vault
 * via whatever mechanism their Edge Function uses.
 *
 * Topic naming convention (must match `realtime_topic_authorized` SQL helper):
 *   `org-{first8hex}-{suffix}`
 *
 * where `first8hex` is the first 8 hex chars (32 bits) of HMAC-SHA-256 over
 * the input string `{orgId}:{suffix}` with the Vault secret as the key.
 *
 * @see src/lib/org-realtime.ts — browser-side equivalent with session-level caching
 * @see supabase/migrations/20270601100016_realtime_topic_authorized_fn.sql
 */

/**
 * Compute the HMAC-SHA-256 channel name for the given org and suffix.
 *
 * @param orgId  - UUID of the organization
 * @param suffix - Channel suffix (e.g. 'subscriptions', 'org_members')
 * @param secretHex - 64-char hex string of the 32-byte Vault secret
 * @returns Channel name string matching `realtime_topic_authorized` SQL logic
 *
 * Format: `org-{first8hex}-{suffix}`
 */
export async function channelNameFromSecret(
  orgId: string,
  suffix: string,
  secretHex: string,
): Promise<string> {
  const bytes = new Uint8Array(secretHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secretHex.slice(i * 2, i * 2 + 2), 16);
  }

  const key = await crypto.subtle.importKey(
    'raw',
    bytes.buffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const input = new TextEncoder().encode(`${orgId}:${suffix}`);
  const signature = await crypto.subtle.sign('HMAC', key, input);

  const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `org-${hex.slice(0, 8)}-${suffix}`;
}

/**
 * Compute the HMAC channel name when the secret is already a raw ArrayBuffer.
 * Convenience overload for callers that keep the secret in decoded form.
 */
export async function channelNameFromBuffer(
  orgId: string,
  suffix: string,
  secretBuffer: ArrayBuffer,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const input = new TextEncoder().encode(`${orgId}:${suffix}`);
  const signature = await crypto.subtle.sign('HMAC', key, input);

  const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `org-${hex.slice(0, 8)}-${suffix}`;
}

/**
 * Simplified `channelNameFor` variant for handlers that receive the Vault secret
 * via a `get_realtime_channel_keying` RPC call already performed by the caller.
 *
 * This matches the naming used in the D-05 plan description so the
 * `subscription-updated.ts` handler can call:
 *   `channelNameFor(clinicId, 'subscriptions')`
 * after reading the secret from the RPC.
 *
 * The secret is expected as a 64-char hex string (identical contract to the
 * `get_realtime_channel_keying` RPC return value).
 */
export async function channelNameFor(
  orgId: string,
  suffix: string,
  secretHex?: string,
): Promise<string> {
  if (!secretHex) {
    // Fallback: deterministic non-HMAC name for environments without a secret
    // (e.g. unit tests where the RPC is unavailable). This is NOT secure —
    // only use in test mocks.
    return `org-no-secret-${suffix}`;
  }
  return channelNameFromSecret(orgId, suffix, secretHex);
}
