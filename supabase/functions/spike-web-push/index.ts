/**
 * `spike-web-push` — Phase 42 Plan 42-01 disposable Web Push spike.
 *
 * NOTE: plan originally specified `_spike_web_push` but Supabase Edge Function
 * names must match `^[A-Za-z][A-Za-z0-9_-]*$` (leading letter required).
 * Renamed to `spike-web-push` during Task 2 execution (Rule 3 auto-fix).
 *
 * Purpose: prove that VAPID ECDSA P-256 signing + a single web-push send works
 * inside a Supabase Edge Function (Deno) BEFORE Wave 2 (plan 42-08) commits to a
 * signing path. This Fn will be DELETED in Wave 4 (plan 42-11) — do NOT depend
 * on it from production code paths.
 *
 * Endpoint contract (POST application/json):
 *
 *   {
 *     "endpoint": "https://fcm.googleapis.com/fcm/send/<token>",
 *     "p256dh":   "<base64url subscription public key>",
 *     "auth":     "<base64url auth secret>",
 *     "payload":  "hello from 42-01"     // optional; UTF-8 string
 *   }
 *
 * Behavior:
 *   1. PRIMARY path: import `npm:web-push@3.6.7`, call setVapidDetails + sendNotification.
 *   2. FALLBACK path: if the npm import or webpush.sendNotification throws a crypto-related
 *      error (matched on /crypto|subtle|ECDSA|P-256|webcrypto/i), forge a VAPID JWT
 *      manually using Deno's built-in crypto.subtle ECDSA P-256 SHA-256, then POST to the
 *      push endpoint with headers:
 *          Authorization: vapid t=<jwt>, k=<base64url(VAPID_PUBLIC_KEY)>
 *          TTL: 60
 *          Content-Encoding: aes128gcm
 *          Content-Length: 0   (empty body — sufficient to prove VAPID auth)
 *
 * Returns: 200 with JSON { ok: true, path: 'npm:web-push' | 'crypto.subtle-fallback', status: <push gateway status> }
 *          or 500 with { ok: false, error: <message>, path: <which path failed> }.
 *
 * Secrets consumed (Supabase Function Secrets — set in Task 1):
 *   - VAPID_PRIVATE_KEY   (base64url, raw 32-byte d)
 *   - VAPID_PUBLIC_KEY    (base64url uncompressed P-256 point, 65 bytes)
 *   - VAPID_SUBJECT       (mailto:karsten.haldan@gmail.com)
 *
 * See ./README.md for the full spike-result-decision protocol.
 */

// ---------- base64url helpers ----------

function base64urlDecode(input: string): Uint8Array {
  // base64url → base64
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- crypto.subtle fallback (hand-rolled VAPID JWT signing) ----------

/**
 * Import the VAPID private key (raw 32-byte base64url-encoded `d`) as a
 * CryptoKey suitable for ECDSA P-256 SHA-256 signing.
 *
 * Web Push VAPID keys are stored as the raw scalar `d`; webcrypto requires
 * JWK or PKCS8. We construct a JWK from `d` + the public key's `x`+`y`
 * coordinates (extracted from the uncompressed 65-byte public point: 0x04 || x[32] || y[32]).
 */
async function importVapidPrivateKey(privateKeyB64: string, publicKeyB64: string): Promise<CryptoKey> {
  const pubBytes = base64urlDecode(publicKeyB64);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error(`VAPID public key must be 65-byte uncompressed P-256 point (got ${pubBytes.length} bytes, prefix 0x${pubBytes[0]?.toString(16)})`);
  }
  const x = pubBytes.slice(1, 33);
  const y = pubBytes.slice(33, 65);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: privateKeyB64,
    x: base64urlEncode(x),
    y: base64urlEncode(y),
    ext: true,
  };
  return await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function signVapidJwt(endpoint: string, subject: string, privateKey: CryptoKey): Promise<string> {
  const audUrl = new URL(endpoint);
  const aud = `${audUrl.protocol}//${audUrl.host}`;
  const header = { alg: "ES256", typ: "JWT" };
  const claims = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // +12h
    sub: subject,
  };
  const enc = new TextEncoder();
  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const claimsB64 = base64urlEncode(enc.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;
  const sigRaw = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    enc.encode(signingInput),
  );
  // crypto.subtle ECDSA returns raw r||s concatenation (64 bytes for P-256) — exactly what JWS ES256 expects.
  return `${signingInput}.${base64urlEncode(sigRaw)}`;
}

async function sendViaFallback(
  endpoint: string,
  vapidPrivateB64: string,
  vapidPublicB64: string,
  vapidSubject: string,
): Promise<{ status: number; body: string }> {
  const privateKey = await importVapidPrivateKey(vapidPrivateB64, vapidPublicB64);
  const jwt = await signVapidJwt(endpoint, vapidSubject, privateKey);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapidPublicB64}`,
      TTL: "60",
      "Content-Length": "0",
      // NOTE: Content-Encoding: aes128gcm is only meaningful with an encrypted body. For the
      // spike we send an empty notification, which most push gateways accept (no payload —
      // service worker still fires `push` event with `event.data == null`).
    },
  });
  return { status: res.status, body: await res.text() };
}

// ---------- npm:web-push PRIMARY path (dynamic import so failure can be caught) ----------

async function sendViaNpmWebPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: string,
  vapidPrivateB64: string,
  vapidPublicB64: string,
  vapidSubject: string,
): Promise<{ status: number; body: string }> {
  // Dynamic import so a module-load failure is recoverable via try/catch.
  // The npm: specifier is resolved by Deno's deploy bundler at build time.
  const mod = await import("npm:web-push@3.6.7");
  const webpush = (mod as { default?: typeof mod }).default ?? mod;
  // deno-lint-ignore no-explicit-any
  const wp = webpush as any;
  wp.setVapidDetails(vapidSubject, vapidPublicB64, vapidPrivateB64);
  const subscription = { endpoint, keys: { p256dh, auth } };
  const result = await wp.sendNotification(subscription, payload, { TTL: 60, urgency: "normal" });
  return { status: result.statusCode ?? 200, body: typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? null) };
}

// ---------- main handler ----------

const CRYPTO_ERROR_RE = /crypto|subtle|ECDSA|P-256|webcrypto|jwk/i;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST required" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!vapidPrivate || !vapidPublic || !vapidSubject) {
    return new Response(
      JSON.stringify({ ok: false, error: "VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY / VAPID_SUBJECT must all be set as Function Secrets" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: { endpoint?: string; p256dh?: string; auth?: string; payload?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ ok: false, error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { endpoint, p256dh, auth, payload } = body;
  if (!endpoint || !p256dh || !auth) {
    return new Response(JSON.stringify({ ok: false, error: "endpoint, p256dh, auth required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const pushPayload = typeof payload === "string" && payload.length > 0 ? payload : "hello from 42-01";

  // ----- PRIMARY: npm:web-push -----
  let primaryError: unknown = null;
  try {
    const r = await sendViaNpmWebPush(endpoint, p256dh, auth, pushPayload, vapidPrivate, vapidPublic, vapidSubject);
    return new Response(
      JSON.stringify({ ok: true, path: "npm:web-push", status: r.status, body: r.body }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    primaryError = e;
    const msg = e instanceof Error ? e.message : String(e);
    const isCryptoFailure = CRYPTO_ERROR_RE.test(msg);
    console.warn(`[spike-web-push] npm:web-push path failed (cryptoFailure=${isCryptoFailure}): ${msg}`);
    // Fall through to fallback regardless of error class — the spike is meant to ALWAYS try the
    // fallback so we observe BOTH paths in one invocation. We surface the primary error in the
    // response so 42-01-SPIKE-RESULT.md can record which signing path actually shipped a push.
  }

  // ----- FALLBACK: crypto.subtle hand-rolled VAPID JWT -----
  try {
    const r = await sendViaFallback(endpoint, vapidPrivate, vapidPublic, vapidSubject);
    return new Response(
      JSON.stringify({
        ok: true,
        path: "crypto.subtle-fallback",
        status: r.status,
        body: r.body,
        primary_error: primaryError instanceof Error ? primaryError.message : String(primaryError),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[spike-web-push] fallback also failed: ${msg}`);
    return new Response(
      JSON.stringify({
        ok: false,
        path: "both-failed",
        primary_error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        fallback_error: msg,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
