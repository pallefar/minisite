/**
 * invoice-created.ts — Handler for `invoice.created` event.
 *
 * Phase 29 Plan 03 — D-04 billing variance detection.
 *
 * Validates Stripe's billed quantity (from the metered line item) against the
 * local `count_active_patients()` snapshot. Fires a Sentry warning if variance
 * exceeds 10% — surfacing billing drift before the invoice is finalized.
 *
 * Security invariants:
 *  - Early-returns ONLY when BOTH path A (subscription_details.metadata.clinic_id)
 *    AND path B (clinic_stripe_customers fallback) fail — per Open-Q2 RESOLVED
 *    dual-path lookup (29-RESEARCH.md).
 *  - RPC call wrapped in try/catch; Sentry.captureException on error; NEVER throws
 *    upstream (a 500 would trigger Stripe retries with exponential backoff).
 *  - Sentry alerts contain only aggregate counts (non-PHI: clinicId is UUID,
 *    counts are integers). T-29-03-02 accepted.
 *
 * Threat model: T-29-03-01 (forged webhook) mitigated upstream by
 * constructEventAsync signature check in stripe-webhook/index.ts.
 */

import type Stripe from 'https://esm.sh/stripe@19?target=denonext';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from '../../_shared/sentry.ts';

const VARIANCE_THRESHOLD = 0.10; // D-04: 10% — log Sentry warning if exceeded
const METER_EVENT_NAME = 'active_patient_month';

/**
 * Test-injectable Sentry interface. In production this is always undefined.
 * Tests can supply a spy object that replaces the Sentry module calls for
 * assertion without mutating the frozen ESM namespace.
 *
 * @internal — never set in production. Only used by invoice-created.test.ts.
 */
export interface SentryStub {
  captureMessage: typeof Sentry.captureMessage;
  captureException: typeof Sentry.captureException;
}

export async function handle(
  event: Stripe.Event,
  admin: SupabaseClient,
  _sentrySpy?: SentryStub,
): Promise<void> {
  const sentry: SentryStub = _sentrySpy ?? Sentry;
  const invoice = event.data.object as Stripe.Invoice;

  // ─── Dual-path clinic_id lookup (Open-Q2 RESOLVED) ────────────────────────
  //
  // Path A: Stripe ≥2024-09-30 surfaces subscription metadata on invoices via
  //         `subscription_details.metadata`. This is preferred.
  // Path B: Fallback — look up `clinic_stripe_customers` by invoice.customer.
  //         Handles older API versions and back-fill scenarios.
  //
  // Early-return ONLY when BOTH paths fail (= genuinely a consumer invoice).

  // deno-lint-ignore no-explicit-any
  const subMeta = ((invoice as any).subscription_details?.metadata as Record<string, string> | null) ?? null;
  let clinicId: string | null = subMeta?.['clinic_id'] ?? null;

  if (!clinicId && typeof invoice.customer === 'string') {
    // Path B: look up clinic_stripe_customers by Stripe customer ID.
    const { data } = await admin
      .from('clinic_stripe_customers')
      .select('clinic_id')
      .eq('stripe_customer_id', invoice.customer)
      .maybeSingle();
    clinicId = ((data as { clinic_id?: string } | null)?.clinic_id) ?? null;
  }

  if (!clinicId) {
    // Both paths failed — this is a consumer invoice. Skip silently.
    return;
  }

  // ─── Find metered line item ────────────────────────────────────────────────

  // deno-lint-ignore no-explicit-any
  const meteredLine = invoice.lines?.data?.find(
    // deno-lint-ignore no-explicit-any
    (line: any) => (line.price as { meter?: string } | null)?.meter === METER_EVENT_NAME,
  );
  if (!meteredLine?.quantity) {
    // No metered line for our meter — nothing to validate.
    return;
  }
  const stripeCount = meteredLine.quantity as number;

  // ─── Fetch local snapshot ─────────────────────────────────────────────────

  let localCount: number;
  try {
    const { data, error } = await admin.rpc('count_active_patients', { p_org_id: clinicId });
    if (error) throw error;
    localCount = Number(data ?? 0);
  } catch (err) {
    // T-29-03-03: catch RPC failure + Sentry; never throw upstream.
    sentry.captureException(err, {
      tags: { billing_variance: 'rpc_error' },
    });
    return;
  }

  // ─── D-04 variance check ──────────────────────────────────────────────────

  const variance = Math.abs(stripeCount - localCount) / Math.max(stripeCount, 1);
  if (variance > VARIANCE_THRESHOLD) {
    sentry.captureMessage('Metered billing variance', {
      level: 'warning',
      extra: {
        clinicId,
        stripeCount,
        localCount,
        variance,
        invoiceId: invoice.id,
      },
      tags: { billing_variance: 'true' },
    });
  }
}
