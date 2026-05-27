/**
 * Phase 24 Plan 24-05 → Phase 66 Plan 66-02 migration shim.
 *
 * The canonical TOTP wrappers + backup-code generator now live in
 * `src/lib/auth/totp-shared.ts` so both admin and consumer surfaces use the
 * same code path (Phase 66 D-01).
 *
 * This file is a thin re-export so existing admin importers
 * (`SetupTotpPage.tsx`, `palette/aal2-step-up.ts`, the original
 * `__tests__/totp.test.ts`) keep resolving without any call-site edits.
 *
 * Phase 66 consumer surfaces should import directly from
 * `@/lib/auth/totp-shared` instead — only the Phase 25 admin code path
 * keeps reaching for `@/lib/admin/totp` for back-compat.
 *
 * The original signature of `verifyTotp({ factorId, code })` is preserved
 * (raw Supabase verify response). See totp-shared.ts for the new
 * `verifyTotpChallenge` variant which returns the `{ ok, aal }` envelope
 * used by the consumer aal2 gate.
 */
export {
  enrollTotp,
  generateBackupCodes,
  verifyTotp,
  verifyTotpChallenge,
  listEnrolledFactors,
  unenrollFactor,
  BACKUP_CODE_ALPHABET,
  type EnrollTotpOpts,
  type VerifyTotpOpts,
  type VerifyTotpChallengeResult,
  type MfaFactor,
} from '@/lib/auth/totp-shared';
