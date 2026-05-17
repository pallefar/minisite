/**
 * Phase 24 Plan 24-05 — TOTP client helper for admin MFA enrollment + step-up.
 *
 * D-07: TOTP via Supabase Auth mfa.enroll/challenge/verify (factor type 'totp').
 * D-08: 10 backup codes issued server-side via admin.issue_backup_codes() RPC.
 *       Client just generates + displays plaintext codes returned by the RPC.
 *
 * NOTE: hashBackupCode is server-side only (Postgres HMAC with Vault secret).
 * This module does NOT hash codes — it only generates plaintext codes for
 * display to the user. The RPC accepts plaintext and HMAC-hashes them at rest.
 *
 * NOTE: assertAal2 lives in src/lib/supabase.ts (added by this plan).
 *
 * Alphabet omits O/0/1/I/L to reduce OCR-confusion for users hand-typing
 * backup codes.
 */
import { supabase } from '@/lib/supabase';

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 chars — omits 0,1,I,L,O

/**
 * Generate `count` unique backup codes in the form `XXXX-XXXX-XXXX`.
 * Uses Web Crypto `getRandomValues` for cryptographic randomness.
 */
export function generateBackupCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    const chars = Array.from(buf, (b) => ALPHA[b % ALPHA.length]!).join('');
    codes.add(`${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`);
  }
  return Array.from(codes);
}

/**
 * Enroll a TOTP factor for the currently authenticated user.
 *
 * Returns the Supabase MFA enroll result which includes:
 *   - data.id: the factor ID (needed for challenge + verify)
 *   - data.totp.qr_code: data-URI of a QR code SVG/PNG to display
 *   - data.totp.secret: the base32 secret (show to user for manual entry)
 *
 * D-07: factorType is always 'totp'.
 */
export async function enrollTotp(opts: { issuer: string; friendlyName: string }) {
  return supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: opts.issuer,
    friendlyName: opts.friendlyName,
  });
}

/**
 * Run the TOTP challenge → verify flow for a given factorId + OTP code.
 *
 * On success, Supabase upgrades the session's `aal` claim from 'aal1' to 'aal2'.
 * D-09: every admin session requires aal2 step-up.
 */
export async function verifyTotp(opts: { factorId: string; code: string }) {
  const ch = await supabase.auth.mfa.challenge({ factorId: opts.factorId });
  if (ch.error) return { data: null, error: ch.error };
  return supabase.auth.mfa.verify({
    factorId: opts.factorId,
    challengeId: ch.data.id,
    code: opts.code,
  });
}
