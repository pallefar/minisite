/**
 * Phase 65 Plan 65-09 — refund-client (browser → request-refund Edge Fn).
 *
 * Thin wrapper around `supabase.functions.invoke('request-refund', …)` that
 * funnels two related concerns through one module:
 *   1. checkRefundEligibility — dry-run probe to render the form's eligible /
 *      ineligible top-half on mount. The Edge Fn (Phase 65-06) MUST accept
 *      `{ dry_run: true }` and return the eligibility shape without executing
 *      a Stripe refund. If 65-06 hasn't shipped that branch yet, this returns
 *      { eligible: false, reason: 'dry_run_unsupported' } so the form
 *      gracefully shows the ineligible state with the support email fallback.
 *   2. requestRefund — POST with the user's reason; returns a discriminated
 *      union (ok=true | ok=false) so callers can pattern-match on stable
 *      error codes ('refund_already_processed' | 'refund_failed' |
 *      'window_expired' | 'not_authenticated').
 *
 * Auth: supabase.functions.invoke signs with the user's JWT from the active
 * session (anon-client picks it up automatically post-sign-in). No bearer
 * juggling required in the caller.
 */
import { supabase } from '@/lib/supabase';

export type RefundEligibility = {
  eligible: boolean;
  window?: 'trial' | 'money_back_14d';
  reason?: string;
  amount_cents?: number;
};

export type RefundResult =
  | {
      ok: true;
      refund_id: string;
      amount_cents: number;
      status: string;
    }
  | {
      ok: false;
      error:
        | 'refund_already_processed'
        | 'refund_failed'
        | 'window_expired'
        | 'not_authenticated'
        | 'dry_run_unsupported';
      message?: string;
    };

/**
 * Map Edge Fn error messages → stable client-facing error codes.
 * The Edge Fn (Phase 65-06) is expected to return string error messages
 * mirroring these codes; this map shields the UI from raw 500s.
 */
function mapError(raw: unknown): RefundResult {
  const message =
    typeof raw === 'object' && raw !== null && 'message' in raw
      ? String((raw as { message: unknown }).message)
      : '';
  const status =
    typeof raw === 'object' &&
    raw !== null &&
    'context' in raw &&
    typeof (raw as { context: unknown }).context === 'object'
      ? Number(
          ((raw as { context: { status?: unknown } }).context.status as number | undefined) ?? 0,
        )
      : 0;

  if (message === 'refund_already_processed' || status === 409) {
    return { ok: false, error: 'refund_already_processed', message };
  }
  if (message === 'window_expired') {
    return { ok: false, error: 'window_expired', message };
  }
  if (message === 'not_authenticated' || status === 401) {
    return { ok: false, error: 'not_authenticated', message };
  }
  return { ok: false, error: 'refund_failed', message };
}

export async function checkRefundEligibility(): Promise<RefundEligibility> {
  const { data, error } = await supabase.functions.invoke('request-refund', {
    body: { dry_run: true },
  });
  if (error) {
    // If 65-06 hasn't shipped dry_run yet, surface a stable "unsupported" reason
    // — caller renders the ineligible state with the support email fallback.
    const msg =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : '';
    if (msg === 'dry_run_unsupported') {
      return { eligible: false, reason: 'dry_run_unsupported' };
    }
    return { eligible: false, reason: msg || 'unknown_error' };
  }
  const d = (data ?? {}) as Partial<RefundEligibility>;
  return {
    eligible: Boolean(d.eligible),
    window: d.window,
    reason: d.reason,
    amount_cents: d.amount_cents,
  };
}

export async function requestRefund(reason: string): Promise<RefundResult> {
  const { data, error } = await supabase.functions.invoke('request-refund', {
    body: { reason },
  });
  if (error) {
    return mapError(error);
  }
  const d = (data ?? {}) as {
    refund_id?: string;
    amount_cents?: number;
    status?: string;
  };
  if (!d.refund_id) {
    return { ok: false, error: 'refund_failed', message: 'missing_refund_id' };
  }
  return {
    ok: true,
    refund_id: d.refund_id,
    amount_cents: d.amount_cents ?? 0,
    status: d.status ?? 'pending',
  };
}
