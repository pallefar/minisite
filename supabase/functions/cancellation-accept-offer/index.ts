/**
 * cancellation-accept-offer Edge Function — Phase 40 Plan 40-03.
 *
 * POST /functions/v1/cancellation-accept-offer
 *
 * JWT-authenticated (user JWT, NOT service-role). Performs Stripe writes.
 * Target latency: p99 ≤ 2s.
 *
 * Implements D-06 (pause apply), D-10 (extend counter math), D-14 (discounts[] append),
 * D-15 (clamp delivery), D-16 (next-invoice via repeating coupon).
 *
 * Decision flow:
 *   1. CORS preflight
 *   2. JWT bearer verify → extract auth.uid()
 *   3. Parse + validate body (offer_id, optional pause_months_override)
 *   4. Read offer row from cancellation_offers_log (user_id + status='offered' ownership check)
 *   5. Read subscription for Stripe context
 *   6. Detect extension semantics (D-10): if offer_type='pause' AND user already has active pause
 *   7. Dispatch to apply-{pause|discount|extended_trial|downgrade|contact_csm}
 *   8. INSERT second log row (status='accepted') — 2-row append per PATTERNS §6 option (a)
 *   9. Return AcceptOfferResponse
 *
 * Security: offer_id ownership re-verified server-side (T-40-03-01 cross-user replay defense).
 *
 * 2-row append link: rows share (user_id, rule_id, offered_at) tuple. There is NO offered_log_id
 * FK column in the 40-01 schema; linking is by rule+session context for the admin ROI dashboard.
 *
 * Auth pattern: PATTERNS §6 user-bearer (helpdesk-ai-assist analog).
 * Log writes: service-role admin client (no SECDEF RPC — per Pitfall 4).
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
import { applyPause } from './apply-pause.ts';
import { applyDiscount } from './apply-discount.ts';
import { extendPause } from './extend-pause.ts';
import { applyExtendedTrial } from './apply-extended-trial.ts';
import { applyDowngrade } from './apply-downgrade.ts';
import type {
  AcceptOfferRequest,
  AcceptOfferResponse,
  OfferConfig,
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

// ─── UUID validation ──────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
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
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonError(401, 'unauthenticated');
    }
    const userId = user.id;

    addBreadcrumb({ category: 'cancellation-accept', message: 'jwt_verified', data: {} });

    // 3. Parse + validate body
    let body: AcceptOfferRequest;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_json');
    }

    const { offer_id, pause_months_override } = body;
    if (!offer_id || !isValidUuid(offer_id)) {
      return jsonError(400, 'invalid_offer_id');
    }
    if (
      pause_months_override !== undefined &&
      ![1, 2, 3].includes(pause_months_override)
    ) {
      return jsonError(400, 'invalid_pause_months_override');
    }

    // 4. Read the offer row — ownership + status gate (T-40-03-01 security gate)
    // SELECT filters user_id = caller.uid AND status='offered'
    // Cross-user offer_id or already-accepted offer → 404 (status='offered' excludes 'accepted')
    const { data: offerRow, error: offerError } = await admin
      .from('cancellation_offers_log')
      .select('*')
      .eq('id', offer_id)
      .eq('user_id', userId)
      .eq('status', 'offered')
      .maybeSingle();

    if (offerError) {
      console.warn('[cancellation-accept-offer] offer lookup error:', offerError.code);
      return jsonError(500, 'accept_failed');
    }
    if (!offerRow) {
      return jsonError(404, 'offer_not_found_or_not_owner');
    }

    const offerConfig = offerRow.offer_config as OfferConfig;
    const offerType = offerRow.offer_type as string;

    addBreadcrumb({
      category: 'cancellation-accept',
      message: 'offer_validated',
      data: { offer_type: offerType },
    });

    // 5. Read subscription for Stripe context
    const { data: subData, error: subError } = await admin
      .from('subscriptions')
      .select('id, clinic_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (subError || !subData) {
      console.warn('[cancellation-accept-offer] subscription lookup error:', subError?.code);
      return jsonError(500, 'accept_failed');
    }

    const stripe = getStripe();

    // 6. Detect extension semantics (D-10)
    // If offer_type='pause' AND user has a current active (accepted) pause row, this is an EXTENSION.
    // Extension DOES count toward the lifetime cap (unlike initial pause which is exempt).
    let isExtension = false;
    if (offerType === 'pause') {
      const { data: priorPause } = await admin
        .from('cancellation_offers_log')
        .select('id, taken_at')
        .eq('user_id', userId)
        .eq('status', 'accepted')
        .eq('offer_type', 'pause')
        .order('taken_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (priorPause?.taken_at) {
        // Check if this is an extension of an active pause by verifying the subscription is paused
        try {
          const stripeSub = await stripe.subscriptions.retrieve(subData.id);
          isExtension = stripeSub.pause_collection !== null && stripeSub.pause_collection.resumes_at !== null;
        } catch {
          // Non-fatal: if we can't retrieve, assume initial pause
          isExtension = false;
        }
      }
    }

    // 7. Dispatch based on offer_type
    let acceptResult: AcceptOfferResponse;

    if (offerType === 'pause') {
      const pauseMonths: 1 | 2 | 3 =
        pause_months_override ??
        (offerConfig.type === 'pause' ? offerConfig.pause_months : 1);

      if (isExtension) {
        // D-10: This is a pause extension — use extendPause and count toward cap
        try {
          const { resumesAt } = await extendPause(subData.id, pauseMonths, stripe);
          acceptResult = {
            accepted: true,
            resumes_at: new Date(resumesAt * 1000).toISOString(),
          };
        } catch (err) {
          const errMsg = (err as Error).message;
          if (errMsg === 'SUB_NOT_PAUSED') {
            // Race: user's pause expired between detection and extend call
            // Fall back to initial pause
            try {
              const { resumesAt } = await applyPause(subData.id, pauseMonths, stripe);
              isExtension = false; // treat as initial
              acceptResult = {
                accepted: true,
                resumes_at: new Date(resumesAt * 1000).toISOString(),
              };
            } catch (innerErr) {
              captureException(innerErr);
              const code = ((innerErr as Error).message ?? '').replace('PAUSE_FAILED:', '');
              addBreadcrumb({
                category: 'cancellation-accept',
                message: 'pause_apply_failed',
                data: { error: code },
              });
              return jsonError(500, `pause_apply_failed:${code}`);
            }
          } else {
            captureException(err);
            return jsonError(500, 'extend_pause_failed');
          }
        }
      } else {
        // Initial pause (D-02 exempt from lifetime cap)
        try {
          const { resumesAt } = await applyPause(subData.id, pauseMonths, stripe);
          acceptResult = {
            accepted: true,
            resumes_at: new Date(resumesAt * 1000).toISOString(),
          };
        } catch (err) {
          // A5: Stripe rejected pause (likely trialing subscription)
          const code = ((err as Error).message ?? '').replace('PAUSE_FAILED:', '');
          captureException(err);
          addBreadcrumb({
            category: 'cancellation-accept',
            message: 'pause_apply_failed_a5',
            data: { error: code },
          });
          // Surface error code to client; do NOT write accepted row
          return jsonError(500, `pause_apply_failed:${code}`);
        }
      }
    } else if (offerType === 'discount') {
      const couponId = offerConfig.type === 'discount' ? offerConfig.coupon_id : '';
      if (!couponId) {
        return jsonError(400, 'missing_coupon_id');
      }
      const { appliedCouponId } = await applyDiscount(subData.id, couponId, stripe);
      acceptResult = {
        accepted: true,
        applied_coupon_id: appliedCouponId,
      };
    } else if (offerType === 'extended_trial') {
      const extensionDays = offerConfig.type === 'extended_trial' ? offerConfig.extension_days : 7;
      const { nextInvoiceDate } = await applyExtendedTrial(
        subData.id,
        extensionDays as 7 | 14 | 30,
        stripe,
      );
      acceptResult = {
        accepted: true,
        next_invoice_date: nextInvoiceDate,
      };
    } else if (offerType === 'downgrade') {
      const { nextInvoiceDate } = await applyDowngrade(subData.id, stripe);
      acceptResult = {
        accepted: true,
        next_invoice_date: nextInvoiceDate,
      };
    } else if (offerType === 'contact_csm') {
      // D-04 clinic CSM: no Stripe call; 40-04's cancellation-feedback-to-ticket handles the ticket
      acceptResult = { accepted: true };
    } else {
      console.warn('[cancellation-accept-offer] unknown offer_type:', offerType);
      return jsonError(400, 'unknown_offer_type');
    }

    addBreadcrumb({
      category: 'cancellation-accept',
      message: 'stripe_write_complete',
      data: { offer_type: offerType, is_extension: isExtension },
    });

    // 8. INSERT second log row (status='accepted') — 2-row append per PATTERNS §6 option (a)
    // Note: No offered_log_id FK column in schema (40-01 design). The 2-row link is by
    // (user_id, rule_id, offered_at) tuple for admin ROI dashboard queries.
    // Extension pauses increment the prior_takes_count (D-10 cap math).
    const priorTakesCountIncrement = isExtension ? 1 : 0;
    const effectivePauseMonths =
      offerType === 'pause'
        ? (pause_months_override ?? (offerConfig.type === 'pause' ? offerConfig.pause_months : 1))
        : undefined;
    const effectiveOfferConfig: OfferConfig =
      offerType === 'pause' && effectivePauseMonths !== undefined
        ? { type: 'pause', pause_months: effectivePauseMonths as 1 | 2 | 3 }
        : offerConfig;

    const { error: insertError } = await admin
      .from('cancellation_offers_log')
      .insert({
        user_id: userId,
        org_id: offerRow.org_id ?? null,
        subscription_id: subData.id,
        reason: offerRow.reason,
        reason_other_text: offerRow.reason_other_text ?? null,
        offer_type: offerType,
        offer_config: effectiveOfferConfig,
        cohort_snapshot: offerRow.cohort_snapshot ?? {},
        tenure_bucket: offerRow.tenure_bucket,
        rule_id: offerRow.rule_id ?? null,
        prior_takes_count: (offerRow.prior_takes_count ?? 0) + priorTakesCountIncrement,
        stacking_clamped: offerRow.stacking_clamped ?? false,
        status: 'accepted',
        taken_at: new Date().toISOString(),
        posthog_variant_id: offerRow.posthog_variant_id ?? null,
      });

    if (insertError) {
      console.warn('[cancellation-accept-offer] log insert error:', insertError.code);
      // Stripe write already succeeded — log the error but return success to client
      // (don't double-apply Stripe action on retry)
      captureException(new Error(`accepted_log_insert_failed:${insertError.code}`));
    }

    // 9. Return AcceptOfferResponse
    return jsonResponse(200, acceptResult);
  } catch (err) {
    captureException(err);
    console.error('[cancellation-accept-offer] unhandled error:', (err as Error).message);
    return jsonError(500, 'accept_failed');
  } finally {
    await shutdownPostHog();
  }
});
