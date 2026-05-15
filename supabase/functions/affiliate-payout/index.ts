/**
 * `affiliate-payout` Edge Function — Phase 19 Plan 19-09 (AFF-06).
 *
 * Monthly cron-invoked Edge Function (1st of month, 00:00 UTC) that walks
 * eligible pending payouts and calls `stripe.transfers.create` per affiliate.
 *
 *   POST /functions/v1/affiliate-payout    (verify_jwt = true — service-role-only)
 *
 * Invariants (locked by plan-checker iter-2):
 *   1. Constant-time bearer compare against SUPABASE_SERVICE_ROLE_KEY (V2).
 *      The bearer is sourced by pg_cron from vault.decrypted_secrets (BL-7).
 *   2. `stripe.transfers.create` (NOT `stripe.payouts.create`) with an
 *      idempotency key shaped `affiliate_payout_<payout_id>` (D-32).
 *   3. Stripe pin: `https://esm.sh/stripe@19?target=denonext` (W-2 lock —
 *      Phase 14 + Plan 19-04 already pinned at v19).
 *   4. Pitfall 7: `affiliates.stripe_payouts_enabled === false` →
 *      `status = 'blocked_onboarding'`, transfers.create NOT called.
 *   5. D-31 W-9 threshold: cumulative paid + this amount < tax_threshold_cents
 *      → status STAYS 'pending', transfers.create NOT called.
 *   6. D-30 60-day chargeback hold: the W-3 materialization (migration
 *      20270101000011) already enforces this via the `not exists` clause on
 *      paid/processing payouts within the last 60 days. This function does
 *      NOT re-check — it trusts the materialized payouts row.
 *   7. On Stripe error → `incrementPayoutRetry`; row stays 'pending' until
 *      retry_count reaches 3, then status='failed' + admin alert (D-32).
 *   8. PII safety (Pattern S3): never echo Stripe error messages — log a
 *      stable string + a truncated hash of the message into payouts.failed_reason.
 *
 * Test seam:
 *   `__internal.setAdminForTest(fake)` overrides the admin client.
 *   `__internal.setStripeForTest(stub)` overrides the Stripe client.
 */
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { incrementPayoutRetry } from './retry.ts';

// Lazy env reads — at construction time, not import time. Module-level
// const reads would capture '' for any var set after import (the Deno test
// suite sets env vars after the import statement).
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

// Lazy admin singleton — same rationale as Stripe above. supabase-js
// validates supabaseUrl at construction time; if the import happens before
// Deno.env.set in tests, eager init throws.
let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
// Proxy reads _adminInstance lazily so __setAdminForTest works after import.
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
// Eligibility types (shape returned from the JOIN query below)
// ============================================================================

interface EligiblePayoutRow {
  id: string;
  affiliate_id: string;
  amount_cents: number;
  affiliates: {
    stripe_connect_account_id: string | null;
    stripe_payouts_enabled: boolean | null;
    tax_threshold_cents: number;
  } | null;
}

interface RunResult {
  processed: number;
  paid: number;
  failed: number;
  blocked: number;
  threshold_held: number;
  retried: number;
}

// ============================================================================
// Core handler
// ============================================================================

async function handleRun(_req: Request): Promise<Response> {
  const result: RunResult = {
    processed: 0,
    paid: 0,
    failed: 0,
    blocked: 0,
    threshold_held: 0,
    retried: 0,
  };

  // 1. Fetch eligible payouts (status='pending', eligible_at elapsed).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: payouts, error: selErr } = (await (admin
    .from('payouts')
    .select(
      'id, affiliate_id, amount_cents, affiliates!inner(stripe_connect_account_id, stripe_payouts_enabled, tax_threshold_cents)',
    )
    .eq('status', 'pending')
    .lt('eligible_at', new Date().toISOString()) as any)) as {
    data: EligiblePayoutRow[] | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (selErr) {
    console.error('[affiliate-payout] eligible-select failed', selErr.message ?? 'unknown');
    return jsonError(500, 'internal');
  }

  const eligible = payouts ?? [];

  for (const p of eligible) {
    result.processed += 1;

    const aff = p.affiliates;
    if (!aff) {
      // Should be unreachable due to !inner JOIN, but guard anyway.
      console.error(`[affiliate-payout] payout ${p.id} missing affiliate row — skipping`);
      continue;
    }

    // Pitfall 7: blocked onboarding.
    if (aff.stripe_payouts_enabled !== true) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { error: blockErr } = (await (admin
        .from('payouts')
        .update({ status: 'blocked_onboarding', updated_at: new Date().toISOString() })
        .eq('id', p.id) as any)) as { error: { message?: string } | null };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (blockErr) {
        console.error('[affiliate-payout] block-update failed', blockErr.message ?? 'unknown');
      }
      result.blocked += 1;
      continue;
    }

    // D-31: cumulative-paid threshold check.
    let paidSoFar = 0;
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { data: paidRows } = (await (admin
        .from('payouts')
        .select('amount_cents')
        .eq('affiliate_id', p.affiliate_id)
        .eq('status', 'paid') as any)) as { data: Array<{ amount_cents?: number }> | null };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      paidSoFar = (paidRows ?? []).reduce((sum, r) => sum + (r.amount_cents ?? 0), 0);
    } catch (e) {
      // Fail-closed: skip this payout (don't pay below threshold if we can't verify).
      console.error(
        '[affiliate-payout] paid-so-far query failed — holding',
        e instanceof Error ? e.name : 'unknown',
      );
      result.threshold_held += 1;
      continue;
    }
    if (paidSoFar + p.amount_cents < aff.tax_threshold_cents) {
      // Below threshold — leave status='pending'. The next month's cron tick
      // will re-evaluate after fresh conversions accumulate.
      result.threshold_held += 1;
      continue;
    }

    if (!aff.stripe_connect_account_id) {
      // Edge case: payouts_enabled=true but no account id (shouldn't happen).
      result.blocked += 1;
      console.error(
        `[affiliate-payout] payout ${p.id} has payouts_enabled=true but no stripe_connect_account_id`,
      );
      continue;
    }

    // D-32: stripe.transfers.create with idempotency key.
    const idempotencyKey = `affiliate_payout_${p.id}`;
    try {
      const transfer = await getStripe().transfers.create(
        {
          amount: p.amount_cents,
          currency: 'usd',
          destination: aff.stripe_connect_account_id,
          metadata: {
            payout_id: p.id,
            affiliate_id: p.affiliate_id,
            leanshot_phase: '19',
          },
        },
        { idempotencyKey },
      );

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const { error: paidErr } = (await (admin
        .from('payouts')
        .update({
          status: 'paid',
          stripe_transfer_id: (transfer as { id?: string })?.id ?? null,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', p.id) as any)) as { error: { message?: string } | null };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (paidErr) {
        console.error('[affiliate-payout] paid-update failed', paidErr.message ?? 'unknown');
        // Stripe transfer succeeded but DB update failed — operator follow-up.
        // Don't count as failed (the transfer is durable in Stripe).
      }
      result.paid += 1;
    } catch (e) {
      // Pattern S3: log a stable string; don't echo Stripe error to client/DB raw.
      const msg = e instanceof Error ? e.message : 'unknown';
      console.error(`[affiliate-payout] transfers.create failed for ${p.id}`, msg);
      const retry = await incrementPayoutRetry(admin, p.id, msg);
      result.retried += 1;
      if (retry.promoted_to_failed) result.failed += 1;
    }
  }

  return jsonResponse(200, { ok: true, ...result });
}

// ============================================================================
// Dispatcher
// ============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // 1. Bearer auth (constant-time compare against SERVICE_ROLE_KEY).
  const bearer = bearerFromReq(req);
  const expected = getSupabaseServiceRoleKey();
  if (!bearer || !expected) {
    return jsonError(401, 'unauthorized');
  }
  if (!constantTimeEqual(bearer, expected)) {
    return jsonError(401, 'unauthorized');
  }

  try {
    return await handleRun(req);
  } catch (e) {
    console.error('[affiliate-payout] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// ============================================================================
// Test seam
// ============================================================================

export const __internal = {
  handleRun,
  constantTimeEqual,
  bearerFromReq,
  setAdminForTest(client: unknown): void {
    _adminInstance = client as SupabaseClient;
  },
  setStripeForTest(stub: unknown): void {
    _stripeInstance = stub;
  },
};
