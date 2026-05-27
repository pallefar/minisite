/**
 * Phase 66 Plan 66-02 — Shared TOTP helpers (admin + consumer).
 *
 * Extracted from Phase 25 `src/lib/admin/totp.ts` so both admin
 * (`/admin/security/totp`) and consumer (`/settings/security`) surfaces
 * call the same code path. The admin module is preserved as a thin
 * re-export so existing Phase 25 importers (SetupTotpPage.tsx, palette,
 * etc.) keep resolving without any call-site edits.
 *
 * Functions exported:
 *   - enrollTotp(opts)          — wraps supabase.auth.mfa.enroll({factorType:'totp', ...})
 *   - verifyTotpChallenge(opts) — runs mfa.challenge → mfa.verify; returns
 *                                 { ok, aal } shape used by the consumer
 *                                 aal2 gate (Phase 66 plan 66-02 Task 2).
 *   - verifyTotp(opts)          — Phase 25 compat alias returning raw
 *                                 supabase.mfa.verify response (unchanged
 *                                 shape so SetupTotpPage.tsx keeps working).
 *   - listEnrolledFactors()     — returns the user's verified TOTP factors;
 *                                 used by the consumer aal2 gate to short-
 *                                 circuit when MFA is not enabled.
 *   - unenrollFactor(factorId)  — wraps supabase.auth.mfa.unenroll for the
 *                                 consumer "Disable MFA" CTA.
 *
 * NOTE: Per Phase 24 D-08, backup-code HASHING is server-side only
 * (Postgres HMAC via Vault secret). This module owns ONLY the client-side
 * plaintext generator + display; hashing lives in `backup-codes-shared.ts`
 * for code consumers that store hashes inside service-role Edge Fns.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Backup-code alphabet (re-exported for callers that need to display the
// alphabet to users, e.g. a "what characters does my code contain" hint).
//
// Omits O/0/1/I/L to reduce OCR confusion for users hand-typing codes.
// Phase 24 D-07.
// ---------------------------------------------------------------------------
export const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 chars

// ---------------------------------------------------------------------------
// Generate plaintext backup codes for one-time display.
// ---------------------------------------------------------------------------

/**
 * Generate `count` unique backup codes in the form `XXXX-XXXX-XXXX`.
 * Uses Web Crypto `getRandomValues` for cryptographic randomness.
 *
 * Phase 24 D-08: 10 codes is the canonical default. Server-side hashing
 * is the responsibility of the RPC that ingests these codes (Phase 24
 * `admin.issue_backup_codes`); this generator is display-only.
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    const chars = Array.from(
      buf,
      (b) => BACKUP_CODE_ALPHABET[b % BACKUP_CODE_ALPHABET.length]!,
    ).join('');
    codes.add(`${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`);
  }
  return Array.from(codes);
}

// ---------------------------------------------------------------------------
// TOTP enrollment + verify (thin Supabase Auth wrappers).
// ---------------------------------------------------------------------------

export interface EnrollTotpOpts {
  issuer: string;
  friendlyName: string;
}

/**
 * Enroll a TOTP factor for the currently authenticated user.
 *
 * Returns the Supabase MFA enroll result, including:
 *   - data.id            — factor ID (needed for challenge + verify)
 *   - data.totp.qr_code  — data-URI of a QR code image
 *   - data.totp.secret   — base32 secret for manual entry
 *
 * Phase 24 D-07: factorType is always 'totp'.
 */
export async function enrollTotp(
  opts: EnrollTotpOpts,
  client: SupabaseClient = supabase,
) {
  return client.auth.mfa.enroll({
    factorType: 'totp',
    issuer: opts.issuer,
    friendlyName: opts.friendlyName,
  });
}

export interface VerifyTotpOpts {
  factorId: string;
  code: string;
}

/**
 * Run the TOTP challenge → verify flow (Phase 25 compatible shape).
 *
 * Returns the raw Supabase verify response so existing call-sites
 * (SetupTotpPage.tsx, palette/aal2-step-up) keep working unchanged.
 *
 * On success, Supabase upgrades the session's `aal` claim to 'aal2'.
 */
export async function verifyTotp(
  opts: VerifyTotpOpts,
  client: SupabaseClient = supabase,
) {
  const ch = await client.auth.mfa.challenge({ factorId: opts.factorId });
  if (ch.error) return { data: null, error: ch.error };
  return client.auth.mfa.verify({
    factorId: opts.factorId,
    challengeId: ch.data.id,
    code: opts.code,
  });
}

export interface VerifyTotpChallengeResult {
  ok: boolean;
  aal: 'aal2' | null;
  error?: { message: string } | null;
}

/**
 * Phase 66 consumer-surface verify shape — same flow as `verifyTotp` but
 * returns a `{ ok, aal }` envelope the consumer aal2 gate consumes directly
 * without re-inspecting the Supabase error shape.
 */
export async function verifyTotpChallenge(
  opts: VerifyTotpOpts,
  client: SupabaseClient = supabase,
): Promise<VerifyTotpChallengeResult> {
  const res = await verifyTotp(opts, client);
  if (res.error) {
    return { ok: false, aal: null, error: { message: res.error.message } };
  }
  return { ok: true, aal: 'aal2' };
}

// ---------------------------------------------------------------------------
// Factor inventory + teardown.
// ---------------------------------------------------------------------------

export interface MfaFactor {
  id: string;
  friendly_name?: string | null;
  factor_type: 'totp' | string;
  status: 'verified' | 'unverified' | string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Returns the user's enrolled TOTP factors (verified only).
 *
 * Used by the consumer aal2 gate to determine whether MFA is enabled at
 * all (per Phase 66 D-02, the gate is skipped if no verified factor
 * exists — TOTP is optional for consumers).
 */
export async function listEnrolledFactors(
  client: SupabaseClient = supabase,
): Promise<MfaFactor[]> {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error || !data) return [];
  const totp = (data.totp ?? []) as MfaFactor[];
  return totp.filter((f) => f.status === 'verified');
}

/**
 * Unenroll a TOTP factor (consumer-facing "Disable MFA" CTA).
 *
 * The caller is responsible for confirming the user's intent + clearing
 * any local AAL2-freshness markers; this wrapper performs only the
 * Supabase Auth call.
 */
export async function unenrollFactor(
  factorId: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(`unenroll_failed: ${error.message}`);
}
