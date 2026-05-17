/**
 * org-metered-billing-cron Edge Function — Phase 29 Plan 29-04 (ORG-09)
 *
 * Invoked nightly by pg_cron at 02:00 UTC.
 * Loops over all clinic_stripe_customers rows with a non-null stripe_customer_id,
 * calls count_active_patients() per org (SECDEF — safe for service_role with no JWT),
 * and POSTs a Stripe Meter Event with:
 *   - event_name: 'active_patient_month'
 *   - payload.value: String(count)           — MUST be string (Pitfall 3)
 *   - payload.stripe_customer_id: <clinic>
 *   - identifier: `org_${clinic_id}_${yyyymm}` — D-03 idempotency key
 *
 * Security:
 *   T-29-04-01: payload contains ONLY value + stripe_customer_id (D-11 PHI lint).
 *   T-29-04-02: identifier deduplicates within Stripe's rolling 24h window.
 *   T-29-04-05: cron uses service_role bearer only; no public JWT accepted.
 *
 * Vendor-gated health check ([[reference_vendor_gated_send_health_check]]):
 *   If STRIPE_SECRET_KEY is missing → return 503, no crash.
 *
 * ESLint no-raw-service-role-client:
 *   Uses _createServiceRoleClientUnsafe from _shared/supabase-server.ts.
 *   Never calls createClient directly.
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { _createServiceRoleClientUnsafe } from '../_shared/supabase-server.ts';
import * as Sentry from '../_shared/sentry.ts';

const EVENT_NAME = 'active_patient_month';

// ── Startup health check ([[reference_vendor_gated_send_health_check]]) ──────────
// Warn at module load time so Sentry / logs capture the misconfiguration
// even before a request arrives.
if (!Deno.env.get('STRIPE_SECRET_KEY')) {
  console.warn('[org-metered-billing-cron] STRIPE_SECRET_KEY missing — cron will no-op with 503');
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

/**
 * Format a Date as YYYYMM (zero-padded month).
 * Uses UTC parts so result is consistent regardless of server timezone.
 */
export function yyyymm(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/**
 * Build the Stripe Meter Event payload for a single org.
 *
 * Exported for unit-test consumption (tests drive this directly without Deno.serve).
 *
 * D-11 enforcement: payload contains ONLY `value` + `stripe_customer_id`.
 * Pitfall 3: value MUST be a string — Stripe returns 400 on integer.
 * D-03: identifier is `org_${clinicId}_${yyyymm}` for monthly idempotency.
 */
export function buildMeterEventPayload(
  clinicId: string,
  count: number,
  stripeCustomerId: string,
  now: Date = new Date(),
): {
  event_name: string;
  payload: { value: string; stripe_customer_id: string };
  identifier: string;
} {
  return {
    event_name: EVENT_NAME,
    payload: {
      value: String(count), // Pitfall 3 — MUST be string, not integer
      stripe_customer_id: stripeCustomerId,
      // D-11: NO patient_email, patient_id, diagnosis, dose, mg, mcg, hba1c
    },
    identifier: `org_${clinicId}_${yyyymm(now)}`, // D-03 idempotency
  };
}

/**
 * Run the metered billing loop for the given org list.
 *
 * Exported for unit-test consumption.
 *
 * Per-org try/catch ensures one failing Stripe call does not abort
 * the rest of the batch (RESEARCH §Pattern 4 sequential-loop strategy).
 * Sentry.captureException is called per failure but loop continues.
 */
export async function runForOrgs(opts: {
  stripe: Stripe;
  // deno-lint-ignore no-explicit-any
  admin: any;
  orgs: Array<{ clinic_id: string; stripe_customer_id: string }>;
  now?: Date;
}): Promise<Array<{ clinic_id: string; ok: boolean; error?: string }>> {
  const results: Array<{ clinic_id: string; ok: boolean; error?: string }> = [];

  for (const org of opts.orgs) {
    try {
      const { data: count, error } = await opts.admin.rpc('count_active_patients', {
        p_org_id: org.clinic_id,
      });
      if (error) throw error;

      const payload = buildMeterEventPayload(
        org.clinic_id,
        Number(count ?? 0),
        org.stripe_customer_id,
        opts.now,
      );

      await opts.stripe.billing.meterEvents.create(payload);
      results.push({ clinic_id: org.clinic_id, ok: true });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { cron: 'org-metered-billing', clinic_id: org.clinic_id },
      });
      results.push({
        clinic_id: org.clinic_id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      // continue loop — per-org isolation; one failure does not abort the batch
    }
  }

  return results;
}

// ── Entry point ────────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  // Vendor-gated health check: if Stripe key is missing, return 503 without crashing.
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    Sentry.captureException(new Error('STRIPE_SECRET_KEY missing in org-metered-billing-cron'), {
      tags: { cron: 'org-metered-billing', stage: 'startup_health_check' },
    });
    return new Response(JSON.stringify({ ok: false, error: 'stripe_key_missing' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
  });

  const admin = _createServiceRoleClientUnsafe();

  // Select all clinic_stripe_customers with an active Stripe customer ID.
  // Uses service_role — bypasses RLS; count_active_patients SECDEF also allows this.
  // deno-lint-ignore no-explicit-any
  const { data: orgs, error } = await (admin as any)
    .from('clinic_stripe_customers')
    .select('clinic_id, stripe_customer_id')
    .not('stripe_customer_id', 'is', null);

  if (error) {
    Sentry.captureException(error, {
      tags: { cron: 'org-metered-billing', stage: 'orgs_query' },
    });
    return new Response(JSON.stringify({ ok: false, error: 'orgs_query_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results = await runForOrgs({ stripe, admin, orgs: orgs ?? [] });
  const okCount = results.filter((r) => r.ok).length;

  return new Response(
    JSON.stringify({
      ok: true,
      processed: results.length,
      succeeded: okCount,
      failed: results.length - okCount,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
