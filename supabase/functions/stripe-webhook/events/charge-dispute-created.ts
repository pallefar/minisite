// Phase 26 Plan 26-07 — Stripe charge.dispute.created handler.
// Claws back affiliate commission via payouts.adjustments AND writes a
// fraud_signals row (signal_type='chargeback') for superadmin review (D-06 + D-04).
// D-04 explicit reject: handler does NOT auto-freeze the affiliate — superadmin
// uses Plan 26-05 Anomaly Review tab to confirm and freeze manually.
import Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

interface AdjustmentEntry {
  type: 'refund' | 'chargeback' | 'manual';
  amount_cents: number;
  reason: string;
  related_event_id: string;
  related_conversion_id?: string;
  created_at: string;
}

interface FraudSignalChargebackPayload {
  kind: 'chargeback';
  stripe_charge_id: string;
  stripe_event_id: string;
  amount_cents: number;
}

// Charge resolver — injected for tests. In production, retrieves the charge
// from the Stripe API to read its `invoice` field (the dispute payload only
// carries the charge ID, not the expanded charge object).
export type ChargeResolver = (chargeId: string) => Promise<Stripe.Charge | null>;

function defaultChargeResolver(): ChargeResolver {
  return async (chargeId: string) => {
    const secret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    if (!secret) return null;
    const stripe = new Stripe(secret, {
      apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
    });
    try {
      return await stripe.charges.retrieve(chargeId);
    } catch (err) {
      console.warn(`[charge-dispute-created] charges.retrieve failed: ${(err as Error).message}`);
      return null;
    }
  };
}

export async function handle(
  event: Stripe.Event,
  admin: SupabaseClient,
  resolveCharge: ChargeResolver = defaultChargeResolver(),
): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) {
    console.log(`[charge-dispute-created] event=${event.id} no charge id; skipping`);
    return;
  }

  // Resolve charge → invoice. Dispute payload may carry expanded charge or just an ID.
  const embeddedCharge =
    typeof dispute.charge === 'object' && dispute.charge
      ? (dispute.charge as Stripe.Charge)
      : null;
  const charge = embeddedCharge ?? (await resolveCharge(chargeId));
  if (!charge) {
    console.log(
      `[charge-dispute-created] event=${event.id} charge=${chargeId} could not resolve; skipping`,
    );
    return;
  }

  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
  if (!invoiceId) {
    console.log(
      `[charge-dispute-created] event=${event.id} charge=${chargeId} no invoice on charge; skipping`,
    );
    return;
  }

  const { data: conv } = await admin
    .from('affiliate_conversions')
    .select('id, affiliate_id')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv) {
    console.log(
      `[charge-dispute-created] event=${event.id} invoice=${invoiceId} no conversion; skipping`,
    );
    return;
  }

  const disputedCents = dispute.amount ?? 0;
  const nowIso = new Date().toISOString();

  // Mark conversion clawback_pending (status CHECK widened by migration 20270701000013).
  await admin
    .from('affiliate_conversions')
    .update({ status: 'clawback_pending' })
    .eq('id', conv.id);

  // Append AdjustmentEntry to most-recent payout for this affiliate.
  const adjustment: AdjustmentEntry = {
    type: 'chargeback',
    amount_cents: -disputedCents,
    reason: `Stripe dispute ${dispute.id} on charge ${chargeId}`,
    related_event_id: event.id,
    related_conversion_id: conv.id,
    created_at: nowIso,
  };
  const { data: payouts } = await admin
    .from('payouts')
    .select('id, adjustments')
    .eq('affiliate_id', conv.affiliate_id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (payouts && payouts.length > 0) {
    const existing = (payouts[0].adjustments as AdjustmentEntry[] | null) ?? [];
    await admin
      .from('payouts')
      .update({ adjustments: [...existing, adjustment] })
      .eq('id', payouts[0].id);
  }

  // INSERT fraud_signals row — superadmin reviews via Plan 26-05 Anomaly Review tab.
  // D-04: NO auto-freeze. Superadmin uses Confirm Fraud action to freeze.
  const payload: FraudSignalChargebackPayload = {
    kind: 'chargeback',
    stripe_charge_id: chargeId,
    stripe_event_id: event.id,
    amount_cents: disputedCents,
  };
  await admin.from('affiliate_fraud_signals').insert({
    affiliate_id: conv.affiliate_id,
    conversion_id: conv.id,
    signal_type: 'chargeback',
    payload,
  });
}
