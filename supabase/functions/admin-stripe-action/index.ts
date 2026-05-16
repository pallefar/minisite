/**
 * `admin-stripe-action` Edge Function — Phase 22 Plan 22-03 (ADMIN-04 / D-05).
 *
 * Admin-invoked Stripe wrapper for refund / cancel / comp operations. Every
 * call writes an audit_logs row via the matching admin_log_* SECURITY DEFINER
 * RPC (migration 20270601000015_admin_stripe_action_audit_rpc.sql).
 *
 *   POST /functions/v1/admin-stripe-action    (verify_jwt = true)
 *
 * Discriminated-union body:
 *   { operation:'refund', target_user_id, charge_id, amount_cents, reason? }   → 200 {refund_id, amount_refunded}
 *   { operation:'cancel', target_user_id, subscription_id }                    → 200 {subscription_id}
 *   { operation:'comp',   target_user_id, subscription_id, comp_days }         → 200 {subscription_id, trial_end}
 *
 * Errors:
 *   403 forbidden          — caller not is_staff
 *   400 invalid_body       — discriminated union violation / invalid UUID
 *   401 unauthorized       — missing/invalid bearer
 *   502 stripe_<code>      — Stripe SDK error (SANITIZED — no raw message leak)
 *
 * Invariants:
 *   1. is_staff re-check inside fn body (gateway verify_jwt only confirms identity).
 *   2. Stripe pin: esm.sh/stripe@19?target=denonext (Phase 14 / 19 lock).
 *   3. apiVersion: '2026-04-22.dahlia' (matches affiliate-payout).
 *   4. Audit RPC fires ONLY on successful Stripe call (T-22-22 accept-and-trace
 *      pattern: don't claim audit when Stripe failed; webhook reconciliation
 *      catches the row via invoice.refunded events).
 *   5. PII safety (T-22-23): never echo Stripe error message; wrap as
 *      {error: 'stripe_<code>'}.
 *   6. Refund idempotency_key shape: `refund-<charge>-<amount_cents>` (T-22-25
 *      lock — Stripe dedupes identical args; differing amounts get different keys).
 *   7. After successful refund, invoke lifecycle-transactional with template='receipt'
 *      to notify the user (UI-SPEC line 387 contract).
 *   8. Lazy admin + Stripe singletons via Proxy (analog: affiliate-payout/index.ts:67-88).
 *
 * Test seam: `__internal.setAdminForTest`, `__internal.setStripeForTest`, `__internal.handle`.
 */
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const getStripeSecretKey = () => Deno.env.get('STRIPE_SECRET_KEY') ?? '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE_API_VERSION = '2026-04-22.dahlia';

// ============================================================================
// Lazy singletons
// ============================================================================

let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
const admin = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin() as unknown as Record<string | symbol, unknown>;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// deno-lint-ignore no-explicit-any
let _stripeInstance: any = null;
// deno-lint-ignore no-explicit-any
function getStripe(): any {
  if (_stripeInstance === null) {
    _stripeInstance = new Stripe(getStripeSecretKey(), {
      apiVersion: STRIPE_API_VERSION as Parameters<typeof Stripe>[1]['apiVersion'],
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripeInstance;
}

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

function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

interface RefundBody {
  operation: 'refund';
  target_user_id: string;
  charge_id: string;
  amount_cents: number;
  reason?: string;
}
interface CancelBody {
  operation: 'cancel';
  target_user_id: string;
  subscription_id: string;
}
interface CompBody {
  operation: 'comp';
  target_user_id: string;
  subscription_id: string;
  comp_days: number;
}
type ActionBody = RefundBody | CancelBody | CompBody;

function validateBody(raw: unknown): { ok: true; body: ActionBody } | { ok: false; err: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, err: 'invalid_body' };
  const r = raw as Record<string, unknown>;
  const op = r.operation;
  const targetId = r.target_user_id;
  if (typeof targetId !== 'string' || !UUID_RE.test(targetId)) {
    return { ok: false, err: 'invalid_target_user_id' };
  }
  if (op === 'refund') {
    const charge = r.charge_id;
    const amount = r.amount_cents;
    if (typeof charge !== 'string' || charge.length === 0) {
      return { ok: false, err: 'invalid_charge_id' };
    }
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return { ok: false, err: 'invalid_amount_cents' };
    }
    const reason = typeof r.reason === 'string' ? r.reason : undefined;
    return {
      ok: true,
      body: { operation: 'refund', target_user_id: targetId, charge_id: charge, amount_cents: amount, reason },
    };
  }
  if (op === 'cancel') {
    const sub = r.subscription_id;
    if (typeof sub !== 'string' || sub.length === 0) {
      return { ok: false, err: 'invalid_subscription_id' };
    }
    return { ok: true, body: { operation: 'cancel', target_user_id: targetId, subscription_id: sub } };
  }
  if (op === 'comp') {
    const sub = r.subscription_id;
    const days = r.comp_days;
    if (typeof sub !== 'string' || sub.length === 0) {
      return { ok: false, err: 'invalid_subscription_id' };
    }
    if (typeof days !== 'number' || !Number.isInteger(days) || days <= 0) {
      return { ok: false, err: 'invalid_comp_days' };
    }
    return {
      ok: true,
      body: { operation: 'comp', target_user_id: targetId, subscription_id: sub, comp_days: days },
    };
  }
  return { ok: false, err: 'invalid_operation' };
}

/** Extract Stripe error .code; fall back to a generic tag. Never use .message. */
function stripeErrorCode(e: unknown): string {
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[a-z_][a-z0-9_]*$/i.test(code)) {
      return code;
    }
    const type = (e as { type?: unknown }).type;
    if (typeof type === 'string' && /^[a-z_][a-z0-9_]*$/i.test(type)) {
      return type;
    }
  }
  return 'unknown_error';
}

// ============================================================================
// Core handler
// ============================================================================

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // 1. Body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const v = validateBody(raw);
  if (!v.ok) return jsonError(400, v.err);
  const body = v.body;

  // 2. Caller identity from bearer
  const bearer = bearerFromReq(req);
  if (!bearer) return jsonError(401, 'unauthorized');
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: callerData, error: callerErr } = (await (admin as any).auth.getUser(bearer)) as {
    data: { user: { id: string } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (callerErr || !callerData?.user) return jsonError(401, 'unauthorized');
  const callerId = callerData.user.id;

  // 3. is_staff gate
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: profile, error: profErr } = (await (admin as any)
    .from('profiles')
    .select('is_staff')
    .eq('id', callerId)
    .single()) as {
    data: { is_staff?: boolean } | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (profErr || !profile?.is_staff) return jsonError(403, 'forbidden');

  // 4. Dispatch
  if (body.operation === 'refund') return await handleRefund(callerId, body);
  if (body.operation === 'cancel') return await handleCancel(body);
  return await handleComp(body);
}

async function handleRefund(callerId: string, body: RefundBody): Promise<Response> {
  const idempotencyKey = `refund-${body.charge_id}-${body.amount_cents}`;
  let refund: { id?: string; amount?: number };
  try {
    refund = await getStripe().refunds.create(
      {
        charge: body.charge_id,
        amount: body.amount_cents,
        reason: 'requested_by_customer',
        metadata: { admin_id: callerId, target_user_id: body.target_user_id },
      },
      { idempotencyKey },
    );
  } catch (e) {
    const code = stripeErrorCode(e);
    console.error('[admin-stripe-action] refunds.create failed', code);
    return jsonError(502, `stripe_${code}`);
  }

  // Audit row via SECURITY DEFINER RPC (sets app.suppress_audit internally per migration 15)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: rpcErr } = (await (admin as any).rpc('admin_log_refund', {
    p_target_user_id: body.target_user_id,
    p_charge_id: body.charge_id,
    p_amount_cents: body.amount_cents,
    p_reason: body.reason ?? null,
  })) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (rpcErr) {
    // T-22-22: accept-and-trace. Refund went through; audit-write failure is logged.
    console.error('[admin-stripe-action] admin_log_refund failed', rpcErr.message ?? 'unknown');
  }

  // Receipt email (UI-SPEC line 387). Best-effort — don't fail the refund if email errors.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (admin as any).functions.invoke('lifecycle-transactional', {
      body: {
        template: 'receipt',
        user_id: body.target_user_id,
        data: {
          refund_id: refund.id ?? null,
          amount_cents: body.amount_cents,
        },
      },
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch (e) {
    console.error('[admin-stripe-action] receipt invoke failed', e instanceof Error ? e.name : 'unknown');
  }

  return jsonResponse(200, {
    refund_id: refund.id ?? null,
    amount_refunded: refund.amount ?? body.amount_cents,
  });
}

async function handleCancel(body: CancelBody): Promise<Response> {
  let sub: { id?: string };
  try {
    sub = await getStripe().subscriptions.update(body.subscription_id, {
      cancel_at_period_end: true,
    });
  } catch (e) {
    const code = stripeErrorCode(e);
    console.error('[admin-stripe-action] subscriptions.update(cancel) failed', code);
    return jsonError(502, `stripe_${code}`);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: rpcErr } = (await (admin as any).rpc('admin_log_subscription_canceled', {
    p_target_user_id: body.target_user_id,
    p_subscription_id: body.subscription_id,
  })) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (rpcErr) {
    console.error(
      '[admin-stripe-action] admin_log_subscription_canceled failed',
      rpcErr.message ?? 'unknown',
    );
  }

  return jsonResponse(200, { subscription_id: sub.id ?? body.subscription_id });
}

async function handleComp(body: CompBody): Promise<Response> {
  const trialEndUnix = Math.floor(Date.now() / 1000) + body.comp_days * 86400;
  let sub: { id?: string };
  try {
    sub = await getStripe().subscriptions.update(body.subscription_id, {
      trial_end: trialEndUnix,
      proration_behavior: 'none',
    });
  } catch (e) {
    const code = stripeErrorCode(e);
    console.error('[admin-stripe-action] subscriptions.update(comp) failed', code);
    return jsonError(502, `stripe_${code}`);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: rpcErr } = (await (admin as any).rpc('admin_log_subscription_comped', {
    p_target_user_id: body.target_user_id,
    p_subscription_id: body.subscription_id,
    p_trial_end: new Date(trialEndUnix * 1000).toISOString(),
  })) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (rpcErr) {
    console.error(
      '[admin-stripe-action] admin_log_subscription_comped failed',
      rpcErr.message ?? 'unknown',
    );
  }

  return jsonResponse(200, {
    subscription_id: sub.id ?? body.subscription_id,
    trial_end: trialEndUnix,
  });
}

// ============================================================================
// Dispatcher
// ============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('[admin-stripe-action] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// ============================================================================
// Test seam
// ============================================================================

export const __internal = {
  handle,
  validateBody,
  stripeErrorCode,
  setAdminForTest(client: unknown): void {
    _adminInstance = client as SupabaseClient;
  },
  setStripeForTest(stub: unknown): void {
    _stripeInstance = stub;
  },
};
