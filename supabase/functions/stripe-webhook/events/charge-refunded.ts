// Phase 26 Plan 26-07 — Stripe charge.refunded handler.
// Claws back affiliate commission via payouts.adjustments (D-06).
// Idempotency: dispatcher gates via subscription_events.event_id UNIQUE
// (Phase 14 carry-forward). Handler does not re-check.
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// AdjustmentEntry shape MUST match leanshot/src/lib/affiliate/types.ts SoT.
// Re-declared here for Deno (cannot import from leanshot/src — separate runtime).
interface AdjustmentEntry {
  type: 'refund' | 'chargeback' | 'manual';
  amount_cents: number;
  reason: string;
  related_event_id: string;
  related_conversion_id?: string;
  created_at: string;
}

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const charge = event.data.object as Stripe.Charge;

  // No invoice → no subscription → no affiliate conversion to claw back. No-op.
  if (!charge.invoice) {
    console.log(`[charge-refunded] event=${event.id} charge=${charge.id} no invoice; skipping`);
    return;
  }

  // Resolve directly via affiliate_conversions.invoice_id. The existing
  // v1.2 column (Plan 19-01) already holds the Stripe invoice ID, so no
  // intermediate subscription→conversion lookup is required.
  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice.id;
  const { data: conv } = await admin
    .from('affiliate_conversions')
    .select('id, affiliate_id, commission_cents, invoice_id')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv) {
    console.log(`[charge-refunded] event=${event.id} invoice=${invoiceId} no affiliate conversion; skipping`);
    return;
  }

  // Mark conversion clawback_pending (status CHECK widened by migration 20270701000013).
  await admin
    .from('affiliate_conversions')
    .update({ status: 'clawback_pending' })
    .eq('id', conv.id);

  // Append AdjustmentEntry to the most-recent payout for this affiliate.
  // If none exists yet, the materialize cron will roll it up from the
  // clawback_pending status next cycle.
  const refundAmount = charge.amount_refunded ?? 0;
  const adjustment: AdjustmentEntry = {
    type: 'refund',
    amount_cents: -refundAmount,
    reason: `Stripe charge ${charge.id} refunded`,
    related_event_id: event.id,
    related_conversion_id: conv.id,
    created_at: new Date().toISOString(),
  };

  const { data: payouts } = await admin
    .from('payouts')
    .select('id, adjustments')
    .eq('affiliate_id', conv.affiliate_id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (payouts && payouts.length > 0) {
    const existing = (payouts[0].adjustments as AdjustmentEntry[] | null) ?? [];
    const next = [...existing, adjustment];
    await admin.from('payouts').update({ adjustments: next }).eq('id', payouts[0].id);
  } else {
    console.log(`[charge-refunded] event=${event.id} aff=${conv.affiliate_id} no payout yet; deferred to materialize`);
  }
}
