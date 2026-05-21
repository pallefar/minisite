/**
 * cancellation-decide-offer Edge Function — Phase 40 Plan 40-03.
 *
 * POST /functions/v1/cancellation-decide-offer
 *
 * JWT-authenticated (user JWT, NOT service-role). Lookup-only — no Stripe
 * write calls. Target latency: p99 ≤ 100ms.
 *
 * Implements D-01/D-02/D-03/D-04/D-15/D-18/D-19 server-side.
 * The modal in 40-04 is a thin client — it never sees raw rules, cooldowns,
 * or coupon math.
 *
 * Decision flow:
 *   1. CORS preflight
 *   2. JWT bearer verify → extract auth.uid()
 *   3. Validate request body (reason + optional reason_other_text)
 *   4. Read profiles + subscriptions for user
 *   5. Compute tenure bucket from subscription.created_at
 *   6. Read prior accepted offers → D-02 cap + D-03 cooldown
 *   7. Determine isClinicOrg (subscription.clinic_id IS NOT NULL)
 *   8. resolveRule from save_offer_rules
 *   9. applyTenureGate defense-in-depth
 *  10. If discount: read existing Stripe discounts → D-15 clamp
 *  11. Build offer_config
 *  12. INSERT cancellation_offers_log with status='offered' → get offer_id
 *  13. Return DecideOfferResponse with Cache-Control: private, no-store
 *
 * Auth pattern: PATTERNS §6 user-bearer (helpdesk-ai-assist analog).
 * Log writes: service-role admin client (no SECDEF RPC — per Pitfall 4).
 * Stripe reads: only for stacking-pct check (D-15); no writes.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import {
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { captureException, addBreadcrumb } from '../_shared/sentry.ts';
import { shutdownPostHog } from '../_shared/posthog-server.ts';
import { resolveRule } from './resolve-rule.ts';
import {
  checkLifetimeCap,
  checkCooldown,
  clampSavePct,
  applyTenureGate,
  STACKING_CAP_EFFECTIVE,
} from './anti-gaming.ts';
import type {
  CancellationReason,
  OfferConfig,
  OfferType,
  TenureBucket,
  DecideOfferResponse,
} from '../_shared/cancellation-types.ts';

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

// ─── Lazy admin + Stripe ──────────────────────────────────────────────────────
const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();
export { setAdminForTest, resetAdminForTest };

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (_stripe === null) {
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
    });
  }
  return _stripe;
}
export function setStripeForTest(s: Stripe): void {
  _stripe = s;
}

// ─── Valid reason values ──────────────────────────────────────────────────────
const VALID_REASONS: CancellationReason[] = [
  'too_expensive',
  'not_using',
  'found_alternative',
  'health_goals_changed',
  'temporary_break',
  'service_quality_issue',
  'other',
];

// ─── Tenure bucket computation ────────────────────────────────────────────────
function computeTenureBucket(subscriptionCreatedAt: string): TenureBucket {
  const createdDate = new Date(subscriptionCreatedAt);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff < 30) return '<30d';
  if (daysDiff <= 180) return '30-180d';
  return '>180d';
}

// ─── Insert ineligible log row ────────────────────────────────────────────────
async function insertIneligibleLog(params: {
  user_id: string;
  org_id: string | null;
  subscription_id: string | null;
  reason: CancellationReason;
  reason_other_text: string | undefined;
  tenure_bucket: TenureBucket;
  status: 'ineligible_lifetime_cap' | 'ineligible_cooldown';
  prior_takes_count: number;
}): Promise<void> {
  await admin.from('cancellation_offers_log').insert({
    user_id: params.user_id,
    org_id: params.org_id,
    subscription_id: params.subscription_id,
    reason: params.reason,
    reason_other_text: params.reason_other_text ?? null,
    offer_type: 'none',
    offer_config: {},
    cohort_snapshot: {},
    tenure_bucket: params.tenure_bucket,
    status: params.status,
    prior_takes_count: params.prior_takes_count,
    stacking_clamped: false,
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  // 1. CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  try {
    // 2. JWT bearer verify
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError(401, 'unauthenticated');
    }
    const userJwt = authHeader.slice(7);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonError(401, 'unauthenticated');
    }
    const userId = user.id;

    addBreadcrumb({ category: 'cancellation-decide', message: 'jwt_verified', data: {} });

    // 3. Parse + validate body
    let body: { reason?: string; reason_other_text?: string };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_json');
    }

    const { reason, reason_other_text } = body;
    if (!reason || !VALID_REASONS.includes(reason as CancellationReason)) {
      return jsonError(400, 'invalid_reason');
    }
    if (reason === 'other') {
      if (!reason_other_text || reason_other_text.trim().length < 4) {
        return jsonError(400, 'reason_other_text_required');
      }
    }
    const typedReason = reason as CancellationReason;

    // 4. Read profiles + subscriptions
    const { data: subData, error: subError } = await admin
      .from('subscriptions')
      .select('id, created_at, clinic_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (subError) {
      console.warn('[cancellation-decide-offer] subscriptions query error:', subError.code);
      return jsonError(500, 'decide_failed');
    }
    if (!subData) {
      return jsonError(404, JSON.stringify({ code: 'NO_SUBSCRIPTION' }));
    }

    const { data: profileData } = await admin
      .from('profiles')
      .select('org_id')
      .eq('user_id', userId)
      .maybeSingle();
    const orgId = profileData?.org_id ?? null;

    // 5. Compute tenure bucket
    const tenureBucket = computeTenureBucket(subData.created_at);

    addBreadcrumb({
      category: 'cancellation-decide',
      message: 'context_resolved',
      data: { tenureBucket },
    });

    // 6. Read prior accepted offers → apply D-02 + D-03 checks
    const { data: priorTakes, error: takesError } = await admin
      .from('cancellation_offers_log')
      .select('id, taken_at, offer_type')
      .eq('user_id', userId)
      .eq('status', 'accepted');

    if (takesError) {
      console.warn('[cancellation-decide-offer] prior takes query error:', takesError.code);
      return jsonError(500, 'decide_failed');
    }

    const takes = priorTakes ?? [];
    const { exceeded, nonPauseCount } = checkLifetimeCap(takes);
    if (exceeded) {
      await insertIneligibleLog({
        user_id: userId,
        org_id: orgId,
        subscription_id: subData.id,
        reason: typedReason,
        reason_other_text,
        tenure_bucket: tenureBucket,
        status: 'ineligible_lifetime_cap',
        prior_takes_count: nonPauseCount,
      });
      const resp: DecideOfferResponse = {
        offer_id: null,
        offer_type: null,
        offer_config: null,
        stacking: null,
        ineligible_code: 'OFFER_INELIGIBLE_LIFETIME_CAP',
      };
      return jsonResponse(200, resp);
    }

    const { onCooldown } = checkCooldown(takes);
    if (onCooldown) {
      await insertIneligibleLog({
        user_id: userId,
        org_id: orgId,
        subscription_id: subData.id,
        reason: typedReason,
        reason_other_text,
        tenure_bucket: tenureBucket,
        status: 'ineligible_cooldown',
        prior_takes_count: nonPauseCount,
      });
      const resp: DecideOfferResponse = {
        offer_id: null,
        offer_type: null,
        offer_config: null,
        stacking: null,
        ineligible_code: 'OFFER_INELIGIBLE_COOLDOWN',
      };
      return jsonResponse(200, resp);
    }

    // 7. Determine isClinicOrg from subscription.clinic_id (D-04)
    const isClinicOrg = subData.clinic_id !== null;

    // 8. resolveRule
    const rule = await resolveRule(admin, {
      user_id: userId,
      tenureBucket,
      reason: typedReason,
      isClinicOrg,
    });

    if (!rule) {
      // Insert log row with offer_type='none' per D-18 reason capture
      await admin.from('cancellation_offers_log').insert({
        user_id: userId,
        org_id: orgId,
        subscription_id: subData.id,
        reason: typedReason,
        reason_other_text: reason_other_text ?? null,
        offer_type: 'none',
        offer_config: {},
        cohort_snapshot: {},
        tenure_bucket: tenureBucket,
        status: 'offered',
        prior_takes_count: nonPauseCount,
        stacking_clamped: false,
      });
      const resp: DecideOfferResponse = {
        offer_id: null,
        offer_type: null,
        offer_config: null,
        stacking: null,
        ineligible_code: 'OFFER_INELIGIBLE_NO_RULE',
      };
      return jsonResponse(200, resp);
    }

    // 9. applyTenureGate defense-in-depth (D-01)
    if (!applyTenureGate(tenureBucket, rule.offer_type)) {
      // Rule misconfigured for this tenure bucket — treat as no-rule
      await admin.from('cancellation_offers_log').insert({
        user_id: userId,
        org_id: orgId,
        subscription_id: subData.id,
        reason: typedReason,
        reason_other_text: reason_other_text ?? null,
        offer_type: 'none',
        offer_config: {},
        cohort_snapshot: {},
        tenure_bucket: tenureBucket,
        rule_id: rule.id,
        status: 'offered',
        prior_takes_count: nonPauseCount,
        stacking_clamped: false,
      });
      const resp: DecideOfferResponse = {
        offer_id: null,
        offer_type: null,
        offer_config: null,
        stacking: null,
        ineligible_code: 'OFFER_INELIGIBLE_NO_RULE',
      };
      return jsonResponse(200, resp);
    }

    // 10. D-15 stacking clamp (discount offers only — Open Q5: clamp exempt for others)
    let stackingPreClampPct: number | null = null;
    let stackingPostClampPct: number | null = null;
    let stackingClamped = false;
    let effectiveOfferType = rule.offer_type;
    let effectiveCouponId = rule.coupon_id;
    let effectivePercentOff: number | null = null;

    if (rule.offer_type === 'discount' && rule.coupon_id) {
      // Read existing Stripe discounts to compute existingPct
      // NOTE: this is the ONLY Stripe call in decide-Fn (lookup-only; per plan invariant)
      let existingPct = 0;
      try {
        const stripe = getStripe();
        const sub = await stripe.subscriptions.retrieve(subData.id, {
          expand: ['discounts'],
        });
        const discounts = (sub.discounts ?? []) as Array<{ coupon?: { percent_off?: number } | string }>;
        existingPct = discounts.reduce((acc, d) => {
          const couponObj = typeof d.coupon === 'object' ? d.coupon : null;
          const pct = couponObj?.percent_off ?? 0;
          // Accumulate multiplicatively (each discount reduces the remaining price)
          // For simplicity: effective = 1 - (1 - pct1/100) * (1 - pct2/100) ...
          // Here we sum percent_off values; the clamp formula handles the combined effect.
          return acc + pct / 100;
        }, 0);
        // Cap existingPct at 1.0 to avoid nonsensical results
        existingPct = Math.min(existingPct, 1.0);
      } catch (stripeErr) {
        console.warn('[cancellation-decide-offer] Stripe retrieve error:', (stripeErr as Error).message);
        // Non-fatal — proceed with existingPct=0
        existingPct = 0;
      }

      // Get the rule's percent_off from a fixed catalog lookup
      // The catalog coupons have fixed percent_off values (20/25/30%)
      // We need to know what percent the coupon_id represents
      // For v1.3: derive from coupon_id name (SAVE-XX-NMO format)
      const couponPctMatch = rule.coupon_id?.match(/^SAVE-(\d+)-/);
      const catalogPct = couponPctMatch ? parseInt(couponPctMatch[1]!, 10) / 100 : 0.25;

      stackingPreClampPct = existingPct;
      const clampResult = clampSavePct(existingPct, catalogPct);
      stackingPostClampPct = clampResult.finalSavePct;
      stackingClamped = clampResult.clamped;

      if (clampResult.finalSavePct === 0) {
        // Cannot add any discount without exceeding cap — fall back to pause
        const { data: pauseRule } = await admin
          .from('save_offer_rules')
          .select('*')
          .eq('active', true)
          .eq('offer_type', 'pause')
          .order('priority', { ascending: true })
          .limit(1)
          .single();

        if (pauseRule) {
          effectiveOfferType = 'pause';
          effectiveCouponId = null;
          effectivePercentOff = null;
        } else {
          // No pause rule either
          const resp: DecideOfferResponse = {
            offer_id: null,
            offer_type: null,
            offer_config: null,
            stacking: { existing_pct: existingPct, capped_pct: 0 },
            ineligible_code: 'OFFER_INELIGIBLE_NO_RULE',
          };
          return jsonResponse(200, resp);
        }
      } else {
        // Find the closest catalog coupon ≤ finalSavePct (clamped-down selection)
        // Catalog: 20%, 25%, 30% per D-12/D-13
        const CATALOG_PCTS = [0.20, 0.25, 0.30] as const;
        const targetPct = clampResult.finalSavePct;
        const selectedPct = CATALOG_PCTS.filter((p) => p <= targetPct + 0.001).at(-1) ?? 0.20;
        effectivePercentOff = selectedPct;

        // Select the coupon_id matching selectedPct + same duration as rule
        const durationMatch = rule.coupon_id?.match(/-(\d+MO)$/);
        const durationSuffix = durationMatch ? durationMatch[1] : '3MO';
        const pctLabel = Math.round(selectedPct * 100);
        effectiveCouponId = `SAVE-${pctLabel}-${durationSuffix}`;
      }
    }

    // 11. Build offer_config
    let offerConfig: OfferConfig;
    switch (effectiveOfferType as OfferType) {
      case 'pause':
        offerConfig = { type: 'pause', pause_months: (rule.pause_months ?? 1) as 1 | 2 | 3 };
        break;
      case 'discount':
        offerConfig = {
          type: 'discount',
          coupon_id: effectiveCouponId ?? rule.coupon_id ?? '',
          percent_off: effectivePercentOff !== null
            ? effectivePercentOff
            : (rule.coupon_id ? (parseInt(rule.coupon_id.match(/^SAVE-(\d+)-/)?.[1] ?? '25', 10) / 100) : 0.25),
          duration_in_months: (rule.coupon_id?.match(/-(\d+)MO$/)?.[1]
            ? (parseInt(rule.coupon_id.match(/-(\d+)MO$/)![1]!, 10) as 2 | 3)
            : 3),
        };
        break;
      case 'extended_trial':
        offerConfig = { type: 'extended_trial', extension_days: (rule.extension_days ?? 7) as 7 | 14 | 30 };
        break;
      case 'downgrade':
        offerConfig = { type: 'downgrade', target: 'price_monthly' };
        break;
      case 'contact_csm':
        offerConfig = { type: 'contact_csm' };
        break;
      default:
        offerConfig = { type: 'contact_csm' };
    }

    // 12. INSERT cancellation_offers_log with status='offered' → get offer_id
    const { data: logRow, error: insertError } = await admin
      .from('cancellation_offers_log')
      .insert({
        user_id: userId,
        org_id: orgId,
        subscription_id: subData.id,
        reason: typedReason,
        reason_other_text: reason_other_text ?? null,
        offer_type: effectiveOfferType,
        offer_config: offerConfig,
        cohort_snapshot: {},
        tenure_bucket: tenureBucket,
        rule_id: rule.id,
        prior_takes_count: nonPauseCount,
        stacking_pre_clamp_pct: stackingPreClampPct,
        stacking_post_clamp_pct: stackingPostClampPct,
        stacking_clamped: stackingClamped,
        status: 'offered',
        offered_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !logRow) {
      console.warn('[cancellation-decide-offer] log insert error:', insertError?.code);
      return jsonError(500, 'decide_failed');
    }

    addBreadcrumb({
      category: 'cancellation-decide',
      message: 'offer_decided',
      data: { offer_type: effectiveOfferType },
    });

    // 13. Return DecideOfferResponse
    const stackingInfo =
      stackingPreClampPct !== null && stackingPostClampPct !== null
        ? { existing_pct: stackingPreClampPct, capped_pct: stackingPostClampPct }
        : null;

    const resp: DecideOfferResponse = {
      offer_id: logRow.id,
      offer_type: effectiveOfferType as OfferType,
      offer_config: offerConfig,
      stacking: stackingInfo,
      ineligible_code: null,
    };

    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    captureException(err);
    console.error('[cancellation-decide-offer] unhandled error:', (err as Error).message);
    return jsonError(500, 'decide_failed');
  } finally {
    await shutdownPostHog();
  }
});
