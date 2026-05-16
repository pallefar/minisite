/**
 * Phase 22 Plan 22-07 — admin affiliate-review RPC client wrappers (ADMIN-06).
 *
 * Three status-writer RPCs that close the Phase 19 BL-11 status-graph gap.
 * Each wraps a SECURITY DEFINER function from migration 20270601000019:
 *
 *   - admin_approve_affiliate_conversion(id)        — status → 'confirmed'
 *   - admin_hold_affiliate_conversion(id)           — status → 'on_hold'
 *   - admin_reject_affiliate_conversion(id, reason) — status → 'rejected'
 *
 * After approve, the row becomes eligible for the W-3 materialization cron
 * (20270101000012) on its next nightly run, which rolls it into a pending
 * payouts row that the monthly transfer cron (1st of month, 00:00 UTC) ships.
 *
 * Error mapping mirrors the AdminApiError pattern from admin-api.ts.
 */
import { supabase } from '@/lib/supabase';

export type AffiliateReviewErrorCode =
  | 'not_staff'
  | 'not_authenticated'
  | 'not_found'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class AffiliateReviewError extends Error {
  code: AffiliateReviewErrorCode;
  constructor(code: AffiliateReviewErrorCode, options?: { cause?: unknown }) {
    super(`affiliate-review:${code}`, options);
    this.name = 'AffiliateReviewError';
    this.code = code;
  }
}

interface SupabaseRpcError {
  code?: string;
  message?: string;
  details?: string;
}

function mapRpcError(err: SupabaseRpcError | null | undefined): AffiliateReviewErrorCode {
  if (!err) return 'unknown';
  const msg = err.message ?? '';
  // The RPC raises distinct messages via `raise exception '<token>'`.
  if (msg.includes('conversion_not_found')) return 'not_found';
  if (
    msg.includes('cannot_approve_paid') ||
    msg.includes('cannot_hold_terminal') ||
    msg.includes('cannot_reject_paid')
  ) {
    return 'invalid_state';
  }
  switch (err.code) {
    case '42501':
      return 'not_staff';
    case '28000':
      return 'not_authenticated';
    case '22023':
      return 'invalid_state';
    default:
      return 'unknown';
  }
}

async function callReviewRpc(
  rpcName:
    | 'admin_approve_affiliate_conversion'
    | 'admin_hold_affiliate_conversion'
    | 'admin_reject_affiliate_conversion',
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase.rpc(rpcName, params);
    if (error) {
      throw new AffiliateReviewError(mapRpcError(error as SupabaseRpcError), { cause: error });
    }
  } catch (e) {
    if (e instanceof AffiliateReviewError) throw e;
    throw new AffiliateReviewError('network', { cause: e });
  }
}

export async function approveAffiliateConversion(conversionId: string): Promise<void> {
  return await callReviewRpc('admin_approve_affiliate_conversion', {
    p_conversion_id: conversionId,
  });
}

export async function holdAffiliateConversion(conversionId: string): Promise<void> {
  return await callReviewRpc('admin_hold_affiliate_conversion', {
    p_conversion_id: conversionId,
  });
}

export async function rejectAffiliateConversion(
  conversionId: string,
  reason: string,
): Promise<void> {
  return await callReviewRpc('admin_reject_affiliate_conversion', {
    p_conversion_id: conversionId,
    p_reason: reason,
  });
}
