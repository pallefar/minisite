/**
 * Phase 27 Plan 27-01 — types for the admin bulk-action client surface.
 *
 * The 5 action types ship at v1 per CONTEXT D-04. Reversible subset (D-03):
 *   ban, comp_plan, tag → mint undo_token + render AdminUndoBanner
 *   csv_export, force_password_reset → NO undo banner
 *
 * BulkActionResult is a discriminated union over `mode`:
 *   - 'sync'  ≤100 rows: executed inline, includes undoToken (nullable) + affected count.
 *   - 'async' >100 rows: enqueued admin_bulk_jobs row, includes jobId; Plan 27-06
 *     ships the polling UI that displays job progress.
 */

export type BulkActionType =
  | 'csv_export'
  | 'tag'
  | 'comp_plan'
  | 'ban'
  | 'force_password_reset';

/** Union of reversible action types — undo tokens are only minted for these. */
export type ReversibleBulkActionType = 'ban' | 'comp_plan' | 'tag';

/**
 * Action parameters passed through to the RPC's p_params jsonb argument.
 *
 * Per-action expected shape:
 *   csv_export / ban / force_password_reset → {} (no params)
 *   tag       → { tag: string }
 *   comp_plan → { days: number, reason?: string }
 *
 * The wider Record signature lets callers build params dynamically (e.g. the
 * AdminBulkConfirmModal); the SECDEF RPC validates per-action requirements
 * server-side and raises invalid_action (22023) on shape mismatch.
 */
export type BulkActionParams = Record<string, unknown>;

export interface BulkActionSyncResult {
  mode: 'sync';
  affected: number;
  undoToken: string | null;
  jobId: null;
}

export interface BulkActionAsyncResult {
  mode: 'async';
  affected: 0;
  undoToken: null;
  jobId: string;
}

export type BulkActionResult = BulkActionSyncResult | BulkActionAsyncResult;

export type BulkApiErrorCode =
  | 'not_staff'
  | 'not_authenticated'
  | 'token_expired'
  | 'too_many_rows'
  | 'invalid_action'
  | 'network'
  | 'unknown';

export class BulkApiError extends Error {
  code: BulkApiErrorCode;
  constructor(code: BulkApiErrorCode, options?: { cause?: unknown }) {
    super(`admin-bulk:${code}`, options);
    this.name = 'BulkApiError';
    this.code = code;
  }
}
