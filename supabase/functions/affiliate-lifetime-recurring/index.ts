/**
 * `affiliate-lifetime-recurring` Edge Function — Phase 26 Plan 26-06 (AFFTIER-04).
 *
 * Monthly cron-invoked Edge Function (1st of month, 03:00 UTC) that walks every
 * lifetime-tier affiliate's still-active subscription referral and INSERTs a
 * recurring-commission row into:
 *   1. `affiliate_lifetime_recurring_payments` (idempotency anchor — D-07)
 *   2. `affiliate_conversions` (synthetic invoice_id; eligible_at = now()+60d)
 *
 *   POST /functions/v1/affiliate-lifetime-recurring  (service-role-only)
 *
 * Delegates the actual Stripe transfer-creation call to the existing v1.2
 * `affiliate-monthly-payout` cron at month N+2 (after the materialize chain).
 * This keeps a SINGLE Stripe Connect transfer path per D-08.
 *
 * Invariants (locked by plan-checker iter-2):
 *   1. Constant-time bearer compare against SUPABASE_SERVICE_ROLE_KEY (Pattern 5).
 *      Cron sources the bearer from vault.decrypted_secrets (Migration 12).
 *   2. Stripe pin: `https://esm.sh/stripe@19?target=denonext` (Pitfall 8) with
 *      explicit apiVersion '2026-04-22.dahlia'.
 *   3. Filters subscriptions on RAW Stripe status='active' (Pitfall 2) — NEVER
 *      use the UX-tier collapse column for cron decisioning.
 *   4. Skips frozen affiliates via `.is('frozen_at', null)` (D-04, D-05).
 *   5. Per-row idempotency: `(affiliate_id, stripe_subscription_id, yyyymm)` UNIQUE
 *      + synthetic invoice_id `lifetime_recurring_<aff>_<sub>_<yyyymm>`. 23505
 *      collisions on either insert are swallowed (cron retry is safe).
 *   6. Commission scales to CURRENT Stripe price × 25% (D-01) — plan-upgrades
 *      reflected in next month's accrual automatically.
 *   7. NO Stripe transfer call is invoked from this handler — delegated to the
 *      v1.2 `affiliate-monthly-payout` cron via the standard materialize chain
 *      (D-08, single Stripe Connect path).
 *   8. PII safety: this handler writes no Stripe metadata; forward CI grep
 *      gate keeps PHI keywords out of the source.
 *
 * Test seam:
 *   `__internal.setAdminForTest(fake)` overrides the admin client.
 *   `__internal.setStripeForTest(stub)` overrides the Stripe client.
 *   `__internal.resetForTest()` clears both for cross-test isolation.
 */
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Lazy env reads — at construction time, not import time. Module-level const
// reads would capture '' for any env var set after import (the Deno test suite
// sets env vars after the import statement).
const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_SECRET_KEY = () => Deno.env.get('STRIPE_SECRET_KEY') ?? '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

// ============================================================================
// Lazy singletons (test-injectable)
// ============================================================================

// deno-lint-ignore no-explicit-any
let _stripeInstance: any = null;
// deno-lint-ignore no-explicit-any
function getStripe(): any {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(STRIPE_SECRET_KEY(), {
      apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripeInstance;
}

// Lazy admin singleton + Proxy wrapper. supabase-js validates supabaseUrl at
// construction time; if eager init runs before Deno.env.set in tests, it throws.
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
// Proxy reads _adminInstance lazily so __internal.setAdminForTest works after import.
const admin = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin() as unknown as Record<string | symbol, unknown>;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// ============================================================================
// Helpers
// ============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

/** Constant-time string compare — same length AND same bytes. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ============================================================================
// Domain handler — Task 2 (AFFTIER-04 monthly recurring accrual)
// ============================================================================

interface RunResult {
  processed: number;
  skipped: number;
  errors: number;
}

/**
 * Driver-query shape: query subscriptions (with a literal status='active' filter
 * so the cron decisions on the RAW Stripe value per Pitfall 2), then embed INTO
 * affiliate_conversions + affiliates.
 *
 * Embed direction:
 *   subscriptions ← (referenced by) ← affiliate_conversions.subscription_id
 *   affiliate_conversions.affiliate_id → affiliates(id)
 *
 * Filters applied at the subscriptions level keep them as literal `eq('status',
 * 'active')` call so CI grep gates (success criterion #2) see the canonical
 * raw-Stripe-value usage.
 */
interface SubDriverRow {
  id: string;
  plan_id: string | null;
  status: string;
  affiliate_conversions: Array<{
    id: string;
    affiliate_id: string;
    tier_at_conversion_time: string;
    affiliates: { id: string; frozen_at: string | null } | null;
  }>;
}

async function processLifetimeRecurring(): Promise<RunResult> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // 1. Driver query: subscriptions filtered on the RAW Stripe value, embedded
  //    affiliate_conversions filtered to lifetime tier, embedded affiliates
  //    filtered to non-frozen. Per-embed filters use PostgREST `embed.col`
  //    syntax so the JOIN cardinality drops at the database (not the handler).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: subs, error: queryErr } = (await (admin
    .from('subscriptions')
    .select(
      'id, plan_id, status, ' +
        'affiliate_conversions!inner ( ' +
        '  id, affiliate_id, tier_at_conversion_time, ' +
        '  affiliates!inner ( id, frozen_at ) ' +
        ')',
    )
    .eq('status', 'active')
    .eq('affiliate_conversions.tier_at_conversion_time', 'lifetime')
    .is('affiliate_conversions.affiliates.frozen_at', null) as any)) as {
    data: SubDriverRow[] | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (queryErr) {
    console.error(
      '[affiliate-lifetime-recurring] lifetime-driver-select failed',
      queryErr.message ?? 'unknown',
    );
    return { processed: 0, skipped: 0, errors: 1 };
  }

  const now = new Date();
  const yyyymm = now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1); // e.g. 202707
  const eligibleAt = new Date(now.getTime() + 60 * 86400000).toISOString(); // D-06 60-day chargeback hold

  // Dedup at handler level: a single subscription may have multiple historical
  // conversion rows (renewals from earlier plans). Anchor on (affiliate_id, sub.id).
  const seen = new Set<string>();

  for (const sub of subs ?? []) {
    // 2. Compute commission from current Stripe price (D-01 — plan-change scaling).
    //    sub.plan_id is the snapshot kept in sync by Stripe-webhook handlers.
    //    A live stripe.subscriptions.retrieve is avoided per-row (Stripe rate-limit risk).
    if (!sub.plan_id) {
      skipped += 1;
      continue;
    }

    let grossCents = 0;
    try {
      const price = await getStripe().prices.retrieve(sub.plan_id);
      grossCents = price?.unit_amount ?? 0;
    } catch (e) {
      console.error(
        '[affiliate-lifetime-recurring] price-retrieve failed',
        e instanceof Error ? e.message : 'unknown',
      );
      errors += 1;
      continue;
    }
    if (grossCents <= 0) {
      skipped += 1;
      continue;
    }

    const commissionCents = Math.round(grossCents * 0.25); // D-01 lifetime rate

    // Walk every eligible conversion row attached to this subscription. The
    // embed array MAY contain multiple rows for one (aff,sub) pair (historical
    // accruals); we dedup on (affiliate_id, sub.id) so only the first attempt
    // writes a ledger row this cycle.
    for (const conv of sub.affiliate_conversions ?? []) {
      const dedupKey = `${conv.affiliate_id}|${sub.id}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      try {
        const idemKey = `${conv.affiliate_id}|${sub.id}|${yyyymm}`;

        // 3. INSERT ledger row — UNIQUE (idempotency_key) swallows cron retries (D-07).
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const { error: ledgerErr } = (await (admin
          .from('affiliate_lifetime_recurring_payments')
          .insert({
            affiliate_id: conv.affiliate_id,
            stripe_subscription_id: sub.id,
            billing_period_yyyymm: yyyymm,
            gross_subscription_cents: grossCents,
            commission_cents: commissionCents,
            idempotency_key: idemKey,
          }) as any)) as { error: { code?: string; message?: string } | null };
        /* eslint-enable @typescript-eslint/no-explicit-any */

        if (ledgerErr) {
          if (ledgerErr.code === '23505') {
            // Already accrued this period — cron retry. No-op, no second insert.
            skipped += 1;
            continue;
          }
          console.error(
            '[affiliate-lifetime-recurring] ledger-insert failed',
            ledgerErr.message ?? 'unknown',
          );
          errors += 1;
          continue;
        }

        // 4. INSERT affiliate_conversions row. The Plan 26-01 BEFORE INSERT trigger
        //    re-stamps NEW.tier_at_conversion_time from the current affiliate.tier
        //    (still 'lifetime'); we set only the columns the trigger does not own.
        const invoiceId = `lifetime_recurring_${conv.affiliate_id}_${sub.id}_${yyyymm}`;
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const { error: convErr } = (await (admin
          .from('affiliate_conversions')
          .insert({
            affiliate_id: conv.affiliate_id,
            subscription_id: sub.id,
            invoice_id: invoiceId,
            commission_cents: commissionCents,
            status: 'pending',
            eligible_at: eligibleAt,
          }) as any)) as { error: { code?: string; message?: string } | null };
        /* eslint-enable @typescript-eslint/no-explicit-any */

        if (convErr) {
          if (convErr.code === '23505') {
            // invoice_id collision — cron retry. Ledger already wrote (above).
            // Net effect is identical-to-success; count as processed.
            processed += 1;
            continue;
          }
          console.error(
            '[affiliate-lifetime-recurring] conv-insert failed',
            convErr.message ?? 'unknown',
          );
          errors += 1;
          continue;
        }

        processed += 1;
      } catch (e) {
        console.error(
          '[affiliate-lifetime-recurring] row-error',
          e instanceof Error ? e.message : 'unknown',
        );
        errors += 1;
      }
    }
  }

  return { processed, skipped, errors };
}

// ============================================================================
// Core handler
// ============================================================================

export async function handleRun(req: Request): Promise<Response> {
  const bearer = bearerFromReq(req);
  const expected = getSupabaseServiceRoleKey();
  if (!bearer || !expected) {
    return jsonError(401, 'unauthorized');
  }
  if (!constantTimeEqual(bearer, expected)) {
    return jsonError(401, 'unauthorized');
  }

  try {
    const result = await processLifetimeRecurring();
    return jsonResponse(200, { ok: true, ...result });
  } catch (e) {
    console.error(
      '[affiliate-lifetime-recurring] unhandled',
      e instanceof Error ? e.message : 'unknown',
    );
    return jsonError(500, 'internal');
  }
}

// ============================================================================
// Dispatcher (production entry only — tests call handleRun directly)
// ============================================================================

if (import.meta.main) {
  Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return jsonError(405, 'method_not_allowed');
    }
    return await handleRun(req);
  });
}

// ============================================================================
// Test seam
// ============================================================================

export const __internal = {
  handleRun,
  constantTimeEqual,
  bearerFromReq,
  // Suppress access notice — used by Task 2 implementation; exported for testability.
  admin,
  getStripe,
  setAdminForTest(client: unknown): void {
    _adminInstance = client as SupabaseClient;
  },
  setStripeForTest(stub: unknown): void {
    _stripeInstance = stub;
  },
  resetForTest(): void {
    _adminInstance = null;
    _stripeInstance = null;
  },
};
