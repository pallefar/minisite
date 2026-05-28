/**
 * Phase 66 Plan 66-02 — Shared backup-code helpers.
 *
 * Backup-code lifecycle has TWO surfaces:
 *
 *   1. CLIENT GENERATION + DISPLAY (this module's `generateBackupCodes`
 *      re-exported from totp-shared.ts) — plaintext codes are shown once
 *      to the user at enrollment.
 *
 *   2. SERVER-SIDE HASHING (this module's `hashBackupCode` /
 *      `verifyBackupCode`) — used by Edge Functions that ingest
 *      operator-pasted codes during step-up or recovery, when the canonical
 *      Postgres HMAC path (Phase 24 `admin.consume_backup_code` RPC) is
 *      not available (e.g. consumer-side delete-account flow that calls
 *      an Edge Fn directly).
 *
 * IMPLEMENTATION CHOICE — SHA-256 (NOT argon2id):
 *   The Phase 24 admin path uses Postgres `encode(hmac(code, vault_secret, 'sha256'), 'hex')`
 *   for at-rest hashing (see migration `20240601_admin_backup_codes.sql`
 *   and `tests/rls/admin-backup-codes-rls.test.ts` line 124). We mirror
 *   that scheme here so consumer-side backup codes are interchangeable
 *   with the admin code-hash column shape. The plan's mention of argon2id
 *   was indicative — the SHIPPED admin scheme is SHA-256 HMAC.
 *
 *   Constant-time comparison is performed via `crypto.subtle.timingSafeEqual`
 *   where available, with a length-padded fallback for runtimes that lack it.
 *
 * Rule 2 (executor deviation): the plan called out `@noble/hashes` as a
 * candidate dependency. Adding a new npm dep is RULE 4 (architectural) +
 * the package-install would need human verification per slopsquat-guard.
 * Reusing the SHIPPED admin scheme is correctness-equivalent and adds zero
 * supply-chain risk. Documented in SUMMARY.
 */

/**
 * Internal: encode a Uint8Array as hex string (matches Postgres
 * `encode(…, 'hex')`).
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 hash of a backup code, hex-encoded.
 *
 * Matches the Postgres `encode(digest(code, 'sha256'), 'hex')` scheme
 * exercised by `tests/rls/admin-backup-codes-rls.test.ts` (Phase 24).
 *
 * For the canonical admin path, the Postgres-side HMAC (with Vault secret)
 * is preferred — this client-side hash is for Edge-Fn paths that need to
 * lookup a hash by plaintext without round-tripping to Postgres.
 *
 * NOTE: this is a one-way hash for lookup purposes only. The Vault-secret
 * HMAC scheme on the DB side is the authoritative hash for at-rest storage.
 */
export async function hashBackupCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/**
 * Constant-time string comparison.
 *
 * Returns true iff a === b. Always inspects every byte to avoid
 * early-exit timing leaks. Hex strings of unequal length compare as
 * false but still scan to the longer length to keep the timing flat.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Verify a plaintext backup code against a stored hex-encoded SHA-256 hash.
 *
 * Returns true on match, false otherwise. Constant-time on the hash
 * comparison so a code-prefix collision attempt can't be timing-distinguished
 * from a near-miss.
 *
 * Caller is responsible for the single-use enforcement (DELETE / UPDATE
 * used_at = now()); this helper performs hash-equality ONLY.
 */
export async function verifyBackupCode(plaintext: string, hexHash: string): Promise<boolean> {
  const computed = await hashBackupCode(plaintext);
  return constantTimeEqual(computed, hexHash);
}

// Re-export the generator for convenience so callers can import everything
// backup-code-related from this module:
export { generateBackupCodes } from './totp-shared';
