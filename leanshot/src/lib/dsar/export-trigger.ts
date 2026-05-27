/**
 * Phase 66 Plan 66-04 — DSAR export-trigger with AAL2 step-up gate.
 *
 * Thin wrapper around the Phase 22 DSAR client (`requestDsarExport` —
 * `src/lib/dsar/dsar-export-client.ts`) that interposes the Phase 66
 * consumer-AAL2 gate BEFORE actually creating the DSAR request. This is
 * the canonical entry point for any consumer "export all my data" CTA
 * landing post-66 — components MUST call `triggerDsarExport()` (this
 * module) rather than the lower-level `requestDsarExport()` so the
 * step-up policy is enforced uniformly.
 *
 * Gate behaviour (mirrors Plan 66-02 contract):
 *   - `mfa_not_enabled` → proceed with the DSAR request (per D-02 we do
 *     NOT lock users out of their own data export just because they
 *     never enrolled MFA — the gate is opt-in).
 *   - `ok: true` → proceed.
 *   - `cancelled` / `invalid_code` / `session_stale` → throw a typed
 *     error so the caller can surface a toast WITHOUT triggering the
 *     DSAR request.
 *
 * The caller is responsible for opening the <Aal2ChallengeModal>; this
 * module accepts an `onChallenge` callback exactly like the underlying
 * gate. We do NOT own UI here — keeps this module unit-testable in
 * node env without jsdom.
 */
import {
  requireAal2ForConsumerAction,
  type Aal2ChallengeOutcome,
} from '@/lib/auth/aal2-consumer';
import { requestDsarExport } from '@/lib/dsar/dsar-export-client';

export type ExportTriggerErrorCode =
  | 'aal2_cancelled'
  | 'aal2_invalid_code'
  | 'aal2_session_stale';

export class ExportTriggerError extends Error {
  code: ExportTriggerErrorCode;
  constructor(code: ExportTriggerErrorCode, options?: { cause?: unknown }) {
    super(`export-trigger:${code}`, options);
    this.name = 'ExportTriggerError';
    this.code = code;
  }
}

export interface TriggerDsarExportOpts {
  /**
   * Called when the gate needs the user's TOTP code. Caller should
   * render <Aal2ChallengeModal purpose="export-all-data" /> and resolve
   * with the entered code OR `{ cancelled: true }` if the user closes
   * the modal.
   */
  onChallenge?: () => Promise<Aal2ChallengeOutcome>;
}

/**
 * Trigger a DSAR export with AAL2 step-up gating.
 *
 * Returns the DSAR request UUID (from `requestDsarExport`) on success.
 * Throws `ExportTriggerError` for AAL2 failures the caller MUST abort
 * on. Propagates `DsarError` from the underlying RPC for non-AAL2
 * failures (e.g. `already_pending`).
 */
export async function triggerDsarExport(
  opts?: TriggerDsarExportOpts,
): Promise<string> {
  const gate = await requireAal2ForConsumerAction(undefined, 'export-all-data', {
    onChallenge: opts?.onChallenge,
  });

  if (gate.ok === false) {
    // mfa_not_enabled is the only failure mode where we proceed anyway
    // (per Phase 66 D-02 / Plan 66-04 success criteria).
    if (gate.reason === 'mfa_not_enabled') {
      return requestDsarExport();
    }
    if (gate.reason === 'cancelled') {
      throw new ExportTriggerError('aal2_cancelled');
    }
    if (gate.reason === 'invalid_code') {
      throw new ExportTriggerError('aal2_invalid_code');
    }
    if (gate.reason === 'session_stale') {
      throw new ExportTriggerError('aal2_session_stale');
    }
    // Defensive — exhaustive guard. The Aal2GateResult union is closed,
    // so this branch is unreachable; if it fires, treat as cancelled
    // (safest — caller aborts without surfacing a confusing message).
    throw new ExportTriggerError('aal2_cancelled');
  }

  return requestDsarExport();
}
