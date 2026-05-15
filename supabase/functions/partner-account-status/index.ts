/**
 * `partner-account-status` Edge Function — Phase 19 Plan 19-03.
 *
 * Single GET endpoint that:
 *   1. Authenticates the caller via Bearer JWT (verify_jwt=true in config.toml).
 *   2. Looks up the affiliate row for `user_id = auth.uid()`.
 *   3. If no affiliate or no `stripe_connect_account_id` → returns
 *      `{ state: 'pending', requirements: [], disabled_reason: null }`
 *      (the partner dashboard treats this as "click Connect to start").
 *   4. Otherwise calls `stripe.accounts.retrieve(stripe_connect_account_id)`
 *      and derives a 4-state machine per UI-SPEC §"Stripe Connect Onboarding
 *      Card — State Machine":
 *
 *        - requirements.disabled_reason set         → 'restricted'
 *        - charges_enabled && payouts_enabled       → 'active'
 *        - currently_due.length > 0 && submitted    → 'needs_info'
 *        - else                                     → 'pending'
 *
 *   5. Mirrors `acct.payouts_enabled` onto `affiliates.stripe_payouts_enabled`
 *      so Plan 19-09's cron can filter eligible affiliates without an extra
 *      Stripe roundtrip (Pitfall 7: stale local mirror is fine here because
 *      every status read refreshes it; the cron only acts on the cached value).
 *
 * Privacy / V7:
 *   - Response body returns `state`, `requirements` (the array of
 *     `currently_due` field names — already public via Stripe's hosted
 *     onboarding UI), and `disabled_reason` (a short string like
 *     'requirements.past_due' — also public). No PII; no email/SSN/DOB.
 *   - On Stripe API error we return 500 `{ error: 'internal' }` (Pattern S3).
 *
 * Stripe SDK: same v19 + 2026-04-22.dahlia pin as stripe-connect-onboard.
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

// =============================================================================
// Environment helpers (lazy reads)
// =============================================================================

function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}

const getSupabaseUrl = () => env('SUPABASE_URL');
const getSupabaseServiceRoleKey = () => env('SUPABASE_SERVICE_ROLE_KEY');
const getStripeSecretKey = () => env('STRIPE_SECRET_KEY');

// =============================================================================
// Stripe SDK (singleton + test-injectable)
// =============================================================================

// deno-lint-ignore no-explicit-any
let _stripeInstance: any = null;

// deno-lint-ignore no-explicit-any
function getStripe(): any {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(getStripeSecretKey(), {
      apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripeInstance;
}

const stripeInstance = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_target: any, prop: string | symbol): unknown {
    const s = getStripe();
    const val = s[prop];
    return typeof val === 'function' ? val.bind(s) : val;
  },
});

export function __setStripeForTest(stub: unknown): void {
  _stripeInstance = stub;
}

// =============================================================================
// Admin Supabase client (singleton + test-injectable)
// =============================================================================

// deno-lint-ignore no-explicit-any
let _adminInstance: any = null;

// deno-lint-ignore no-explicit-any
function getAdmin(): any {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

const adminInstance = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_target: any, prop: string | symbol): unknown {
    const a = getAdmin();
    const val = a[prop];
    return typeof val === 'function' ? val.bind(a) : val;
  },
});

export function __setAdminForTest(fakeAdmin: unknown): void {
  _adminInstance = fakeAdmin;
}

// =============================================================================
// Helpers
// =============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// =============================================================================
// State derivation
// =============================================================================

type ConnectState = 'pending' | 'needs_info' | 'active' | 'restricted';

interface StripeAcctSubset {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  requirements?: {
    currently_due?: string[] | null;
    disabled_reason?: string | null;
  } | null;
}

export function deriveState(acct: StripeAcctSubset): ConnectState {
  const disabledReason = acct.requirements?.disabled_reason ?? null;
  if (disabledReason) return 'restricted';

  if (acct.charges_enabled && acct.payouts_enabled) return 'active';

  const currentlyDue = acct.requirements?.currently_due ?? [];
  if (currentlyDue.length > 0 && acct.details_submitted) return 'needs_info';

  return 'pending';
}

// =============================================================================
// Handler
// =============================================================================

export async function handleStatus(req: Request): Promise<Response> {
  // 1. JWT auth
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user;

  // 2. Look up affiliate (id + connect account id)
  // deno-lint-ignore no-explicit-any
  const { data: aff, error: affErr } = await (adminInstance.from('affiliates')
    .select('id, stripe_connect_account_id')
    .eq('user_id', user.id)
    .limit(1) as any).maybeSingle();

  if (affErr) {
    console.error('[partner-account-status] affiliates select failed', affErr.message);
    return jsonError(500, 'internal');
  }

  // No affiliate row OR no Connect account yet — return pending.
  if (!aff || !aff.stripe_connect_account_id) {
    return jsonResponse(200, {
      state: 'pending' as ConnectState,
      requirements: [],
      disabled_reason: null,
    });
  }

  // 3. Retrieve Stripe account
  let acct: StripeAcctSubset & { id: string };
  try {
    acct = await stripeInstance.accounts.retrieve(aff.stripe_connect_account_id);
  } catch (err) {
    console.error(
      '[partner-account-status] accounts.retrieve failed',
      err instanceof Error ? err.message : 'unknown',
    );
    return jsonError(500, 'internal');
  }

  // 4. Derive state
  const state = deriveState(acct);

  // 5. Mirror payouts_enabled onto affiliates (Pitfall 7 — Plan 19-09 cron reads this)
  const payoutsEnabled = acct.payouts_enabled === true;
  // deno-lint-ignore no-explicit-any
  const { error: updErr } = await (adminInstance.from('affiliates')
    .update({ stripe_payouts_enabled: payoutsEnabled })
    .eq('id', aff.id) as any);

  if (updErr) {
    // Don't fail the read — the cron tolerates one stale tick.
    console.error('[partner-account-status] affiliates update failed', updErr.message);
  }

  // 6. Respond (no PII; Stripe field names + disabled_reason short string only)
  return jsonResponse(200, {
    state,
    requirements: acct.requirements?.currently_due ?? [],
    disabled_reason: acct.requirements?.disabled_reason ?? null,
  });
}

// =============================================================================
// Dispatcher
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return jsonError(405, 'method_not_allowed');
  }

  try {
    return await handleStatus(req);
  } catch (e) {
    console.error('[partner-account-status] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================
export const __internal = {
  handleStatus,
  deriveState,
  __setStripeForTest,
  __setAdminForTest,
};
