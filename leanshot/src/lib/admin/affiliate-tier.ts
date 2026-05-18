/**
 * Phase 26 Plan 26-05 — admin tier RPC client wrappers (AFFTIER-01 + AFFTIER-05).
 *
 * Five SECDEF RPCs from migration 20270701000011 backing the new
 * /admin/affiliates tier-management + anomaly-review tabs:
 *
 *   - admin_grant_lifetime(p_affiliate_id)              — Gold → Lifetime per D-14
 *   - admin_reverse_lifetime_grant(p_affiliate_id)      — DUAL-gated (Pitfall 5)
 *   - admin_freeze_affiliate(p_affiliate_id, p_reason)  — sets frozen_at + reason
 *   - admin_unfreeze_affiliate(p_affiliate_id)          — clears frozen_at
 *   - admin_anomaly_review_decision(p_conversion_id,    — clear|fraud_confirmed
 *                                   p_decision)           (writes fraud_signals
 *                                                          on fraud_confirmed)
 *
 * Error mapping mirrors the AdminApiError / AffiliateReviewError pattern from
 * Phase 22 Plan 22-07. Single mapRpcError() lives here; affiliate-review.ts
 * delegates anomaly methods through this module rather than duplicating.
 */
import { supabase } from '@/lib/supabase';

export type AffiliateTierErrorCode =
  | 'not_authenticated'
  | 'forbidden'
  | 'affiliate_not_found'
  | 'must_be_gold_first'
  | 'not_lifetime'
  | 'cannot_reverse'
  | 'reason_required'
  | 'invalid_decision'
  | 'conversion_not_found'
  | 'network'
  | 'unknown';

interface SupabasePgError {
  code?: string;
  message?: string;
  details?: string;
}

export class AffiliateTierError extends Error {
  code: AffiliateTierErrorCode;
  constructor(code: AffiliateTierErrorCode, options?: { cause?: unknown }) {
    super(`affiliate-tier:${code}`, options);
    this.name = 'AffiliateTierError';
    this.code = code;
  }
}

function mapRpcError(err: SupabasePgError | null | undefined): AffiliateTierErrorCode {
  if (!err) return 'unknown';
  const m = err.message ?? '';
  // Token-substring matching first (server raises 'raise exception <token>'
  // which Postgres formats as 'ERROR: <token>' surfaced in message body).
  if (m.includes('not_authenticated')) return 'not_authenticated';
  if (m.includes('cannot_reverse_lifetime')) return 'cannot_reverse';
  if (m.includes('must_be_gold_first')) return 'must_be_gold_first';
  if (m.includes('affiliate_not_found')) return 'affiliate_not_found';
  if (m.includes('not_lifetime')) return 'not_lifetime';
  if (m.includes('reason_required')) return 'reason_required';
  if (m.includes('invalid_decision')) return 'invalid_decision';
  if (m.includes('conversion_not_found_or_not_flagged')) return 'conversion_not_found';
  // Errcode fallbacks for cases where message normalization stripped the token.
  if (err.code === '28000') return 'not_authenticated';
  if (err.code === '42501' || m.includes('forbidden')) return 'forbidden';
  return 'unknown';
}

async function callRpc<T extends Record<string, unknown>>(
  rpcName:
    | 'admin_grant_lifetime'
    | 'admin_reverse_lifetime_grant'
    | 'admin_freeze_affiliate'
    | 'admin_unfreeze_affiliate'
    | 'admin_anomaly_review_decision',
  params: T,
): Promise<void> {
  try {
    const { error } = await supabase.rpc(rpcName, params);
    if (error) {
      throw new AffiliateTierError(mapRpcError(error as SupabasePgError), { cause: error });
    }
  } catch (e) {
    if (e instanceof AffiliateTierError) throw e;
    throw new AffiliateTierError('network', { cause: e });
  }
}

export async function grantLifetime(affiliateId: string): Promise<void> {
  return await callRpc('admin_grant_lifetime', { p_affiliate_id: affiliateId });
}

export async function reverseLifetimeGrant(affiliateId: string): Promise<void> {
  return await callRpc('admin_reverse_lifetime_grant', { p_affiliate_id: affiliateId });
}

export async function freezeAffiliate(affiliateId: string, reason: string): Promise<void> {
  if (!reason || reason.trim().length === 0) {
    throw new AffiliateTierError('reason_required');
  }
  return await callRpc('admin_freeze_affiliate', {
    p_affiliate_id: affiliateId,
    p_reason: reason,
  });
}

export async function unfreezeAffiliate(affiliateId: string): Promise<void> {
  return await callRpc('admin_unfreeze_affiliate', { p_affiliate_id: affiliateId });
}

export async function anomalyReviewDecision(
  conversionId: string,
  decision: 'clear' | 'fraud_confirmed',
): Promise<void> {
  return await callRpc('admin_anomaly_review_decision', {
    p_conversion_id: conversionId,
    p_decision: decision,
  });
}
