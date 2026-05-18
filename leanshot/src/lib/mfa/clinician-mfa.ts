/**
 * Phase 25 Plan 25-08 — Clinician MFA flow helpers.
 *
 * D-10 (HIPAA-15): Clinician TOTP is a HARD-CUT. No grace window, no skip.
 * Org-admin CANNOT defer per-clinician. Backup codes (Phase 24 admin_backup_codes
 * table) are the only emergency escape.
 *
 * Pattern S1 (dual-layer security): This module is the UX-layer only. Every
 * clinical RPC independently asserts AAL2 via `assert_aal2()` at the DB layer.
 *
 * Reuses Phase 24's admin TOTP infrastructure where possible:
 *   - Same Supabase Auth mfa.enroll/challenge/verify API surface.
 *   - Same admin_backup_codes table (user_id column distinguishes rows).
 *   - Does NOT import from src/lib/admin/totp.ts to keep clinician + admin
 *     code paths independently auditable.
 */
import { supabase } from '@/lib/supabase';

export type ClinicianAal = 'aal1' | 'aal2' | null;

/**
 * Returns the current session's AAL level for the authenticated user.
 * Returns null when no session exists (not authenticated).
 * Returns 'aal1' when authenticated but TOTP not yet verified this session.
 * Returns 'aal2' when TOTP step-up is complete.
 */
export async function getClinicianAal(): Promise<ClinicianAal> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return 'aal1';
  return (data.currentLevel as ClinicianAal) ?? 'aal1';
}

/**
 * Returns true if the authenticated user has at least one VERIFIED TOTP factor.
 * A factor in 'unverified' state (partially enrolled) does NOT count.
 */
export async function isClinicianTotpEnrolled(): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  return data?.all?.some((f: { factor_type: string; status: string }) => f.factor_type === 'totp' && f.status === 'verified') ?? false;
}

/**
 * Initiates TOTP enrollment for the authenticated user.
 * Returns factorId, QR code data-URI, and base32 secret for manual entry.
 *
 * Throws if enrollment fails (network error, duplicate factor, etc.).
 * Caller must display the QR code + prompt the user for a 6-digit code to
 * complete enrollment via challengeClinicianTotp().
 *
 * D-10: Called by SetupClinicianTotp.tsx which has NO "skip" button.
 */
export async function enrollClinicianTotp(): Promise<{ factorId: string; qrCode: string; secret: string }> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'LeanShot Clinic',
    friendlyName: 'Clinician TOTP',
  });
  if (error || !data) throw new Error('enroll_failed:' + (error?.name ?? 'unknown'));
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Issues a TOTP challenge and verifies the given code in one operation.
 *
 * On success: session is upgraded to AAL2 by Supabase Auth; returns { aal: 'aal2' }.
 * On bad code: returns { aal: 'aal1', error: 'invalid_code' }.
 * On challenge failure: returns { aal: 'aal1', error: 'challenge_failed' }.
 *
 * The caller (ClinicianMfaGuard / ChallengeClinicianTotp) must re-render
 * after aal2 is confirmed to ungate the clinical surface.
 */
export async function challengeClinicianTotp(
  factorId: string,
  code: string,
): Promise<{ aal: ClinicianAal; error?: string }> {
  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
  if (chErr || !ch) return { aal: 'aal1', error: 'challenge_failed' };

  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: ch.id,
    code,
  });
  if (vErr) return { aal: 'aal1', error: 'invalid_code' };

  const aal = await getClinicianAal();
  return { aal };
}

/**
 * Redeems a one-time backup code for emergency AAL2 elevation.
 * Uses Phase 24's `redeem_admin_backup_code` RPC (same admin_backup_codes table;
 * user_id column scopes the lookup to the caller's own codes).
 *
 * Codes are HMAC-hashed at rest; this call sends the plaintext which the RPC
 * hashes before lookup. Each code is single-use (use_at enforced server-side).
 *
 * On success: session is elevated to AAL2 by the RPC; returns { aal: 'aal2' }.
 * On invalid/used code: returns { aal: 'aal1', error: 'invalid_or_used' }.
 */
export async function redeemClinicianBackupCode(
  code: string,
): Promise<{ aal: ClinicianAal; error?: string }> {
  const { data, error } = await supabase.rpc('redeem_admin_backup_code', { p_code: code });
  if (error || !data) return { aal: 'aal1', error: 'invalid_or_used' };
  const aal = await getClinicianAal();
  return { aal };
}
