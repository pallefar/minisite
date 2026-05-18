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
 * Delegates the actual Stripe `transfers.create` call to the existing v1.2
 * `affiliate-monthly-payout` cron at month N+2 (after the materialize chain).
 * This keeps a SINGLE Stripe Connect transfer path per D-08.
 *
 * Invariants (locked by plan-checker iter-2):
 *   1. Constant-time bearer compare against SUPABASE_SERVICE_ROLE_KEY (Pattern 5).
 *      Cron sources the bearer from vault.decrypted_secrets (Migration 12).
 *   2. Stripe pin: `https://esm.sh/stripe@19?target=denonext` (Pitfall 8) with
 *      explicit `apiVersion: '2026-04-22.dahlia'`.
 *   3. Filters subscriptions on RAW Stripe `status = 'active'` (Pitfall 2 —
 *      NEVER use ux_tier collapse for cron decisioning).
 *   4. Skips frozen affiliates via `.is('affiliates.frozen_at', null)` (D-04, D-05).
 *   5. Per-row idempotency: `(affiliate_id, stripe_subscription_id, yyyymm)` UNIQUE
 *      + synthetic invoice_id `lifetime_recurring_<aff>_<sub>_<yyyymm>`. 23505
 *      collisions on either insert are swallowed (cron retry is safe).
 *   6. Commission scales to CURRENT Stripe price × 25% (D-01) — plan-upgrades
 *      reflected in next month's accrual automatically.
 *   7. NO `stripe.transfers.create` is called from this handler — delegated to
 *      the v1.2 `affiliate-monthly-payout` cron via the standard materialize
 *      chain (D-08, single Stripe Connect path).
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
// Domain stub (Task 2 fills in)
// ============================================================================

interface RunResult {
  processed: number;
  skipped: number;
  errors: number;
}

async function processLifetimeRecurring(): Promise<RunResult> {
  return await Promise.resolve({ processed: 0, skipped: 0, errors: 0 });
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
