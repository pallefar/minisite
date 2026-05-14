/**
 * index.test.ts — Deno tests for stripe-webhook Edge Function dispatcher.
 *
 * Tests run against the __internal exports (no live Stripe, no live DB).
 * Per project rule: file is `index.test.ts` (Deno glob `{*_,*.,}test.*` matches).
 *
 * Behaviors tested:
 *  1.1 Missing Stripe-Signature header → 400 { error: 'missing-signature' }
 *  1.2 Tampered body (whitespace-mutated) → 400 { error: 'bad-signature' }
 *  1.3 Valid signature → 200 { ok: true } (mocked DB insert, stub dispatcher)
 *  1.4 Duplicate event.id (23505 from DB) → 200 { duplicate: true }
 *  1.5 Handler throws → 500 { error: 'internal' }, Cache-Control present, no PII
 *  1.6 OPTIONS preflight → 200 with Cache-Control: private, no-store
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ─── Test secret ──────────────────────────────────────────────────────────────
// The SubtleCryptoProvider in stripe@19 uses the FULL whsec_xxx string as the
// HMAC key bytes (UTF-8 encoded), NOT just the base64 part after the prefix.
// This was confirmed by reading the stripe SDK source (computeHMACSignatureAsync:
//   s.encode(o) where o = full secret string including whsec_ prefix).
const TEST_WEBHOOK_SECRET = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
// The HMAC key is the UTF-8 encoding of the full secret string.
const TEST_KEY_BYTES = new TextEncoder().encode(TEST_WEBHOOK_SECRET);

// Set env vars before any module body code runs.
// Note: static import declarations are hoisted, but the module body (including
// getters like getWebhookSecret()) is called at request time, not import time.
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service_role_test_key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_00000000000000000000000000000000000000000000000000');
Deno.env.set('STRIPE_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);

import { __internal } from './index.ts';

const { handleRequest } = __internal;

// ─── Test context types ───────────────────────────────────────────────────────
interface InsertError {
  code: string;
  message: string;
}
interface TestContext {
  insertResult?: { data: null; error: InsertError | null };
  handlerResult?: Error | undefined;
}

// ─── HMAC signature helper ────────────────────────────────────────────────────
/**
 * Compute a valid Stripe webhook `Stripe-Signature` header value for a given body.
 * Uses crypto.subtle.sign (async, works in Deno) over the same algorithm as
 * `constructEventAsync` internally:
 *   signed_payload = `${timestamp}.${body}`
 *   sig = HMAC-SHA256(key_bytes, signed_payload)
 *   header = `t=${timestamp},v1=${hex(sig)}`
 */
async function computeStripeSignatureHeader(
  body: string,
  keyBytes: Uint8Array = TEST_KEY_BYTES,
  timestampOverride?: number,
): Promise<string> {
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${body}`;

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload),
  );
  const sigHex = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `t=${timestamp},v1=${sigHex}`;
}

/** Build a minimal valid Stripe event JSON body. */
function buildEventBody(
  eventId: string = `evt_test_${Date.now()}`,
  eventType: string = 'checkout.session.completed',
): string {
  return JSON.stringify({
    id: eventId,
    object: 'event',
    type: eventType,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_123',
        object: 'checkout.session',
        subscription: 'sub_test_123',
        customer: 'cus_test_123',
        metadata: {},
        subscription_data: { metadata: { tier_kind: 'web', user_id: 'uuid-test-user' } },
      },
    },
  });
}

/** Build a validly-signed POST request for the stripe-webhook handler. */
async function buildSignedRequest(
  body: string,
  testCtx?: TestContext,
): Promise<[Request, TestContext | undefined]> {
  const signatureHeader = await computeStripeSignatureHeader(body);
  const req = new Request('https://test.supabase.co/functions/v1/stripe-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signatureHeader,
    },
    body,
  });
  return [req, testCtx];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test('1.1 missing-signature: no Stripe-Signature header → 400', async () => {
  const req = new Request('https://test.supabase.co/functions/v1/stripe-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'missing-signature');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('1.2 tampered-body: whitespace-mutated body → 400 bad-signature', async () => {
  const originalBody = buildEventBody('evt_tamper_test');
  const tamperedBody = originalBody + ' '; // whitespace mutation (Pitfall 3)

  // Generate signature over the ORIGINAL body; send the TAMPERED body.
  const signatureHeader = await computeStripeSignatureHeader(originalBody);

  const req = new Request('https://test.supabase.co/functions/v1/stripe-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signatureHeader,
    },
    body: tamperedBody,
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'bad-signature');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('1.3 valid signature → 200 { ok: true } (mocked DB + stub dispatcher)', async () => {
  const eventId = `evt_valid_${Date.now()}`;
  const eventBody = buildEventBody(eventId, 'checkout.session.completed');
  const [req, testCtx] = await buildSignedRequest(eventBody, {
    insertResult: { data: null, error: null },
    handlerResult: undefined,
  });

  const res = await handleRequest(req, testCtx);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('1.4 duplicate event.id (23505) → 200 { duplicate: true }', async () => {
  const eventId = `evt_dup_${Date.now()}`;
  const eventBody = buildEventBody(eventId, 'checkout.session.completed');
  const [req, testCtx] = await buildSignedRequest(eventBody, {
    insertResult: { data: null, error: { code: '23505', message: 'unique_violation' } },
    handlerResult: undefined,
  });

  const res = await handleRequest(req, testCtx);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.duplicate, true);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('1.5 handler throws → 500 { error: "internal" }, no PII echoed', async () => {
  const eventId = `evt_throw_${Date.now()}`;
  const eventBody = buildEventBody(eventId, 'checkout.session.completed');
  const [req, testCtx] = await buildSignedRequest(eventBody, {
    insertResult: { data: null, error: null },
    handlerResult: new Error('PII: card number 4111111111111111 customer@example.com'),
  });

  const res = await handleRequest(req, testCtx);
  assertEquals(res.status, 500);
  const bodyText = await res.text();
  const bodyObj = JSON.parse(bodyText);
  assertEquals(bodyObj.error, 'internal');
  // PII safety: response body must NOT contain Stripe payload content (T-14-03-I1)
  assertEquals(bodyText.includes('4111111111111111'), false);
  assertEquals(bodyText.includes('customer@example.com'), false);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('1.6 OPTIONS preflight → 200 with Cache-Control: private, no-store', async () => {
  const req = new Request('https://test.supabase.co/functions/v1/stripe-webhook', {
    method: 'OPTIONS',
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});
