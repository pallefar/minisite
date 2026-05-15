/**
 * `stripe-connect-onboard` Edge Function — Phase 19 Plan 19-03.
 *
 * Single POST endpoint that:
 *   1. Authenticates the caller via Bearer JWT (verify_jwt=true in config.toml).
 *   2. Looks up the affiliate row for `user_id = auth.uid()` and refuses if not
 *      approved (D-25: only `status='approved'` affiliates onboard to Stripe).
 *   3. Creates a Stripe Connect Express account (capabilities.transfers.requested
 *      = true; D-37 #2 — load-bearing for Plan 19-09 cron transfers.create) if
 *      the affiliate doesn't already have one.
 *   4. ALWAYS mints a fresh `accountLinks.create({ type: 'account_onboarding' })`
 *      URL and returns `{ url }`.
 *
 * Why JIT URL generation (RESEARCH Pitfall 6):
 *   Stripe `account_link.url`s are single-use AND expire after 5 minutes. If we
 *   cached the URL on the affiliate row, the next dashboard mount would surface
 *   a stale link that either errors out or — worse — looks valid until clicked.
 *   We mint on every call and never persist.
 *
 * Privacy / V7:
 *   - Response body is strictly `{ url }`. Stripe error messages NEVER leak
 *     into 5xx responses (Pattern S3): the catch block returns `{ error:
 *     'internal' }` and logs `err.message` to console.error (Edge Function logs
 *     are project-internal in Supabase).
 *   - `metadata.affiliate_id` and `leanshot_user_id` go on the Stripe account
 *     so we can reconcile webhook events (account.updated) by either FK.
 *
 * Idempotency:
 *   - If `affiliates.stripe_connect_account_id` is already set, `accounts.create`
 *     is NOT called again. We only mint a new `accountLinks.create` URL. This
 *     means the partner-dashboard card can "Resume onboarding" any number of
 *     times without spawning duplicate Connect accounts.
 *
 * Stripe SDK: pinned to v19, API version 2026-04-22.dahlia (matches Phase 14
 * stripe-checkout + stripe-webhook to keep one API version per project).
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

// =============================================================================
// Environment helpers (lazy reads — resolved at handler call time, not import)
// =============================================================================

function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}

const getSupabaseUrl = () => env('SUPABASE_URL');
const getSupabaseServiceRoleKey = () => env('SUPABASE_SERVICE_ROLE_KEY');
const getStripeSecretKey = () => env('STRIPE_SECRET_KEY');
const getConnectReturnUrl = () => env('STRIPE_CONNECT_RETURN_URL', 'https://leanshot.app');
const getConnectRefreshUrl = () => env('STRIPE_CONNECT_REFRESH_URL', 'https://leanshot.app');

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
// Handler
// =============================================================================

export async function handleOnboard(req: Request): Promise<Response> {
  // 1. JWT auth
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user;

  // 2. Look up affiliate
  // deno-lint-ignore no-explicit-any
  const { data: aff, error: affErr } = await (adminInstance.from('affiliates')
    .select('id, status, stripe_connect_account_id')
    .eq('user_id', user.id)
    .limit(1) as any).maybeSingle();

  if (affErr) {
    console.error('[stripe-connect-onboard] affiliates select failed', affErr.message);
    return jsonError(500, 'internal');
  }
  if (!aff) return jsonError(404, 'not_an_affiliate');
  if (aff.status !== 'approved') return jsonError(403, 'not_approved');

  // 3. Create Connect account if needed (idempotent on stripe_connect_account_id)
  let accountId: string | null = aff.stripe_connect_account_id ?? null;

  if (!accountId) {
    try {
      const acct = await stripeInstance.accounts.create({
        type: 'express',
        country: 'US',
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: {
          affiliate_id: aff.id,
          leanshot_user_id: user.id,
          leanshot_phase: '19',
        },
      });
      accountId = acct.id as string;
    } catch (err) {
      console.error(
        '[stripe-connect-onboard] accounts.create failed',
        err instanceof Error ? err.message : 'unknown',
      );
      return jsonError(500, 'internal');
    }

    // Persist account id on affiliate row.
    // deno-lint-ignore no-explicit-any
    const { error: updErr } = await (adminInstance.from('affiliates')
      .update({ stripe_connect_account_id: accountId })
      .eq('id', aff.id) as any);

    if (updErr) {
      console.error('[stripe-connect-onboard] affiliates update failed', updErr.message);
      // Don't fail the call — the account exists in Stripe; we'll just retry the
      // DB write next time the affiliate clicks Resume. Returning 500 here would
      // leave a dangling Stripe account with no DB pointer (worse outcome).
    }
  }

  // 4. ALWAYS mint a fresh account link (Pitfall 6 — never persist URL).
  let url: string;
  try {
    const link = await stripeInstance.accountLinks.create({
      account: accountId,
      refresh_url: `${getConnectRefreshUrl()}/partner/payouts?refresh=1`,
      return_url: `${getConnectReturnUrl()}/partner/payouts?from=connect`,
      type: 'account_onboarding',
    });
    url = link.url as string;
  } catch (err) {
    console.error(
      '[stripe-connect-onboard] accountLinks.create failed',
      err instanceof Error ? err.message : 'unknown',
    );
    return jsonError(500, 'internal');
  }

  // V7: response body is strictly `{ url }` — no account id, no Stripe details.
  return jsonResponse(200, { url });
}

// =============================================================================
// Dispatcher
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  try {
    return await handleOnboard(req);
  } catch (e) {
    console.error('[stripe-connect-onboard] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================
export const __internal = {
  handleOnboard,
  __setStripeForTest,
  __setAdminForTest,
};
