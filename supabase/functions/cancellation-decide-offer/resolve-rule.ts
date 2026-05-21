/**
 * Phase 40 Plan 40-03 — resolve-rule helper for cancellation-decide-offer.
 *
 * Reads save_offer_rules via service-role admin client. Returns the
 * highest-priority (lowest priority number) active rule that matches
 * the user's tenure bucket, cancellation reason, org type, and cohort.
 *
 * Per PLAN §Task 1 action + RESEARCH §"Decide-offer Edge Fn skeleton" lines 850-925.
 * Uses service-role direct table read (NOT a SECDEF RPC — per Pitfall 4).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { TenureBucket, CancellationReason, OfferType } from '../_shared/cancellation-types.ts';

export interface SaveOfferRule {
  id: string;
  title: string;
  cohort_id: string | null;
  tenure_buckets: string[];
  reasons: string[];
  org_type: 'any' | 'consumer' | 'clinic';
  offer_type: OfferType;
  pause_months: 1 | 2 | 3 | null;
  coupon_id: string | null;
  extension_days: 7 | 14 | 30 | null;
  downgrade_target: string | null;
  priority: number;
  active: boolean;
}

interface ResolveRuleParams {
  user_id: string;
  tenureBucket: TenureBucket;
  reason: CancellationReason;
  isClinicOrg: boolean;
}

/**
 * Resolve the best matching save-offer rule for this cancellation context.
 *
 * Query logic:
 *   WHERE active = true
 *   AND (tenure_buckets = '{}' OR tenureBucket = ANY(tenure_buckets))
 *   AND (reasons = '{}' OR reason = ANY(reasons))
 *   AND (org_type = 'any' OR org_type = userOrgType)
 *   AND (cohort_id IS NULL OR user is in cohort via cohort_membership matview)
 *   ORDER BY priority ASC LIMIT 1
 *
 * Returns null if no matching rule found.
 */
export async function resolveRule(
  admin: SupabaseClient,
  { user_id, tenureBucket, reason, isClinicOrg }: ResolveRuleParams,
): Promise<SaveOfferRule | null> {
  const userOrgType = isClinicOrg ? 'clinic' : 'consumer';

  // Fetch all active rules that match tenure + reason + org_type
  // We apply cohort filter in JS because supabase-js doesn't support
  // EXISTS subquery directly; for small rule sets (<100 rows) this is fine.
  const { data: rules, error } = await admin
    .from('save_offer_rules')
    .select('*')
    .eq('active', true)
    .or(
      `tenure_buckets.eq.{},tenure_buckets.cs.{"${tenureBucket}"}`,
    )
    .or(
      `reasons.eq.{},reasons.cs.{"${reason}"}`,
    )
    .in('org_type', ['any', userOrgType])
    .order('priority', { ascending: true });

  if (error) {
    console.warn('[resolve-rule] save_offer_rules query error:', error.code);
    return null;
  }
  if (!rules || rules.length === 0) {
    return null;
  }

  // Apply cohort membership filter for rules that have a cohort_id
  for (const rule of rules as SaveOfferRule[]) {
    if (rule.cohort_id === null) {
      // No cohort restriction — this rule matches
      return rule;
    }
    // Check cohort membership via P27 cohort_membership matview
    const { data: membership, error: cohortError } = await admin
      .from('cohort_membership')
      .select('user_id')
      .eq('user_id', user_id)
      .eq('cohort_id', rule.cohort_id)
      .maybeSingle();

    if (cohortError) {
      console.warn('[resolve-rule] cohort_membership lookup error:', cohortError.code);
      continue;
    }
    if (membership) {
      // User is in the cohort — this rule matches
      return rule;
    }
    // User not in this cohort — try next rule
  }

  return null;
}
