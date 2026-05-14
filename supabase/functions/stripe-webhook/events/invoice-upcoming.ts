/**
 * invoice-upcoming.ts — Handler for `invoice.upcoming` event.
 *
 * Performs the monthly metered true-up for clinic subscriptions:
 *   1. Identifies the clinic from the Stripe customer ID.
 *   2. Counts active patients via `count_active_patients()` (SECURITY DEFINER).
 *   3. Computes overage above the 10-patient base allowance (D-10).
 *   4. Emits a single Billing Meters v1 event for the overage.
 *
 * Web-tier (user) `invoice.upcoming` events are silently ignored.
 *
 * Security invariants (T-14-07-*):
 *   - T-14-07-02: SHA-256 `identifier` = SHA256(`${clinic_id}_${YYYY-MM}`)
 *     ensures Stripe server-side deduplication for replay attacks.
 *   - T-14-07-04: Only event.id, clinic_id, active_count, overage, and
 *     identifier_prefix (8 chars) are logged — no PII.
 *   - T-14-07-07: 35-day window guard prevents timestamp-out-of-range
 *     rejections from Stripe (Pitfall 9 + Assumption A10).
 */
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ─── SHA-256 helper (self-contained — no cross-file import from events/*.ts) ──
// Copied inline from clinic-invite pattern. No external dep.
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Handler context type (matches 14-03 dispatcher contract) ─────────────────
export interface HandlerCtx {
  admin: SupabaseClient; // service-role client (RLS bypass)
  stripe: Stripe; // pre-configured Stripe client
}

// ─── Core handler (exported for tests with ctx injection) ────────────────────
export async function handleInvoiceUpcoming(
  event: Stripe.Event,
  ctx: HandlerCtx,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  // Defensive null checks — Stripe can theoretically omit these on draft invoices.
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
  const periodStart = typeof invoice.period_start === 'number' ? invoice.period_start : null;

  if (!customerId || periodStart === null) {
    console.debug('[stripe-webhook/invoice-upcoming] missing customer or period_start', {
      event_id: event.id,
    });
    return;
  }

  // ── Tier dispatch: look up clinic_id from clinic_stripe_customers ────────────
  // If no row exists, this is a web-tier customer or unregistered → silent no-op.
  const { data: clinicRow } = await ctx.admin
    .from('clinic_stripe_customers')
    .select('clinic_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (!clinicRow) {
    // Web-tier or unregistered — normal no-op for invoice.upcoming.
    return;
  }

  const clinicId: string = (clinicRow as { clinic_id: string }).clinic_id;

  // ── 35-day window guard (Pitfall 9 + A10) ────────────────────────────────────
  // Stripe rejects meterEvents with timestamps older than ~35 days.
  // We use Date.now() as the event timestamp (not period_start), so the guard
  // protects against firing the webhook long after the period closed.
  const ageDays = (Date.now() - periodStart * 1000) / (1000 * 86400);
  if (ageDays > 35) {
    console.warn('[stripe-webhook/invoice-upcoming] skipped: period_start older than 35 days', {
      clinic_id: clinicId,
      period_start_iso: new Date(periodStart * 1000).toISOString(),
      age_days: Math.floor(ageDays),
    });
    return;
  }

  // ── Count active patients (SECURITY DEFINER; service-role → RLS bypass) ──────
  const { data: count, error: rpcError } = await ctx.admin.rpc('count_active_patients', {
    p_clinic_id: clinicId,
  });

  if (rpcError) {
    // Log error details (no PII) and throw so dispatcher returns 500 → Stripe retries.
    console.error('[stripe-webhook/invoice-upcoming] count_active_patients error', {
      event_id: event.id,
      message: rpcError.message,
    });
    throw new Error('count-active-patients-failed');
  }

  // count is a plain integer (Supabase SQL-language function scalar return).
  const activeCount = count as number;

  // ── Overage math (base allowance = 10 per D-10) ───────────────────────────────
  const overage = Math.max(0, activeCount - 10);
  if (overage === 0) {
    // At or below base allowance — no meter event needed.
    return;
  }

  // ── Deterministic SHA-256 identifier (RESEARCH §"Meter event recording") ─────
  // Identifier = SHA256(`${clinic_id}_${YYYY-MM}`) → 64-char hex, under 100-char limit.
  // Stripe deduplicates server-side via `identifier`; we assert determinism client-side.
  const periodStartMarker = new Date(periodStart * 1000).toISOString().slice(0, 7); // 'YYYY-MM'
  const identifierRaw = `${clinicId}_${periodStartMarker}`;
  const hashHex = await sha256Hex(identifierRaw);

  // ── Emit Billing Meters v1 event ───────────────────────────────────────────────
  // NOTE: stripe.v1.billing.meterEvents.create is ABSENT in stripe@19 at runtime
  // (Wave-0 audit: typeof s.v1?.billing?.meterEvents?.create === 'undefined').
  // Use stripe.billing.meterEvents.create per Assumption A10 fallback.
  //
  // `payload.value` MUST be a STRING per Stripe API contract (RESEARCH line 600).
  // `identifier` provides server-side idempotency (NOT Idempotency-Key header).
  // `timestamp` = now() in seconds — well within 35-day window (already checked above).
  // Anti-pattern: DO NOT call stripe.subscriptionItems.createUsageRecord (removed 2025-03-31).
  await ctx.stripe.billing.meterEvents.create({
    event_name: 'active_patients', // matches meter created by 14-02 bootstrap (PLURAL)
    payload: {
      stripe_customer_id: customerId,
      value: String(overage), // STRING per API contract
    },
    identifier: hashHex,
    timestamp: Math.floor(Date.now() / 1000),
  });

  // Success log — no PII, no full identifier (T-14-07-04 mitigation).
  console.info('[stripe-webhook/invoice-upcoming] emitted', {
    event_id: event.id,
    clinic_id: clinicId,
    active_count: activeCount,
    overage,
    identifier_prefix: hashHex.slice(0, 8),
  });
}

// ─── Dispatcher-compatible export (matches 14-03 contract: handle(event, admin)) ──
// The dispatcher in index.ts imports `{ handle }` and calls `handle(event, admin)`.
// This shim creates a Stripe client from env and delegates to handleInvoiceUpcoming.
export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
  });
  await handleInvoiceUpcoming(event, { admin, stripe });
}
