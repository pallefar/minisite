/**
 * Phase 25 Plan 25-08 — Patient MFA helpers.
 *
 * D-11 (HIPAA-15): Patient MFA is OPTIONAL. The PatientMfaCard in Settings
 * is informational — it never blocks access.
 *
 * However, SENSITIVE ACTIONS always require step-up regardless of TOTP enrollment:
 *   - Account deletion (wired in this plan)
 *   - Change clinic affiliation (Phase 28 TODO)
 *   - Export full data (Phase 28 TODO)
 *
 * requireStepUp() kick-starts the appropriate challenge:
 *   - TOTP enrolled → returns { ok: true, method: 'totp' }; caller renders TOTP modal.
 *   - Not enrolled → sends email OTP via signInWithOtp → { ok: true, method: 'email_otp' }.
 *   - Error → { ok: false }.
 *
 * Caller responsibility split: this helper initiates the challenge. The caller
 * renders the appropriate modal (TotpStepUpModal or EmailOtpStepUpModal) and
 * awaits user input. This keeps the helper testable without React state.
 *
 * Per [[reference_supabase_auth_traps]]: signInWithOtp is mocked in tests
 * (free-tier email rate-limit 2/hr — never call from test runners).
 */
import { supabase } from '@/lib/supabase';
import { isClinicianTotpEnrolled } from './clinician-mfa';

/**
 * Returns true if the current user has at least one VERIFIED TOTP factor.
 * Delegates to isClinicianTotpEnrolled — factor list is per-user, not per-role.
 */
export async function isPatientTotpEnrolled(): Promise<boolean> {
  return await isClinicianTotpEnrolled();
}

/**
 * Initiates optional TOTP enrollment for a patient.
 * Returns factorId, QR code data-URI, and base32 secret.
 * Caller must display QR and prompt the user for a verification code.
 */
export async function enrollPatientTotp(): Promise<{
  factorId: string;
  qrCode: string;
  secret: string;
}> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'LeanShot',
    friendlyName: 'Patient TOTP',
  });
  if (error || !data) throw new Error('enroll_failed');
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Unenrolls a TOTP factor for a patient.
 * The factorId comes from mfa.listFactors() — the caller is responsible for
 * confirming the user wants to disable TOTP before calling.
 */
export async function unenrollPatientTotp(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error('unenroll_failed');
}

/**
 * Initiates the appropriate step-up challenge for a sensitive patient action.
 *
 * Returns:
 *   { ok: true, method: 'totp' }     — user has TOTP; caller renders TOTP modal.
 *   { ok: true, method: 'email_otp' } — no TOTP; email OTP sent; caller renders email modal.
 *   { ok: false }                     — error (no user, email send failed, etc.).
 *
 * The caller is responsible for awaiting user input and verifying the code.
 * This helper only INITIATES the challenge — it does not complete it.
 *
 * Wired on:
 *   - Account deletion (DeleteAccountModal — wired in this plan via Phase 25-08)
 *   - Change clinic affiliation: Phase 28 TODO
 *   - Export full data: Phase 28 TODO
 */
export async function requireStepUp(): Promise<{ ok: boolean; method?: 'totp' | 'email_otp' }> {
  const enrolled = await isPatientTotpEnrolled();
  if (enrolled) {
    // TOTP enrolled — caller renders a TOTP challenge modal
    return { ok: true, method: 'totp' };
  }

  // Email OTP fallback — send a magic-link / OTP to the user's email
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false };

  const { error } = await supabase.auth.signInWithOtp({ email: user.email });
  if (error) return { ok: false };

  return { ok: true, method: 'email_otp' };
}
