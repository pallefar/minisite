/**
 * invoice-paid.ts — Handler for `invoice.paid` event.
 *
 * Two concerns, in strict order:
 *
 *  1. Phase 14 tier sync: writes `ux_tier='paid'` directly. An `invoice.paid`
 *     event by definition means the charge succeeded, so the past_due banner
 *     clears. `current_period_end` is taken from `invoice.period_end`.
 *     Closes CR-04 (see VERIFICATION.md).
 *
 *  2. Phase 19 affiliate-conversion attribution (Plan 19-04, AFF-02):
 *     ONLY runs when `billing_reason === 'subscription_create'` (D-36 — renewals
 *     do NOT count, otherwise we double-credit each month). Resolves `aff_code`
 *     from the subscription / invoice metadata, validates the affiliate is
 *     approved, and inserts an idempotent `affiliate_conversions` row with
 *     `eligible_at = invoice_paid_at + 60 days` (D-30 chargeback hold).
 *
 *     Idempotency: `affiliate_conversions.invoice_id` carries a UNIQUE constraint
 *     (Plan 19-01) — Postgres error 23505 on a replayed webhook is swallowed
 *     and treated as success (mirrors stripe-webhook/index.ts:175-198 pattern).
 *
 *     PII safety: success logs only `{ affiliate_id, invoice_id }` — never the
 *     subscription object, customer email, or full event payload.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// D-30 chargeback hold — affiliate conversions become eligible for payout
// only after 60 days, giving Stripe time to surface chargebacks/refunds.
const ELIGIBLE_DELAY_DAYS = 60;

interface AffiliateRow {
  id: string;
  commission_rate_cents: number;
  status: string;
}

/**
 * Pull the affiliate referral code from the Stripe invoice payload.
 *
 * Source-of-truth order (RESEARCH Pitfall 2):
 *   1. `invoice.subscription_details.metadata.aff_code` (2026-04-22.dahlia)
 *   2. `invoice.lines.data[0].metadata.aff_code`         (line-item fallback)
 *
 * Note: we DO NOT call `stripe.subscriptions.retrieve()` to read the
 * subscription's metadata directly — the 2026 API surfaces the subscription
 * metadata on the invoice via `subscription_details`, so a synchronous
 * payload read is sufficient and cheaper.
 */
function readAffCodeFromInvoice(invoice: Stripe.Invoice): string | null {
  // 2026-04-22.dahlia API surface — subscription_details.metadata.
  // deno-lint-ignore no-explicit-any
  const subDetailsMeta = (invoice as any).subscription_details?.metadata as
    | Record<string, string>
    | undefined;
  const fromSubDetails = subDetailsMeta?.['aff_code'];
  if (fromSubDetails && fromSubDetails.length > 0) return fromSubDetails;

  // Line-item fallback.
  const lines = invoice.lines?.data;
  if (lines && lines.length > 0) {
    // deno-lint-ignore no-explicit-any
    const fromLine = (lines[0] as any).metadata?.['aff_code'] as string | undefined;
    if (fromLine && fromLine.length > 0) return fromLine;
  }

  return null;
}

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = invoice.subscription as string | null;

  // ─── Phase 14 path — tier sync (unchanged) ────────────────────────────────
  if (!subId) {
    // Invoice not tied to a subscription (one-time charge) — ignore.
    console.log('[stripe-webhook/invoice-paid] no subscription_id, skipping');
    return;
  }

  const periodEnd = invoice.period_end
    ? new Date(invoice.period_end * 1000).toISOString()
    : null;

  const { error: tierErr } = await admin
    .from('subscriptions')
    .update({
      ux_tier: 'paid',
      status: 'active',
      current_period_end: periodEnd,
    })
    .eq('id', subId);

  if (tierErr) {
    console.error('[stripe-webhook/invoice-paid] update error', tierErr.message);
    throw new Error('invoice-paid-update-failed');
  }

  // ─── Phase 19 path — affiliate-conversion attribution (AFF-02) ────────────

  // D-36 filter: only count the FIRST invoice (subscription_create).
  // Renewals (subscription_cycle / manual / upcoming / …) MUST NOT credit
  // the affiliate again — that would double/triple-credit on every cycle.
  if (invoice.billing_reason !== 'subscription_create') {
    return;
  }

  // Resolve aff_code from the invoice payload.
  const affCode = readAffCodeFromInvoice(invoice);
  if (!affCode) {
    // Direct (non-attributed) signup — nothing to do.
    return;
  }

  // Look up the affiliate — must be approved at the time of attribution
  // (V11 contract: status changes between click and conversion silently no-op).
  const { data: affData, error: affErr } = await admin
    .from('affiliates')
    .select('id, commission_rate_cents, status')
    .eq('referral_code', affCode)
    .maybeSingle();

  if (affErr) {
    console.error('[stripe-webhook/invoice-paid] affiliate lookup error', affErr.message);
    throw new Error('affiliate-lookup-failed');
  }
  const affiliate = affData as AffiliateRow | null;
  if (!affiliate || affiliate.status !== 'approved') {
    return;
  }

  // D-30 — 60-day chargeback hold.
  const paidAtSec = invoice.status_transitions?.paid_at ?? Math.floor(Date.now() / 1000);
  const paidAtMs = paidAtSec * 1000;
  const eligibleAtIso = new Date(
    paidAtMs + ELIGIBLE_DELAY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const invoicePaidAtIso = new Date(paidAtMs).toISOString();

  // Resolve user_id (best-effort) — invoice.customer → stripe_customers.user_id.
  // If we can't resolve it (e.g. clinic-seat path with no user mapping), the
  // affiliate_conversions row carries user_id=NULL — that's intentional per
  // schema (affiliates.user_id FK is SET NULL on user delete; conversions
  // mirror that nullable contract).
  let resolvedUserId: string | null = null;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
  if (customerId) {
    const { data: custData } = await admin
      .from('stripe_customers')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    resolvedUserId = (custData as { user_id: string } | null)?.user_id ?? null;
  }

  // Idempotent INSERT — UNIQUE on invoice_id guarantees at-most-once-credit.
  // Phase 26 Plan 26-02: chain .select('id').single() so the just-inserted
  // row id is captured for anomaly correlation below.
  const { data: insertedConv, error: insErr } = await admin
    .from('affiliate_conversions')
    .insert({
      affiliate_id: affiliate.id,
      user_id: resolvedUserId,
      subscription_id: subId,
      invoice_id: invoice.id,
      commission_cents: affiliate.commission_rate_cents,
      status: 'pending',
      eligible_at: eligibleAtIso,
      invoice_paid_at: invoicePaidAtIso,
    })
    .select('id')
    .single();

  if (insErr) {
    // deno-lint-ignore no-explicit-any
    const pgCode = (insErr as any).code;
    if (pgCode === '23505') {
      // Replayed webhook — already credited. Idempotent success.
      // D-09: do NOT touch the pre-existing row's anomaly_flagged here —
      // the first writer owns that column.
      console.log(
        '[stripe-webhook/invoice-paid] duplicate conversion (idempotent)',
        JSON.stringify({ affiliate_id: affiliate.id, invoice_id: invoice.id }),
      );
      return;
    }
    console.error(
      '[stripe-webhook/invoice-paid] affiliate_conversions insert error',
      insErr.message,
    );
    throw new Error('affiliate-conversion-insert-failed');
  }

  console.log(
    '[stripe-webhook/invoice-paid] affiliate conversion recorded',
    JSON.stringify({ affiliate_id: affiliate.id, invoice_id: invoice.id }),
  );

  // ─── Phase 26 Plan 26-02 — Anomaly correlation (AFFTIER-05, D-09) ─────────
  //
  // The affiliate-attribute Edge Fn writes anomaly_z_score rows into
  // affiliate_fraud_signals on detection. At conversion time, surface today's
  // most recent unreviewed signal onto the just-inserted conversion row as
  // metadata. This is DEFAULT-TRUST: payment is NOT blocked, conversion
  // status stays 'pending', flag is for admin /admin/affiliates/review (UI
  // ships in Plan 26-05).
  //
  // Failure is non-fatal: a missing affiliate_fraud_signals table (e.g. in a
  // partial-deploy scenario where Plan 26-01's migration hasn't landed yet),
  // a missing anomaly_flagged column, or any other Postgres error MUST NOT
  // block the conversion record. Try/catch around the whole block.
  const insertedConvId = (insertedConv as { id: string } | null)?.id ?? null;
  if (insertedConvId !== null) {
    try {
      const todayStartIso = new Date(
        new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
      ).toISOString();

      const { data: pendingSignals } = await admin
        .from('affiliate_fraud_signals')
        .select('id, payload, decision')
        .eq('affiliate_id', affiliate.id)
        .eq('signal_type', 'anomaly_z_score')
        .is('decision', null)
        .gte('created_at', todayStartIso)
        .order('created_at', { ascending: false })
        .limit(1);

      if (pendingSignals && pendingSignals.length > 0) {
        const sig = pendingSignals[0] as { id: string; payload: { z_score?: number } | null };
        const z = sig.payload?.z_score ?? null;
        const { error: updErr } = await admin
          .from('affiliate_conversions')
          .update({ anomaly_flagged: true, anomaly_z_score: z })
          .eq('id', insertedConvId);
        if (updErr) {
          console.error(
            '[stripe-webhook/invoice-paid] anomaly flag UPDATE error (non-fatal)',
            updErr.message,
          );
        } else {
          console.log(
            '[stripe-webhook/invoice-paid] anomaly flag applied',
            JSON.stringify({
              conversion_id: insertedConvId,
              z_score: z,
            }),
          );
        }
      }
    } catch (anomErr) {
      // D-09 default-trust: never throw from the anomaly correlation path.
      console.error(
        '[stripe-webhook/invoice-paid] anomaly correlation error (non-fatal)',
        anomErr instanceof Error ? anomErr.message : 'unknown',
      );
    }
  }
}
