/**
 * checkout-session-completed.ts — Handler for `checkout.session.completed` event.
 * Phase 14 Plan 03 Task 2 (full implementation).
 *
 * Phase 65-04 Plan 65-04 — PAY-03 + PAY-01:
 *   1. PAY-03: mirror collected B2B tax_id to subscriptions.tax_id (clinic row,
 *      session is a clinic plan AND session.customer_tax_ids has length ≥ 1.
 *   2. PAY-01: call writeTaxCollectionLog to audit every Stripe Tax calculation
 *      that the session engaged (gated on session.automatic_tax?.status presence).
 *
 * PII safety (T-65-04-02): the tax_id VALUE is never logged. Only `tax_id_set: true/false`
 * appears in operator logs. Audit-log failures (T-65-04-04 accept disposition) are
 * caught and logged but never re-thrown — primary subscription mapping must succeed.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { writeTaxCollectionLog } from './tax-collection-log.ts';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const subId = session.subscription as string;
  const customerId = session.customer as string;

  // Metadata contract from plan 14-04: tier_kind, user_id, clinic_id
  const meta = (
    (session.subscription_data?.metadata ?? session.metadata) as Record<string, string>
  ) ?? {};

  if (meta.tier_kind === 'web') {
    // Write stripe_customers mapping
    const { error: cusErr } = await admin.from('stripe_customers').upsert(
      { user_id: meta.user_id, stripe_customer_id: customerId },
      { onConflict: 'user_id' },
    );
    if (cusErr) {
      console.error('[stripe-webhook/checkout-completed] stripe_customers upsert', cusErr.message);
    }

    // Upsert subscriptions row with ux_tier='paid' (Pitfall 8 — grant on checkout, not invoice)
    const { error: subErr } = await admin.from('subscriptions').upsert(
      {
        id: subId,
        provider: 'stripe',
        user_id: meta.user_id,
        clinic_id: null,
        stripe_customer_id: customerId,
        status: 'trialing',
        ux_tier: 'paid',
        plan_id: session.line_items?.data?.[0]?.price?.id ?? null,
        current_period_end: null,
        trial_end: null,
        cancel_at_period_end: false,
        metadata: { provider: 'stripe', tier_kind: 'web' },
      },
      { onConflict: 'id' },
    );
    if (subErr) {
      console.error('[stripe-webhook/checkout-completed] subscriptions upsert', subErr.message);
      throw new Error('subscriptions-upsert-failed');
    }
  } else if (meta.tier_kind === 'lifetime') {
    // P43 Plan 01 — Lifetime tier (D-02): one-time Checkout payment, idempotent upsert
    // keyed by stripe_payment_intent_id. NO subscription row is written — tier_effective
    // joins lifetime_purchases via UNION ALL.
    const paymentIntentId = session.payment_intent as string;
    const amountTotal = session.amount_total ?? 0;

    const { error: lpErr } = await admin.from('lifetime_purchases').upsert(
      {
        user_id: meta.user_id,
        stripe_payment_intent_id: paymentIntentId,
        stripe_customer_id: customerId,
        paid_at: new Date().toISOString(),
        amount_cents: amountTotal,
        metadata: { stripe_session_id: session.id },
      },
      { onConflict: 'stripe_payment_intent_id', ignoreDuplicates: true },
    );
    if (lpErr) {
      console.error(
        '[stripe-webhook/checkout-completed] lifetime_purchases upsert',
        lpErr.message,
      );
      throw new Error('lifetime-purchases-upsert-failed');
    }

    // Non-blocking Slack alert to #growth-experiments (CONTEXT specifics line 118 +
    // 43-RESEARCH.md Pattern 4 + Pitfall 11). Wrapped in EdgeRuntime.waitUntil so the
    // webhook 200s back to Stripe regardless of Slack availability. Threat T-43-01-06.
    try {
      const slackUrl = Deno.env.get('SLACK_WEBHOOK_EXPERIMENTS_URL') ?? '';
      if (slackUrl) {
        const dispatch = fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text:
              `💎 New Lifetime purchase: user=${meta.user_id} amount=$${(amountTotal / 100).toFixed(2)}`,
          }),
        }).catch((e) => console.error('[slack-alert/lifetime]', e));
        // EdgeRuntime is only present in the Supabase Edge runtime; guard for Deno-test contexts.
        const edgeRuntime = (globalThis as {
          EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
        }).EdgeRuntime;
        edgeRuntime?.waitUntil?.(dispatch);
      }
    } catch (e) {
      console.error('[slack-alert/lifetime] dispatch failed', e);
    }
  } else if (meta.tier_kind === 'clinic') {
    // Write clinic_stripe_customers mapping
    const { error: cusErr } = await admin.from('clinic_stripe_customers').upsert(
      { clinic_id: meta.clinic_id, stripe_customer_id: customerId },
      { onConflict: 'clinic_id' },
    );
    if (cusErr) {
      console.error(
        '[stripe-webhook/checkout-completed] clinic_stripe_customers upsert',
        cusErr.message,
      );
    }

    // Upsert subscriptions row for clinic
    const { error: subErr } = await admin.from('subscriptions').upsert(
      {
        id: subId,
        provider: 'stripe',
        user_id: null,
        clinic_id: meta.clinic_id,
        stripe_customer_id: customerId,
        status: 'trialing',
        ux_tier: 'paid',
        plan_id: null,
        current_period_end: null,
        trial_end: null,
        cancel_at_period_end: false,
        metadata: { provider: 'stripe', tier_kind: 'clinic' },
      },
      { onConflict: 'id' },
    );
    if (subErr) {
      console.error(
        '[stripe-webhook/checkout-completed] clinic subscriptions upsert',
        subErr.message,
      );
      throw new Error('clinic-subscriptions-upsert-failed');
    }
  } else {
    // Missing metadata.tier_kind — integration bug in plan 14-04's Checkout session creation.
    // Return error so dispatcher returns 500 and Stripe retries until 14-04 fixes its wiring.
    throw new Error(
      `metadata-missing: tier_kind not in {web,clinic,lifetime} for session ${session.id}`,
    );
  }

  // ─── Phase 65-04 — PAY-03: clinic tax_id mirror to public.subscriptions ───
  //
  // Stripe Tax `tax_id_collection` populates session.customer_tax_ids on B2B
  // checkouts. We mirror the FIRST collected value into public.subscriptions.tax_id
  // keyed by the Stripe subscription id (session.subscription — text). The row's
  // clinic_id IS NOT NULL distinguishes it from consumer subs (Phase 14 +
  // Phase 29 D-14 — Phase 65.1 rewrite replaced the prior dropped-table target).
  //
  // PII guard (T-65-04-02): only log `tax_id_set: true/false`, NEVER the value.
  try {
    if (meta.tier_kind === 'clinic') {
      const customerTaxIds = (session as unknown as Record<string, unknown>).customer_tax_ids as
        | Array<{ type?: string; value?: string }>
        | undefined
        | null;
      if (customerTaxIds && customerTaxIds.length > 0) {
        const firstTaxId = customerTaxIds[0];
        const clinicId = meta.clinic_id;
        if (clinicId && firstTaxId?.value && subId) {
          const { error: taxIdErr } = await admin
            .from('subscriptions')
            .update({ tax_id: firstTaxId.value })
            .eq('id', subId);
          if (taxIdErr) {
            console.error(
              '[stripe-webhook/checkout-completed] subscriptions.tax_id update error',
              JSON.stringify({
                subscription_id: subId,
                clinic_id: clinicId,
                tax_id_set: false,
                error_message: taxIdErr.message,
                error_code: taxIdErr.code,
              }),
            );
            // Non-fatal: subscription mapping already succeeded.
          } else {
            console.log(
              '[stripe-webhook/checkout-completed] tax_id mirrored',
              JSON.stringify({
                subscription_id: subId,
                clinic_id: clinicId,
                tax_id_set: true,
                tax_id_type: firstTaxId.type ?? null,
              }),
            );
          }
        } else if (!clinicId) {
          console.warn(
            '[stripe-webhook/checkout-completed] tax_id collected but no clinic_id in metadata — skipping mirror',
          );
        } else if (!subId) {
          console.warn(
            '[stripe-webhook/checkout-completed] tax_id collected but no subscription_id on session — skipping mirror',
          );
        }
      }
    }
  } catch (taxIdErr) {
    console.error(
      '[stripe-webhook/checkout-completed] tax_id mirror failed',
      taxIdErr instanceof Error ? taxIdErr.message : 'unknown',
    );
    // Audit/mirror failures MUST NOT fail the webhook (T-65-04-04).
  }

  // ─── Phase 65-04 — PAY-01: tax_collection_log audit ─────────────────────
  //
  // writeTaxCollectionLog internally gates on session.automatic_tax?.status,
  // so calling unconditionally is safe (no-op on non-Stripe-Tax sessions).
  // Wrap in try/catch — audit failures MUST NOT fail the webhook
  // (T-65-04-04: accept disposition; subscription_events PK upstream is the
  // primary idempotency gate).
  try {
    await writeTaxCollectionLog(admin, session);
  } catch (logErr) {
    console.error(
      '[stripe-webhook/checkout-completed] tax_collection_log write failed',
      logErr instanceof Error ? logErr.message : 'unknown',
    );
    // Do NOT re-throw — audit best-effort.
  }
}
