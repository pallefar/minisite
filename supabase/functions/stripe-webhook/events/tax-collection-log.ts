/**
 * tax-collection-log.ts — Phase 65-04 Plan 65-04 (PAY-01)
 * =============================================================================
 *
 * Shared helper that records a Stripe Tax calculation into public.tax_collection_log.
 * Called from `checkout-session-completed.ts` (this phase) and intended for reuse
 * by future invoice-level handlers (PAY-04 nexus matview depends on rows here).
 *
 * Schema reference: supabase/migrations/20290104000006_tax_collection_log.sql
 *   - id surrogate uuid PK
 *   - subscription_id (text, FK subscriptions.id)
 *   - org_subscription_id (uuid, FK org_subscriptions.org_id) — clinic path
 *   - customer_state / customer_postal (from session.customer_details.address)
 *   - tax_amount_cents / subtotal_cents / total_cents (Stripe.Checkout.Session)
 *   - tax_rate_percent (computed: amount_tax / amount_subtotal * 100, 3 decimals)
 *   - automatic_tax_status enum (complete | requires_location_inputs | failed)
 *
 * Idempotency: The DB schema does NOT have a UNIQUE constraint on
 * `stripe_session_id`. The dedup gate is the upstream `subscription_events.event_id`
 * PRIMARY KEY in handleRequest (see ../index.ts) — a duplicate event_id is rejected
 * BEFORE this helper runs. So we do a plain INSERT here.
 *
 * PII safety (T-65-04-02): this helper records tax AMOUNTS but NEVER tax_id values.
 * Logging is limited to {session_id, status, state_set} — never raw amounts in error
 * paths either (Stripe stores the canonical record).
 *
 * Audit-log failures MUST NOT fail the webhook (T-65-04-04 — Denial of Service:
 * accept disposition). Callers should wrap invocation in try/catch + log + return 200.
 *
 * References:
 *   - [[reference_supabase_pg_cron_vault_service_role_pattern]] — matview refresh cron
 *     lands in Plan 65-08; this row stream is its source of truth.
 *   - [[reference_rpc_auth_uid_vs_service_role_mismatch]] — service_role admin client;
 *     do NOT use SECDEF RPCs referencing auth.uid().
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Write a tax_collection_log row from a Stripe Checkout.Session. No-op if the
 * session has no `automatic_tax` field (legacy / non-subscription / payment-mode
 * flows that don't engage Stripe Tax).
 *
 * Resolves subscription_id (text) OR org_subscription_id (uuid) from the session's
 * subscription_data.metadata — mirrors the checkout-session-completed.ts dispatch.
 *
 * Caller responsibility: wrap in try/catch — errors here MUST NOT fail the webhook.
 */
export async function writeTaxCollectionLog(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  // Gate: skip rows where Stripe Tax was not engaged at all.
  const autoTax = (session as unknown as Record<string, unknown>).automatic_tax as
    | { status?: string; enabled?: boolean }
    | undefined
    | null;
  const status = autoTax?.status;
  if (!status) {
    return;
  }

  // Resolve subscription_id (text — subscriptions.id is text per Phase 14 schema)
  // OR org_subscription_id (uuid — org_subscriptions PK is org_id uuid per Phase 28).
  // subscription_data.metadata is the source of truth (mirrors existing handler).
  const subDataMeta = (
    (session.subscription_data?.metadata ?? session.metadata) as Record<string, string>
  ) ?? {};
  const tierKind = subDataMeta.tier_kind;

  let subscriptionId: string | null = null;
  let orgSubscriptionId: string | null = null;
  if (tierKind === 'clinic') {
    orgSubscriptionId = subDataMeta.clinic_id ?? null;
  } else {
    // web / lifetime / fallback — subscription_id (text) if present.
    subscriptionId = (session.subscription as string | null) ?? null;
  }

  // At least one of subscription_id / org_subscription_id MUST be non-null
  // (CHECK constraint tax_collection_log_sub_or_org_check). If neither resolves,
  // skip — this is a malformed session for our purposes; do not throw.
  if (!subscriptionId && !orgSubscriptionId) {
    console.warn(
      '[tax-collection-log] skipping — neither subscription_id nor org_subscription_id resolvable',
      JSON.stringify({ session_id: session.id, tier_kind: tierKind ?? null }),
    );
    return;
  }

  // Extract amounts. Stripe omits these on some session shapes (e.g. setup mode);
  // default to 0 to satisfy NOT NULL columns.
  const amountSubtotal = (session.amount_subtotal ?? 0) as number;
  const amountTotal = (session.amount_total ?? 0) as number;
  const totalDetails = (session as unknown as Record<string, unknown>).total_details as
    | { amount_tax?: number }
    | undefined;
  const amountTax = (totalDetails?.amount_tax ?? 0) as number;

  // tax_rate_percent = amount_tax / amount_subtotal * 100, 3 decimals. NULL if subtotal=0.
  const taxRatePercent =
    amountSubtotal > 0
      ? Math.round((amountTax / amountSubtotal) * 100 * 1000) / 1000
      : null;

  // Customer state/postal from session.customer_details.address.
  const custDetails = (session as unknown as Record<string, unknown>).customer_details as
    | { address?: { state?: string | null; postal_code?: string | null } | null }
    | undefined
    | null;
  const customerState = custDetails?.address?.state ?? null;
  const customerPostal = custDetails?.address?.postal_code ?? null;

  // Normalize status to one of the schema's allowed enum values; map unknowns to 'failed'.
  const normalizedStatus =
    status === 'complete' || status === 'requires_location_inputs' || status === 'failed'
      ? status
      : 'failed';

  const row: Record<string, unknown> = {
    subscription_id: subscriptionId,
    org_subscription_id: orgSubscriptionId,
    stripe_session_id: session.id ?? null,
    stripe_payment_intent_id:
      typeof session.payment_intent === 'string' ? session.payment_intent : null,
    customer_state: customerState,
    customer_postal: customerPostal,
    tax_amount_cents: amountTax,
    subtotal_cents: amountSubtotal,
    total_cents: amountTotal,
    tax_rate_percent: taxRatePercent,
    automatic_tax_status: normalizedStatus,
  };

  const { error } = await admin.from('tax_collection_log').insert(row);
  if (error) {
    // PII-safe log: do NOT include raw row (amounts are sensitive). Stripe is canonical.
    console.error(
      '[tax-collection-log] insert error',
      JSON.stringify({
        session_id: session.id,
        status: normalizedStatus,
        state_set: customerState !== null,
        error_message: error.message,
        error_code: error.code,
      }),
    );
    // Re-throw so the caller's try/catch logs + the webhook still returns 200.
    throw new Error(`tax-collection-log-insert-failed: ${error.message}`);
  }
}
