/**
 * revenuecat-webhook Edge Function — Phase 16 Plan 06 (MONEY-06).
 *
 * Single source of truth for `subscriptions` table state when the payment
 * provider is RevenueCat (iOS/Android IAP). Mirrors stripe-webhook (P14) in
 * shape: raw-body-first read, idempotent ingestion via subscription_events.event_id
 * PK, JSON-only responses with Cache-Control: private, no-store, dispatcher
 * fans out per event type.
 *
 * Auth (defense in depth):
 *  1. Bearer-token gate (REVENUECAT_WEBHOOK_AUTH Function Secret) — REQUIRED.
 *     Cheap check, runs before body read. Configured in RC dashboard as
 *     `Authorization: Bearer <token>`; we store the bare token in Supabase.
 *  2. HMAC-SHA256 verify (REVENUECAT_WEBHOOK_SECRET Function Secret) — OPTIONAL.
 *     If the secret is unset (e.g. during initial deploy before HMAC is enabled
 *     in the RC dashboard), this layer is skipped and Bearer-token alone gates.
 *     A one-line console.warn at cold-start surfaces the unset state; do NOT
 *     gate the function on it (graceful pre-HMAC-rollout shipping).
 *
 * Security invariants:
 *  - RAW BODY read via `request.text()` BEFORE any JSON.parse (so HMAC verify
 *    sees the exact bytes RevenueCat signed).
 *  - Idempotency via `subscription_events.event_id PRIMARY KEY` + INSERT;
 *    Postgres error 23505 → 200 { duplicate: true } (RC stops retrying).
 *  - PII safety: every error response is `{ error: '<short-code>' }`. Every
 *    `console.error` logs `err.message` only, NEVER the event/payload object
 *    (T-16-06-04).
 *  - `Cache-Control: private, no-store` on every response (T-16-06-04).
 *  - SUPABASE_SERVICE_ROLE_KEY read once at cold-start into `admin` and never
 *    re-interpolated into responses or thrown errors (T-16-06-05).
 *
 * D-04 immediate-downgrade asymmetry:
 *   CANCELLATION + EXPIRATION events set `current_period_end = now()` (free
 *   immediately). This is a deliberate, documented platform-shape choice —
 *   matches Apple's native subscription UX. DO NOT normalize to match Stripe's
 *   grace-period behavior; the asymmetry is regression-tested in index.test.ts.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { BASE_RESPONSE_HEADERS } from './cors.ts';

// ─── Module-level constants (cold-start, read once where safe) ───────────────
// SUPABASE_URL + the auth/HMAC secrets are read lazily so test files can call
// Deno.env.set() before the first handleRequest() invocation.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

function getBearerSecret(): string {
  return Deno.env.get('REVENUECAT_WEBHOOK_AUTH') ?? '';
}

function getHmacSecret(): string {
  return Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
}

// Service-role admin client — SUPABASE_SERVICE_ROLE_KEY read once here (T-16-06-05).
// Never re-interpolated into responses or error strings.
const admin = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder_key',
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Cold-start log if HMAC verify is disabled. DELIBERATE — does NOT gate.
if (!getHmacSecret()) {
  console.warn(
    '[revenuecat-webhook] REVENUECAT_WEBHOOK_SECRET unset — HMAC verify disabled; relying on Bearer-token alone.',
  );
}

// ─── Response helper ─────────────────────────────────────────────────────────
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: BASE_RESPONSE_HEADERS,
  });
}

// ─── Test injection shim ─────────────────────────────────────────────────────
interface UpsertCapture {
  // Test seam: tests set this callback to capture the upsert payload that
  // would have been sent to admin.from('subscriptions').upsert(...).
  // Gated on `testCtx !== undefined` — zero overhead in prod path.
  (payload: Record<string, unknown>): void;
}

interface TestContext {
  insertResult?: { data: null; error: { code: string; message: string } | null };
  upsertResult?: { data: null; error: { code: string; message: string } | null };
  handlerResult?: Error | undefined;
  onUpsertCapture?: UpsertCapture;
}

// ─── HMAC helpers ────────────────────────────────────────────────────────────
function hexToBytes(hex: string): ArrayBuffer {
  // RC may emit signatures as either 'sha256=<hex>' or '<hex>'. Accept both.
  // Return an explicit ArrayBuffer (not Uint8Array) so Deno's strict BufferSource
  // type-check on crypto.subtle.verify accepts it without ArrayBufferLike drift.
  const clean = hex.startsWith('sha256=') ? hex.slice(7) : hex;
  const buf = new ArrayBuffer(clean.length / 2);
  const view = new Uint8Array(buf);
  for (let i = 0; i < view.length; i++) {
    view[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return buf;
}

function stringToArrayBuffer(s: string): ArrayBuffer {
  // TextEncoder().encode(s) returns Uint8Array<ArrayBufferLike> which trips
  // Deno's strict BufferSource type. Round-trip into a plain ArrayBuffer so
  // crypto.subtle APIs (importKey, verify) accept it cleanly.
  const u8 = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);
  return buf;
}

async function verifyHmac(
  body: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      stringToArrayBuffer(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'HMAC',
      key,
      hexToBytes(signatureHeader),
      stringToArrayBuffer(body),
    );
  } catch {
    return false;
  }
}

// ─── RC event shape ──────────────────────────────────────────────────────────
interface RcEvent {
  id: string; // RC dashboard event UUID — idempotency anchor.
  type: string; // 'INITIAL_PURCHASE' | 'RENEWAL' | 'CANCELLATION' | 'EXPIRATION' | 'BILLING_ISSUE' | 'PRODUCT_CHANGE' | 'UNCANCELLATION' | 'TRANSFER'
  app_user_id: string; // Supabase auth.users.id (set by client SDK via login(uid))
  product_id: string; // e.g., 'app.leanshot.plus.monthly'
  expiration_at_ms: number | null;
  // ...other fields are preserved in the payload jsonb on subscription_events.
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────
async function dispatch(event: RcEvent, testCtx?: TestContext): Promise<void> {
  if (testCtx?.handlerResult instanceof Error) {
    throw testCtx.handlerResult;
  }

  // D-04: immediate downgrade for CANCELLATION + EXPIRATION (deliberate
  // asymmetry vs Stripe grace-period behavior). DO NOT normalize.
  const isImmediateDowngrade =
    event.type === 'CANCELLATION' || event.type === 'EXPIRATION';
  const currentPeriodEnd = isImmediateDowngrade
    ? new Date().toISOString()
    : event.expiration_at_ms != null
      ? new Date(event.expiration_at_ms).toISOString()
      : null;

  // Map RC event type → (status, ux_tier).
  let status: string;
  let uxTier: 'free' | 'paid' | 'past_due';
  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
      status = 'active';
      uxTier = 'paid';
      break;
    case 'CANCELLATION':
    case 'EXPIRATION':
      status = event.type.toLowerCase();
      uxTier = 'free';
      break;
    case 'BILLING_ISSUE':
      status = 'past_due';
      uxTier = 'past_due';
      break;
    case 'TRANSFER':
      // TRANSFER fires when a subscription moves between RC app_user_ids
      // (e.g., user account merge). No tier change; payload-only record.
      return;
    default:
      console.log('[revenuecat-webhook] unhandled event type', event.type);
      return;
  }

  // Deterministic id for the RC subscription row. Uniqueness is enforced by
  // idx_subscriptions_user_provider_unique (Plan 16-06 migration 22), so this
  // id is informational only — the `onConflict: 'user_id,provider'` upsert
  // path is what guarantees one row per (user, provider).
  const subId = `rc:${event.app_user_id}:${event.product_id}`;

  const upsertPayload: Record<string, unknown> = {
    id: subId,
    provider: 'revenuecat',
    user_id: event.app_user_id,
    clinic_id: null,
    stripe_customer_id: null,
    status,
    ux_tier: uxTier,
    plan_id: event.product_id,
    current_period_end: currentPeriodEnd,
    metadata: { rc_event_type: event.type, rc_event_id: event.id },
    updated_at: new Date().toISOString(),
  };

  // Test seam — capture payload before any mock-or-real DB write.
  if (testCtx?.onUpsertCapture) {
    testCtx.onUpsertCapture(upsertPayload);
  }

  // Test mode: short-circuit before touching the (placeholder) admin client.
  if (testCtx?.upsertResult !== undefined) {
    if (testCtx.upsertResult.error) {
      // PII safety: log code + message only.
      throw new Error(
        `subscriptions upsert (mock): ${testCtx.upsertResult.error.code ?? 'unknown'} ${
          testCtx.upsertResult.error.message ?? ''
        }`,
      );
    }
    return;
  }

  const { error } = await admin
    .from('subscriptions')
    .upsert(upsertPayload, { onConflict: 'user_id,provider' });

  if (error) {
    // PII safety: log code + message, NEVER the event payload.
    throw new Error(
      `subscriptions upsert: ${(error as { code?: string }).code ?? 'unknown'} ${
        (error as { message?: string }).message ?? ''
      }`,
    );
  }
}

// ─── Core request handler ────────────────────────────────────────────────────
export async function handleRequest(
  request: Request,
  testCtx?: TestContext,
): Promise<Response> {
  // OPTIONS preflight — RC servers don't send this, but keep surface uniform.
  if (request.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: BASE_RESPONSE_HEADERS });
  }

  // Method guard.
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'method-not-allowed' });
  }

  // ─── Bearer-token gate (cheap, runs before body read) ─────────────────────
  const bearer = getBearerSecret();
  const auth = request.headers.get('authorization') ?? '';
  if (!bearer || auth !== `Bearer ${bearer}`) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // ─── RAW BODY (must come before any JSON.parse for HMAC verify) ───────────
  const body = await request.text();

  // ─── Optional HMAC verify ─────────────────────────────────────────────────
  const hmacSecret = getHmacSecret();
  if (hmacSecret) {
    const sigHeader = request.headers.get('x-revenuecat-signature') ?? '';
    if (!sigHeader) {
      return jsonResponse(400, { error: 'missing-signature' });
    }
    const ok = await verifyHmac(body, sigHeader, hmacSecret);
    if (!ok) {
      console.error('[revenuecat-webhook] bad signature');
      return jsonResponse(400, { error: 'bad-signature' });
    }
  }
  // hmacSecret == '' (unset): HMAC step is skipped — Bearer alone gates auth.

  // ─── Parse + validate event shape ─────────────────────────────────────────
  let event: RcEvent;
  try {
    const parsed = JSON.parse(body) as { event?: RcEvent } & RcEvent;
    // RC body shape is typically { event: { ... }, api_version: "..." }.
    // Accept event-only payloads for dashboards that don't wrap.
    event = (parsed.event ?? parsed) as RcEvent;
  } catch {
    return jsonResponse(400, { error: 'malformed-json' });
  }

  if (!event?.id || !event?.type || !event?.app_user_id) {
    return jsonResponse(400, { error: 'malformed-event' });
  }

  // ─── Idempotency insert ───────────────────────────────────────────────────
  let insertErr: { code: string; message: string } | null = null;

  if (testCtx?.insertResult !== undefined) {
    insertErr = testCtx.insertResult.error;
  } else {
    const { error } = await admin.from('subscription_events').insert({
      event_id: event.id,
      event_type: event.type,
      payload: event,
      provider: 'revenuecat',
    });
    insertErr = error as { code: string; message: string } | null;
  }

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Duplicate event.id — already processed. 200 so RC stops retrying.
      return jsonResponse(200, { duplicate: true });
    }
    // Other DB error — 500 triggers RC's bounded retry curve.
    console.error('[revenuecat-webhook] subscription_events insert', insertErr.message);
    return jsonResponse(500, { error: 'internal' });
  }

  // ─── Dispatch ─────────────────────────────────────────────────────────────
  try {
    await dispatch(event, testCtx);
  } catch (err) {
    // PII safety: log message only, NEVER event/payload/app_user_id.
    console.error(
      '[revenuecat-webhook] handler error',
      err instanceof Error ? err.message : 'unknown',
    );
    return jsonResponse(500, { error: 'internal' });
  }

  // Best-effort processed_at update (non-blocking on response shape).
  if (!testCtx) {
    const { error: updateErr } = await admin
      .from('subscription_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('event_id', event.id);
    if (updateErr) {
      console.error('[revenuecat-webhook] processed_at update', updateErr.message);
    }
  }

  return jsonResponse(200, { ok: true });
}

// ─── Entry point ─────────────────────────────────────────────────────────────
Deno.serve((request: Request) => handleRequest(request));

// ─── Internal exports for Deno test suite ────────────────────────────────────
export const __internal = {
  handleRequest,
};
