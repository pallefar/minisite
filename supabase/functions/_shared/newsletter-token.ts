/**
 * newsletter-token.ts — HMAC sign + constant-time-compare helpers.
 *
 * Phase 60 Plan 60-12 Task 2.
 *
 * === Auth design (two-layer) ===
 *
 * PRIMARY auth boundary (per [[feedback_rls_stored_token_verification_pattern]]):
 *   The stored `newsletter_subscribers.unsubscribe_token` (32-byte base64 value
 *   set at row creation time). The unsubscribe Fn fetches this value via an
 *   anon-client SELECT (RLS allows token+opted_in read by user_id key) and uses
 *   `constantTimeEqual` to compare against the presented token. A match is the
 *   authorization to flip opted_in=false.
 *
 * DEFENSE-IN-DEPTH layer (this file):
 *   An HMAC-SHA256 envelope wraps the URL carrying the token. The sender Fn
 *   mints this envelope using `mintUnsubscribeToken`; the unsubscribe Fn
 *   optionally verifies it with `verifyUnsubscribeToken`. The HMAC catches
 *   tampered URL parameters (man-in-the-middle swapping the user_id or
 *   token value) before the DB query fires — adding tamper-evidence even
 *   when the DB row has not yet rotated.
 *
 * This design means:
 *   - A valid stored-token match is REQUIRED (primary auth).
 *   - A valid HMAC is OPTIONAL but checked if present (defense-in-depth).
 *   - Neither check uses `===` string comparison. Both use `constantTimeEqual`
 *     to prevent timing-based token enumeration.
 */

// ─── constantTimeEqual ──────────────────────────────────────────────────────

/**
 * Constant-time string comparison. Returns true iff a === b, with no
 * early-exit on mismatch to prevent timing-based side-channel attacks.
 *
 * Implementation: bitwise OR-reduce over character codes. When lengths
 * differ, the shorter string is virtually zero-padded by coercing out-of-
 * bounds char codes to 0. Length difference is captured in `diff` so the
 * result is false even when one string is a prefix of the other.
 *
 * NOTE: For comparing binary buffers use Web Crypto `crypto.subtle.timingSafeEqual`
 * if available. This function is for base64url string comparison.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length; // captures length mismatch
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ─── mintUnsubscribeToken ───────────────────────────────────────────────────

/**
 * Mint an HMAC-SHA256 tamper-evidence envelope for an unsubscribe URL.
 *
 * The HMAC is over `${userId}:${storedToken}` with the signing key.
 * Result is base64url-encoded (no padding, `+`→`-`, `/`→`_`).
 *
 * Per [[reference_base64url_postgres_vercel_mint_verify]]: use consistent
 * replace-chain to avoid silent mismatch when the Postgres side generates
 * tokens with `+/=` and the TS side strips/replaces differently.
 */
export async function mintUnsubscribeToken(opts: {
  userId: string;
  storedToken: string;
  signingKey: string;
}): Promise<string> {
  const { userId, storedToken, signingKey } = opts;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = encoder.encode(`${userId}:${storedToken}`);
  const signature = await crypto.subtle.sign('HMAC', keyMaterial, message);

  // Convert ArrayBuffer to base64url (replace-chain per [[reference_base64url_postgres_vercel_mint_verify]])
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ─── verifyUnsubscribeToken ─────────────────────────────────────────────────

/**
 * Verify a presented HMAC envelope against the expected mint result.
 *
 * Recomputes `mintUnsubscribeToken` and uses `constantTimeEqual` to compare
 * — NEVER uses `===` for the HMAC comparison.
 *
 * Returns false (not throws) on mismatch so callers can produce a generic
 * 400 without leaking error detail (T-60-12-01).
 */
export async function verifyUnsubscribeToken(opts: {
  userId: string;
  storedToken: string;
  signingKey: string;
  presentedToken: string;
}): Promise<boolean> {
  const { userId, storedToken, signingKey, presentedToken } = opts;
  const expected = await mintUnsubscribeToken({ userId, storedToken, signingKey });
  return constantTimeEqual(presentedToken, expected);
}
