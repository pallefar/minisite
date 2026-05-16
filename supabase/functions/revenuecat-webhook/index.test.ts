/**
 * index.test.ts — Deno tests for revenuecat-webhook Edge Function dispatcher.
 *
 * Tests run against the __internal exports (no live RC, no live DB).
 * Per project rule (reference_deno_test_discovery): file is `index.test.ts`
 * — Deno glob `{*_,*.,}test.*` matches; `index-test.ts` would NOT.
 *
 * Behaviors tested (Phase 16 Plan 06 § Task 3):
 *
 *  AUTH GATE:
 *   1.1 POST without Authorization header → 401 { error: 'unauthorized' }
 *   1.2 POST with wrong Bearer token → 401 { error: 'unauthorized' }
 *   1.3 GET method → 405 { error: 'method-not-allowed' }
 *   1.4 OPTIONS preflight → 200 with Cache-Control: private, no-store
 *
 *  HMAC VERIFY (when REVENUECAT_WEBHOOK_SECRET is set — see env block below):
 *   2.1 missing x-revenuecat-signature → 400 { error: 'missing-signature' }
 *   2.2 bad signature → 400 { error: 'bad-signature' }
 *   2.3 correct signature + correct Bearer → reaches dispatcher (200 ok mocked)
 *
 *  IDEMPOTENCY:
 *   3.1 insertResult.error.code = '23505' → 200 { duplicate: true }
 *   3.2 insertResult.error.code = '08006' → 500 { error: 'internal' }
 *
 *  D-04 DISPATCHER MATH (regression-proofs the deliberate asymmetry vs Stripe):
 *   4.1 CANCELLATION with expiration_at_ms 30d future → captured upsert payload
 *       has current_period_end ≈ now() (NOT the future date), ux_tier='free'
 *   4.2 RENEWAL with expiration_at_ms 30d future → captured payload has
 *       current_period_end = future ISO, ux_tier='paid', status='active'
 *
 *  BODY PARSING:
 *   5.1 Malformed JSON → 400 { error: 'malformed-json' }
 *   5.2 Event missing id → 400 { error: 'malformed-event' }
 *
 *  PII SAFETY:
 *   6.1 Handler throws with PII in error message → response body never contains
 *       the PII string (only `{ error: 'internal' }`).
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ─── Test secrets ─────────────────────────────────────────────────────────────
const TEST_BEARER = 'test_bearer_token_12345';
const TEST_HMAC_SECRET = 'test_hmac_secret_abcdefABCDEF1234567890';

// MUST set env vars BEFORE importing the module — admin client init reads them
// at load time. The auth/HMAC secrets are read via lazy getters so they could
// be re-set later, but for cold-start consistency we set everything up front.
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service_role_test_key');
Deno.env.set('REVENUECAT_WEBHOOK_AUTH', TEST_BEARER);
Deno.env.set('REVENUECAT_WEBHOOK_SECRET', TEST_HMAC_SECRET);

import { __internal } from './index.ts';

const { handleRequest } = __internal;

// ─── HMAC helper ──────────────────────────────────────────────────────────────
async function computeRcSignature(body: string, secret: string): Promise<string> {
  // Round-trip into plain ArrayBuffer for Deno's strict BufferSource typing.
  const enc = new TextEncoder();
  const secretU8 = enc.encode(secret);
  const secretBuf = new ArrayBuffer(secretU8.byteLength);
  new Uint8Array(secretBuf).set(secretU8);
  const bodyU8 = enc.encode(body);
  const bodyBuf = new ArrayBuffer(bodyU8.byteLength);
  new Uint8Array(bodyBuf).set(bodyU8);

  const key = await crypto.subtle.importKey(
    'raw',
    secretBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, bodyBuf);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Event body builder ───────────────────────────────────────────────────────
interface RcEventOverrides {
  id?: string;
  type?: string;
  app_user_id?: string;
  product_id?: string;
  expiration_at_ms?: number | null;
  omitId?: boolean;
}

function buildRcBody(overrides: RcEventOverrides = {}): string {
  const event: Record<string, unknown> = {
    id: overrides.id ?? `evt_rc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: overrides.type ?? 'INITIAL_PURCHASE',
    app_user_id:
      overrides.app_user_id ?? '00000000-0000-0000-0000-000000000abc',
    product_id: overrides.product_id ?? 'app.leanshot.plus.monthly',
    expiration_at_ms:
      overrides.expiration_at_ms !== undefined
        ? overrides.expiration_at_ms
        : Date.now() + 30 * 24 * 3600 * 1000,
  };
  if (overrides.omitId) {
    delete event.id;
  }
  return JSON.stringify({ event, api_version: '1.0' });
}

// Build a request with valid Bearer + (optionally) valid HMAC signature.
async function buildSignedRequest(
  body: string,
  opts: {
    bearer?: string | null;
    includeHmac?: boolean;
    badHmac?: boolean;
    method?: string;
  } = {},
): Promise<Request> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.bearer !== null) {
    headers['Authorization'] = `Bearer ${opts.bearer ?? TEST_BEARER}`;
  }
  if (opts.includeHmac) {
    const sig = await computeRcSignature(body, TEST_HMAC_SECRET);
    headers['X-RevenueCat-Signature'] = opts.badHmac
      ? sig.replace(/^.{4}/, 'dead')
      : sig;
  }
  return new Request('https://test.supabase.co/functions/v1/revenuecat-webhook', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.method === 'GET' || opts.method === 'OPTIONS' ? undefined : body,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// 1.1 — missing Authorization header
Deno.test('1.1 auth: missing Authorization → 401 unauthorized', async () => {
  const req = await buildSignedRequest(buildRcBody(), { bearer: null });
  const res = await handleRequest(req);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
  assertEquals(res.headers.get('Content-Type'), 'application/json');
});

// 1.2 — wrong Bearer token
Deno.test('1.2 auth: wrong Bearer → 401 unauthorized', async () => {
  const req = await buildSignedRequest(buildRcBody(), { bearer: 'wrong_token' });
  const res = await handleRequest(req);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// 1.3 — method guard
Deno.test('1.3 method: GET → 405 method-not-allowed', async () => {
  const req = new Request('https://test.supabase.co/functions/v1/revenuecat-webhook', {
    method: 'GET',
  });
  const res = await handleRequest(req);
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error, 'method-not-allowed');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// 1.4 — OPTIONS preflight
Deno.test('1.4 method: OPTIONS preflight → 200 with Cache-Control header', async () => {
  const req = new Request('https://test.supabase.co/functions/v1/revenuecat-webhook', {
    method: 'OPTIONS',
  });
  const res = await handleRequest(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// 2.1 — HMAC enabled + missing signature header
Deno.test('2.1 hmac: missing X-RevenueCat-Signature → 400 missing-signature', async () => {
  // HMAC secret is set in module env (see top of file). No signature header sent.
  const req = await buildSignedRequest(buildRcBody(), { includeHmac: false });
  const res = await handleRequest(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'missing-signature');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// 2.2 — HMAC bad signature
Deno.test('2.2 hmac: bad signature → 400 bad-signature', async () => {
  const body = buildRcBody();
  const req = await buildSignedRequest(body, { includeHmac: true, badHmac: true });
  const res = await handleRequest(req);
  assertEquals(res.status, 400);
  const respBody = await res.json();
  assertEquals(respBody.error, 'bad-signature');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// 2.3 — HMAC valid + Bearer valid → reaches dispatcher (200 ok mocked)
Deno.test('2.3 hmac: valid signature + valid Bearer → 200 ok (mocked DB)', async () => {
  const body = buildRcBody();
  const req = await buildSignedRequest(body, { includeHmac: true });
  const res = await handleRequest(req, {
    insertResult: { data: null, error: null },
    upsertResult: { data: null, error: null },
    handlerResult: undefined,
  });
  assertEquals(res.status, 200);
  const respBody = await res.json();
  assertEquals(respBody.ok, true);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// 3.1 — Idempotency replay
Deno.test('3.1 idempotency: insert 23505 → 200 duplicate', async () => {
  const body = buildRcBody({ id: 'evt_dup_anchor_001' });
  const req = await buildSignedRequest(body, { includeHmac: true });
  const res = await handleRequest(req, {
    insertResult: { data: null, error: { code: '23505', message: 'unique_violation' } },
    handlerResult: undefined,
  });
  assertEquals(res.status, 200);
  const respBody = await res.json();
  assertEquals(respBody.duplicate, true);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// 3.2 — DB failure other than 23505
Deno.test('3.2 idempotency: insert connection-failure → 500 internal', async () => {
  const body = buildRcBody({ id: 'evt_dbfail_001' });
  const req = await buildSignedRequest(body, { includeHmac: true });
  const res = await handleRequest(req, {
    insertResult: { data: null, error: { code: '08006', message: 'connection_failure' } },
    handlerResult: undefined,
  });
  assertEquals(res.status, 500);
  const respBody = await res.json();
  assertEquals(respBody.error, 'internal');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

// 4.1 — D-04 immediate downgrade for CANCELLATION (regression-proof)
Deno.test('4.1 D-04: CANCELLATION → current_period_end ≈ now() (NOT 30d future), ux_tier=free', async () => {
  const futureMs = Date.now() + 30 * 24 * 3600 * 1000;
  const body = buildRcBody({
    id: 'evt_cancel_001',
    type: 'CANCELLATION',
    expiration_at_ms: futureMs,
  });
  const req = await buildSignedRequest(body, { includeHmac: true });

  let captured: Record<string, unknown> | undefined;
  const res = await handleRequest(req, {
    insertResult: { data: null, error: null },
    upsertResult: { data: null, error: null },
    onUpsertCapture: (p) => {
      captured = p;
    },
  });
  assertEquals(res.status, 200);
  assertEquals(captured !== undefined, true);
  assertEquals(captured!.ux_tier, 'free');
  assertEquals(captured!.status, 'cancellation');
  assertEquals(captured!.provider, 'revenuecat');
  // D-04 invariant: current_period_end is within 5s of NOW, NOT the future date.
  const cpeMs = new Date(captured!.current_period_end as string).getTime();
  const skew = Math.abs(cpeMs - Date.now());
  assertEquals(skew < 5000, true);
  // Crucially: it is NOT 30 days out.
  assertEquals(Math.abs(cpeMs - futureMs) > 25 * 24 * 3600 * 1000, true);
});

// 4.2 — RENEWAL preserves the future expiration date (control)
Deno.test('4.2 D-04 control: RENEWAL → current_period_end = future expiration_at_ms, ux_tier=paid', async () => {
  const futureMs = Date.now() + 30 * 24 * 3600 * 1000;
  const body = buildRcBody({
    id: 'evt_renew_001',
    type: 'RENEWAL',
    expiration_at_ms: futureMs,
  });
  const req = await buildSignedRequest(body, { includeHmac: true });

  let captured: Record<string, unknown> | undefined;
  const res = await handleRequest(req, {
    insertResult: { data: null, error: null },
    upsertResult: { data: null, error: null },
    onUpsertCapture: (p) => {
      captured = p;
    },
  });
  assertEquals(res.status, 200);
  assertEquals(captured !== undefined, true);
  assertEquals(captured!.ux_tier, 'paid');
  assertEquals(captured!.status, 'active');
  assertEquals(captured!.provider, 'revenuecat');
  // current_period_end is the future ISO from expiration_at_ms, NOT now().
  const cpeMs = new Date(captured!.current_period_end as string).getTime();
  assertEquals(Math.abs(cpeMs - futureMs) < 5000, true);
});

// 5.1 — Malformed JSON
Deno.test('5.1 parse: malformed JSON body → 400 malformed-json', async () => {
  // For malformed JSON test we still need a valid HMAC signature over the
  // (malformed) body bytes — the function reads RAW body first, verifies HMAC,
  // THEN tries to JSON.parse.
  const malformed = '{not-json{{';
  const sig = await computeRcSignature(malformed, TEST_HMAC_SECRET);
  const req = new Request('https://test.supabase.co/functions/v1/revenuecat-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_BEARER}`,
      'X-RevenueCat-Signature': sig,
    },
    body: malformed,
  });
  const res = await handleRequest(req);
  assertEquals(res.status, 400);
  const respBody = await res.json();
  assertEquals(respBody.error, 'malformed-json');
});

// 5.2 — Event missing required id
Deno.test('5.2 parse: event missing id → 400 malformed-event', async () => {
  const body = buildRcBody({ omitId: true });
  const req = await buildSignedRequest(body, { includeHmac: true });
  const res = await handleRequest(req);
  assertEquals(res.status, 400);
  const respBody = await res.json();
  assertEquals(respBody.error, 'malformed-event');
});

// 6.1 — PII safety: handler error message containing PII never leaks to response
Deno.test('6.1 pii: handler error with PII → response body has no PII (only generic error code)', async () => {
  const SECRET_USER_ID = '00000000-0000-0000-0000-DEADBEEFCAFE';
  const SECRET_PRODUCT = 'app.leanshot.plus.SUPER_SECRET_SKU';
  const body = buildRcBody({
    id: 'evt_pii_001',
    type: 'INITIAL_PURCHASE',
    app_user_id: SECRET_USER_ID,
    product_id: SECRET_PRODUCT,
  });
  const req = await buildSignedRequest(body, { includeHmac: true });

  const res = await handleRequest(req, {
    insertResult: { data: null, error: null },
    handlerResult: new Error(
      `PII boom for ${SECRET_USER_ID} on ${SECRET_PRODUCT} card=4111111111111111`,
    ),
  });
  assertEquals(res.status, 500);
  const respText = await res.text();
  assertEquals(JSON.parse(respText).error, 'internal');
  // Response body MUST NOT contain any of the PII strings from the input event
  // or the handler error message.
  assertEquals(respText.includes(SECRET_USER_ID), false);
  assertEquals(respText.includes(SECRET_PRODUCT), false);
  assertEquals(respText.includes('4111111111111111'), false);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});
