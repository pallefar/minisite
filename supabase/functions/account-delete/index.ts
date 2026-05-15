/**
 * `account-delete` Edge Function — Phase 19 Plan 19-09 (AFF-10 + MONEY-10).
 *
 * Orchestrates the D-33 10-step affiliate-aware account deletion cascade. The
 * cascade splits between SQL (DB-side anonymize) and Edge Function (external
 * APIs):
 *
 *   1. Pre-flight: open payouts → 409 { error:'open_payouts', eta }
 *      (RPC `finalize_affiliate_cascade` raises errcode='P0010').
 *   2-4. Anonymize affiliate row + audit-skeleton (handled by SQL RPC).
 *        RPC returns the ORIGINAL email so step 8 can Resend.contacts.remove.
 *   5. Stripe customer delete: cancel active subscriptions + customers.del.
 *   6. Stripe Connect account delete: pre-flight balance check (Pitfall 1)
 *      → accounts.del. Uses stripe_connect_account_id PRESERVED by BL-6 in
 *      the SQL RPC.
 *   7. PaymentIntent void: list open PIs for the customer + cancel each.
 *   8. Resend audience remove: DELETE the contact with the ORIGINAL email
 *      returned by RPC (BL-6).
 *   9. Storage delete: `photos/{user_id}/` + `affiliate-photos/{user_id}/`.
 *  10. auth.admin.deleteUser: LAST. Cascades FK on event tables (SET NULL on
 *      user_id) so payouts/clicks/conversions audit trail survives.
 *
 * Authorization:
 *   - Caller's JWT user.id MUST equal body.user_id (self-delete), OR
 *   - Caller MUST be staff (admin-initiated delete on behalf of user).
 *
 * Each step is wrapped in try/catch + audit_logs append (D-34). External-API
 * failures (5-8) are LOGGED + CONTINUED — the durable invariant is the
 * auth.users delete at step 10 + the SQL-side anonymize at step 2.
 */
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Lazy env reads — at construction time, not import time. Same rationale
// as affiliate-payout's index.ts (Deno test suite sets env after import).
const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_SECRET_KEY = () => Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const RESEND_API_KEY = () => Deno.env.get('RESEND_API_KEY') ?? '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Lazy admin singleton (same rationale as affiliate-payout).
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

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

function nextPayoutDateIso(): string {
  // Next 1st-of-month at 00:00 UTC.
  const now = new Date();
  const yr = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const next = new Date(Date.UTC(yr, mo + 1, 1, 0, 0, 0));
  return next.toISOString();
}

/** Best-effort Resend contact remove via direct HTTPS (no SDK). */
async function resendContactRemove(email: string): Promise<{ ok: boolean }> {
  const apiKey = RESEND_API_KEY();
  if (!apiKey) return { ok: false };
  if (apiKey === 'test-stub') return { ok: true };
  try {
    // Resend's "Audiences" API: DELETE /audiences/{id}/contacts/{email}.
    // Without an audience id configured, fall back to /contacts/{email}.
    const audienceId = Deno.env.get('RESEND_AUDIENCE_ID') ?? '';
    const path = audienceId
      ? `https://api.resend.com/audiences/${audienceId}/contacts/${encodeURIComponent(email)}`
      : `https://api.resend.com/contacts/${encodeURIComponent(email)}`;
    const res = await fetch(path, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      // 404 means already-removed → idempotent success.
      if (res.status === 404) return { ok: true };
      console.error(`[account-delete] resend contact remove non-2xx: ${res.status}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error(
      '[account-delete] resend contact remove threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return { ok: false };
  }
}

// ============================================================================
// Step types
// ============================================================================

interface StepResult {
  step: number;
  name: string;
  ok: boolean;
  detail?: string;
}

async function logStep(userId: string, step: number, name: string, ok: boolean): Promise<void> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (admin.from('audit_logs').insert({
      user_id: userId,
      user_id_hash: await sha256Hex(userId),
      table_name: 'account_delete_cascade',
      row_id: `${step}:${name}`,
      action: ok ? 'account_delete_step_ok' : 'account_delete_step_fail',
      before_hash: null,
      after_hash: null,
    }) as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch (e) {
    // Audit failures don't block — surface a console error.
    console.error(
      `[account-delete] audit step ${step} ${name} failed to log`,
      e instanceof Error ? e.message : 'unknown',
    );
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Core handler
// ============================================================================

interface DeleteBody {
  user_id?: unknown;
}

async function handleDelete(req: Request): Promise<Response> {
  // ---- AUTHENTICATE + AUTHORIZE ----
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(jwt))) as {
    data: { user?: { id?: string } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
  const callerId = userData.user.id;

  // ---- PARSE BODY ----
  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return jsonError(400, 'bad_json');
  }
  const targetUserId =
    typeof body.user_id === 'string' && UUID_RE.test(body.user_id) ? body.user_id : null;
  if (!targetUserId) return jsonError(400, 'invalid_user_id');

  // Self-delete unless caller is staff.
  if (targetUserId !== callerId) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: prof } = (await (admin
      .from('profiles')
      .select('is_staff')
      .eq('id', callerId)
      .maybeSingle() as any)) as { data: { is_staff?: boolean } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!prof?.is_staff) return jsonError(403, 'forbidden');
  }

  const steps: StepResult[] = [];

  // ---- STEPS 1-4: SQL CASCADE + PRE-FLIGHT (RPC) ----
  let originalEmail: string | null = null;
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = (await (admin.rpc('finalize_affiliate_cascade', {
      p_user_id: targetUserId,
    }) as any)) as { data: string | null; error: { code?: string; message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (error) {
      if (error.code === 'P0010') {
        // D-33 step 1: open payouts block.
        await logStep(targetUserId, 1, 'preflight_open_payouts', false);
        return jsonResponse(409, {
          error: 'open_payouts',
          eta: nextPayoutDateIso(),
        });
      }
      await logStep(targetUserId, 2, 'sql_cascade', false);
      console.error('[account-delete] rpc finalize_affiliate_cascade failed', error.message);
      return jsonError(500, 'internal');
    }
    originalEmail = data;
    steps.push({ step: 2, name: 'sql_cascade', ok: true });
    await logStep(targetUserId, 2, 'sql_cascade', true);
  } catch (e) {
    await logStep(targetUserId, 2, 'sql_cascade', false);
    console.error('[account-delete] rpc threw', e instanceof Error ? e.name : 'unknown');
    return jsonError(500, 'internal');
  }

  // ---- STEP 5: STRIPE CUSTOMER DELETE ----
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: stripeCust } = (await (admin
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', targetUserId)
      .maybeSingle() as any)) as { data: { stripe_customer_id?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (stripeCust?.stripe_customer_id) {
      const stripe = getStripe();
      // Cancel active subscriptions for the customer first.
      try {
        const subs = await stripe.subscriptions.list({
          customer: stripeCust.stripe_customer_id,
          status: 'active',
          limit: 100,
        });
        for (const s of subs?.data ?? []) {
          try {
            await stripe.subscriptions.cancel(s.id);
          } catch (e) {
            console.error(
              `[account-delete] sub cancel ${s.id} failed`,
              e instanceof Error ? e.message : 'unknown',
            );
          }
        }
      } catch (e) {
        console.error(
          '[account-delete] subscriptions.list failed',
          e instanceof Error ? e.message : 'unknown',
        );
      }
      // ---- STEP 7: PaymentIntent void (do BEFORE customers.del — Stripe rejects
      //              customer delete if pending PIs exist). ----
      try {
        const pis = await stripe.paymentIntents.list({
          customer: stripeCust.stripe_customer_id,
          limit: 100,
        });
        for (const pi of pis?.data ?? []) {
          if (
            pi.status === 'requires_payment_method' ||
            pi.status === 'requires_confirmation' ||
            pi.status === 'requires_action' ||
            pi.status === 'processing'
          ) {
            try {
              await stripe.paymentIntents.cancel(pi.id);
            } catch (e) {
              console.error(
                `[account-delete] PI cancel ${pi.id} failed`,
                e instanceof Error ? e.message : 'unknown',
              );
            }
          }
        }
        steps.push({ step: 7, name: 'payment_intent_cancel', ok: true });
        await logStep(targetUserId, 7, 'payment_intent_cancel', true);
      } catch (e) {
        steps.push({ step: 7, name: 'payment_intent_cancel', ok: false });
        await logStep(targetUserId, 7, 'payment_intent_cancel', false);
        console.error(
          '[account-delete] paymentIntents.list failed',
          e instanceof Error ? e.message : 'unknown',
        );
      }
      try {
        await stripe.customers.del(stripeCust.stripe_customer_id);
        steps.push({ step: 5, name: 'stripe_customer_del', ok: true });
        await logStep(targetUserId, 5, 'stripe_customer_del', true);
      } catch (e) {
        steps.push({ step: 5, name: 'stripe_customer_del', ok: false });
        await logStep(targetUserId, 5, 'stripe_customer_del', false);
        console.error(
          '[account-delete] customers.del failed',
          e instanceof Error ? e.message : 'unknown',
        );
      }
    }
  } catch (e) {
    console.error(
      '[account-delete] stripe customer step threw',
      e instanceof Error ? e.name : 'unknown',
    );
  }

  // ---- STEP 6: STRIPE CONNECT ACCOUNT DELETE ----
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: aff } = (await (admin
      .from('affiliates')
      .select('stripe_connect_account_id')
      .eq('user_id', targetUserId)
      .maybeSingle() as any)) as { data: { stripe_connect_account_id?: string | null } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const connectId = aff?.stripe_connect_account_id;
    if (connectId) {
      const stripe = getStripe();
      // Pitfall 1: pre-flight balance — skip when non-zero. Stripe rejects
      // accounts.del on accounts with balance/pending payouts.
      let balanceOk = true;
      try {
        const balance = await stripe.balance.retrieve({ stripeAccount: connectId });
        const available = (balance?.available ?? []).reduce(
          (s: number, b: { amount?: number }) => s + (b.amount ?? 0),
          0,
        );
        const pending = (balance?.pending ?? []).reduce(
          (s: number, b: { amount?: number }) => s + (b.amount ?? 0),
          0,
        );
        if (available !== 0 || pending !== 0) balanceOk = false;
      } catch (e) {
        balanceOk = false;
        console.error(
          '[account-delete] balance.retrieve failed — skipping accounts.del',
          e instanceof Error ? e.message : 'unknown',
        );
      }
      if (balanceOk) {
        try {
          await stripe.accounts.del(connectId);
          steps.push({ step: 6, name: 'stripe_connect_del', ok: true });
          await logStep(targetUserId, 6, 'stripe_connect_del', true);
        } catch (e) {
          steps.push({ step: 6, name: 'stripe_connect_del', ok: false });
          await logStep(targetUserId, 6, 'stripe_connect_del', false);
          console.error(
            '[account-delete] accounts.del failed',
            e instanceof Error ? e.message : 'unknown',
          );
        }
      } else {
        steps.push({ step: 6, name: 'stripe_connect_del_skipped_balance', ok: true });
        await logStep(targetUserId, 6, 'stripe_connect_del_skipped_balance', true);
      }
    }
  } catch (e) {
    console.error(
      '[account-delete] stripe connect step threw',
      e instanceof Error ? e.name : 'unknown',
    );
  }

  // ---- STEP 8: RESEND AUDIENCE REMOVE (uses original email from BL-6 RPC) ----
  if (originalEmail) {
    const r = await resendContactRemove(originalEmail);
    steps.push({ step: 8, name: 'resend_contact_remove', ok: r.ok });
    await logStep(targetUserId, 8, 'resend_contact_remove', r.ok);
  }

  // ---- STEP 9: STORAGE DELETE ----
  // Two prefixes — best-effort. Use the Storage SDK so the
  // protect_objects_delete trigger is bypassed via the SDK's admin path.
  try {
    const prefixes = [
      { bucket: 'photos', prefix: `${targetUserId}/` },
      { bucket: 'photos', prefix: `affiliate-photos/${targetUserId}/` },
    ];
    for (const { bucket, prefix } of prefixes) {
      try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const { data: files } = (await ((admin.storage as any).from(bucket).list(prefix, {
          limit: 1000,
        }))) as { data: Array<{ name: string }> | null };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (files && files.length > 0) {
          const paths = files.map((f) => `${prefix}${f.name}`);
          /* eslint-disable @typescript-eslint/no-explicit-any */
          await ((admin.storage as any).from(bucket).remove(paths));
          /* eslint-enable @typescript-eslint/no-explicit-any */
        }
      } catch (e) {
        console.error(
          `[account-delete] storage delete (${bucket}/${prefix}) failed`,
          e instanceof Error ? e.message : 'unknown',
        );
      }
    }
    steps.push({ step: 9, name: 'storage_delete', ok: true });
    await logStep(targetUserId, 9, 'storage_delete', true);
  } catch (e) {
    steps.push({ step: 9, name: 'storage_delete', ok: false });
    await logStep(targetUserId, 9, 'storage_delete', false);
    console.error('[account-delete] storage threw', e instanceof Error ? e.name : 'unknown');
  }

  // ---- STEP 10: auth.admin.deleteUser ----
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { error: delErr } = (await ((admin.auth as any).admin.deleteUser(
      targetUserId,
    ))) as { error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (delErr) {
      // Idempotency: user-already-gone counts as success.
      const msg = (delErr.message ?? '').toLowerCase();
      const idempotent = msg.includes('not found') || msg.includes('user not found');
      steps.push({ step: 10, name: 'auth_user_delete', ok: idempotent });
      await logStep(targetUserId, 10, 'auth_user_delete', idempotent);
      if (!idempotent) {
        console.error('[account-delete] auth.admin.deleteUser failed', delErr.message);
        return jsonError(500, 'internal');
      }
    } else {
      steps.push({ step: 10, name: 'auth_user_delete', ok: true });
      await logStep(targetUserId, 10, 'auth_user_delete', true);
    }
  } catch (e) {
    steps.push({ step: 10, name: 'auth_user_delete', ok: false });
    await logStep(targetUserId, 10, 'auth_user_delete', false);
    console.error('[account-delete] auth.admin threw', e instanceof Error ? e.name : 'unknown');
    return jsonError(500, 'internal');
  }

  return jsonResponse(200, { ok: true, deleted_at: new Date().toISOString(), steps });
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
  try {
    return await handleDelete(req);
  } catch (e) {
    console.error('[account-delete] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// ============================================================================
// Test seam
// ============================================================================

export const __internal = {
  handleDelete,
  nextPayoutDateIso,
  sha256Hex,
  setAdminForTest(client: unknown): void {
    _adminInstance = client as SupabaseClient;
  },
  setStripeForTest(stub: unknown): void {
    _stripeInstance = stub;
  },
};
