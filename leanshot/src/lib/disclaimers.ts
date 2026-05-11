/**
 * Phase 4 D-04: thin re-export so all Phase 3 disclaimer call sites
 * (MedLevelChart, watermark plugin, DoctorReport) keep their `@/lib/disclaimers`
 * import path. Single-source-of-truth copy now lives at `shared/disclaimers.ts`
 * so the Edge Function's `system-prompt.ts` consumes the same strings.
 */
export {
  PK_DISCLAIMER_BAND_CAPTION,
  PK_DISCLAIMER_DOCTOR_REPORT,
  PK_DISCLAIMER_FULL,
  PK_DISCLAIMER_LINE_1,
  PK_DISCLAIMER_LINE_2,
  PK_DISCLAIMER_Y_AXIS,
} from '../../../shared/disclaimers';
