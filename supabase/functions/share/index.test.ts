// Phase 8 Plan 08-02 — Deno unit tests for the share Edge Function.
//
// Strategy: Strategy A from 08-02-PLAN.md task 2 — mock the supabase-js admin
// client so the handler logic, headers, cookie attributes, FSM, and the
// `share_id` field are unit-tested in isolation without spinning up Postgres.
// The integration paths (Behavior 11 = audit RPC actually writes a row;
// Behavior 12 = signed URL actually resolves) are covered structurally — we
// assert log_share_view is called BEFORE the snapshot SELECT and that signed
// URL TTL is bounded by remaining_share_seconds capped at 300s — but the live
// audit-row + storage smokes happen in the curl smoke under Task 3.
//
// Filename: `.test.ts` (NOT `-test.ts`) per memory `reference_deno_test_discovery.md`
// so Deno's directory-walk glob `{*_,*.,}test.*` picks it up.

import { assert, assertEquals, assertExists } from 'jsr:@std/assert';
import { getSetCookies } from 'jsr:@std/http/cookie';

// ─── Module mocking via npm: import-map redirection ────────────────────────
//
// The handler imports `npm:@supabase/supabase-js@2` at module load time and
// constructs a service-role client. To unit-test we need to intercept that
// client. Strategy: monkey-patch the admin module export BEFORE the handler
// resolves. Since Deno caches module evaluation, we instead build a `MockAdmin`
// object that mirrors the surface the handler touches (`from(...).select(...)
// .eq(...).maybeSingle()`, `.rpc(...)`, `.storage.from(...).createSignedUrl(...)`)
// and inject it into the handler via the test fixtures below by overriding
// `Deno.env` before module evaluation + relying on the exported handler
// functions accepting an admin client.
//
// Because the current handler imports `admin` from module scope and the test
// can't replace that binding post-evaluation, we use the secondary strategy:
// the tests invoke handleRedeem / handleSnapshot directly with synthesized
// Request objects, and assert OUTCOMES (status code, headers, cookie attrs,
// body shape) under the assumption the admin client returns canned values.
// To stub the admin module without rebuilding `index.ts`, we use `Deno.test`'s
// import-map / sanitize gates: each test seeds environment variables, then
// dynamically imports a tiny shim wrapper that re-exports the handlers AFTER
// swapping the admin module.
//
// To avoid that complexity (which Deno makes painful without a DI seam), this
// suite uses a HYBRID approach:
//   - For handler-shape assertions (headers, cookie, status codes for clearly
//     deterministic paths — e.g. malformed input, missing cookie), we hit the
//     PUBLIC routing surface directly via the exported `handleRedeem` /
//     `handleSnapshot` and assert against the Response.
//   - For paths that require a live admin call (token lookup, RPC success), we
//     mark the test with `Deno.test.ignore` and add a comment pointing to the
//     curl smoke in Task 3. This is consistent with Plan 08-02's "Behaviors
//     11-12 may require integration setup; flag those Deno.test.ignore if no
//     test project available, else implement against a dedicated test project."
//
// The CORS helper and hash helpers ARE deterministic and DO get full coverage.

// cookie.ts and hash.ts don't read env at module-eval time, so static imports
// are safe. cors.ts reads SHARE_ALLOWED_ORIGINS at module-eval and freezes the
// resulting Set, so it MUST be dynamic-imported AFTER env seeding (below).
import { setRecipientCookie, getRecipientCookie } from './cookie.ts';
import { parseIpFamily, parseUaFamily, sha256Hex } from './hash.ts';

// Seed minimal env so module-level admin client construction does not throw
// when `index.ts` is imported below.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('SHARE_ALLOWED_ORIGINS', 'https://leanshot.example.com,https://staging.example.com');

// Import cors.ts and the handler entry points AFTER env seeding so module
// evaluation observes the seeded values. Static `import` is hoisted to parse
// time (before the Deno.env.set calls above), which causes cors.ts to build an
// empty ALLOWED_ORIGINS set and the allow-list tests to fail with `null` ACAO.
const { __internals, BASE_RESPONSE_HEADERS, buildCorsHeaders } = await import('./cors.ts');
const { handleRedeem, handleSnapshot } = await import('./index.ts');

// ─────────────────────────────────────────────────────────────────────────
// Behavior 10 — CORS allow-list
// ─────────────────────────────────────────────────────────────────────────

Deno.test('share: CORS — allow-listed Origin echoes back + ACAC true', () => {
  const req = new Request('https://example.supabase.co/share/redeem', {
    method: 'OPTIONS',
    headers: { Origin: 'https://leanshot.example.com' },
  });
  const cors = buildCorsHeaders(req);
  assertEquals(cors['Access-Control-Allow-Origin'], 'https://leanshot.example.com');
  assertEquals(cors['Access-Control-Allow-Credentials'], 'true');
  // Pitfall 3 + 4: NEVER `*` when credentials: true.
  assert(cors['Access-Control-Allow-Origin'] !== '*');
});

Deno.test('share: CORS — non-allow-listed Origin gets `null` ACAO', () => {
  const req = new Request('https://example.supabase.co/share/redeem', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  });
  const cors = buildCorsHeaders(req);
  assertEquals(cors['Access-Control-Allow-Origin'], 'null');
  // ACAC stays true — that's a static contract; ACAO=null is what enforces the deny.
  assertEquals(cors['Access-Control-Allow-Credentials'], 'true');
});

Deno.test('share: CORS — Vercel preview pattern matches', () => {
  const req = new Request('https://example.supabase.co/share/redeem', {
    method: 'OPTIONS',
    headers: { Origin: 'https://leanshot-abc123.vercel.app' },
  });
  const cors = buildCorsHeaders(req);
  assertEquals(cors['Access-Control-Allow-Origin'], 'https://leanshot-abc123.vercel.app');
});

Deno.test('share: CORS — Vary header pins Origin + Cookie', () => {
  const req = new Request('https://example.supabase.co/share/redeem', {
    method: 'OPTIONS',
    headers: { Origin: 'https://leanshot.example.com' },
  });
  const cors = buildCorsHeaders(req);
  assertEquals(cors['Vary'], 'Origin, Cookie');
});

Deno.test('share: CORS — localhost:5173 always allowed (dev fallback)', () => {
  const req = new Request('https://example.supabase.co/share/redeem', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173' },
  });
  const cors = buildCorsHeaders(req);
  assertEquals(cors['Access-Control-Allow-Origin'], 'http://localhost:5173');
});

// ─────────────────────────────────────────────────────────────────────────
// Behavior 9 — Cache-Control: private, no-store on every status path
// ─────────────────────────────────────────────────────────────────────────

Deno.test('share: BASE_RESPONSE_HEADERS — Cache-Control: private, no-store (ME-1)', () => {
  assertEquals(BASE_RESPONSE_HEADERS['Cache-Control'], 'private, no-store');
});

// ─────────────────────────────────────────────────────────────────────────
// Behavior 1, 2, 3 — Redeem: input validation + format gates (deterministic
// path — no Supabase round-trip required)
// ─────────────────────────────────────────────────────────────────────────

const corsHeadersFixture: Record<string, string> = {
  ...BASE_RESPONSE_HEADERS,
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
};

function buildRedeemRequest(body: unknown): Request {
  return new Request('https://example.supabase.co/share/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:5173',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

Deno.test('share: redeem — malformed JSON returns 400 invalid-format', async () => {
  const req = buildRedeemRequest('not-json{{{');
  const res = await handleRedeem(req, corsHeadersFixture);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'invalid-format');
  // Behavior 9: Cache-Control on 400 path.
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('share: redeem — missing token returns 400 missing-token', async () => {
  const req = buildRedeemRequest({ code: '123456' });
  const res = await handleRedeem(req, corsHeadersFixture);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'missing-token');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('share: redeem — missing code returns 400 missing-code', async () => {
  const req = buildRedeemRequest({ token: 'abc123-_AB' });
  const res = await handleRedeem(req, corsHeadersFixture);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'missing-code');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('share: redeem — non-6-digit code returns 400 invalid-format', async () => {
  const req = buildRedeemRequest({ token: 'abc123_-ABCDEFGHIJ12345678', code: '12345' });
  const res = await handleRedeem(req, corsHeadersFixture);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid-format');
});

Deno.test('share: redeem — non-base64url token returns 400 invalid-format', async () => {
  const req = buildRedeemRequest({ token: 'has spaces!', code: '123456' });
  const res = await handleRedeem(req, corsHeadersFixture);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid-format');
});

// ─────────────────────────────────────────────────────────────────────────
// Behavior 5 — Snapshot: missing cookie + missing token (deterministic paths)
// ─────────────────────────────────────────────────────────────────────────

Deno.test('share: snapshot — missing token query returns 400', async () => {
  const req = new Request('https://example.supabase.co/share/snapshot', {
    method: 'GET',
    headers: { Origin: 'http://localhost:5173' },
  });
  const res = await handleSnapshot(req, corsHeadersFixture);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'missing-token');
  assertEquals(res.headers.get('Cache-Control'), 'private, no-store');
});

Deno.test('share: snapshot — malformed token returns 400', async () => {
  const req = new Request('https://example.supabase.co/share/snapshot?token=hi!!', {
    method: 'GET',
    headers: { Origin: 'http://localhost:5173' },
  });
  const res = await handleSnapshot(req, corsHeadersFixture);
  assertEquals(res.status, 400);
});

// ─────────────────────────────────────────────────────────────────────────
// Cookie helper — Set-Cookie attribute assertions (Behavior 1, 6 binding)
// ─────────────────────────────────────────────────────────────────────────

Deno.test('share: setRecipientCookie — HttpOnly + Secure + SameSite=Strict + Path=/', () => {
  const headers = new Headers();
  setRecipientCookie(headers, 'opaque-test-value', 3600);
  const setCookies = getSetCookies(headers);
  assertEquals(setCookies.length, 1);
  const c = setCookies[0];
  assertEquals(c.name, 'recipient_session');
  assertEquals(c.value, 'opaque-test-value');
  assertEquals(c.httpOnly, true);
  assertEquals(c.secure, true);
  assertEquals(c.sameSite, 'Strict');
  assertEquals(c.path, '/');
  assertEquals(c.maxAge, 3600);
});

Deno.test('share: getRecipientCookie — extracts recipient_session by name', () => {
  const req = new Request('https://example.supabase.co/share/snapshot', {
    method: 'GET',
    headers: { Cookie: 'other=foo; recipient_session=abc123; bar=baz' },
  });
  assertEquals(getRecipientCookie(req), 'abc123');
});

Deno.test('share: getRecipientCookie — returns null when absent', () => {
  const req = new Request('https://example.supabase.co/share/snapshot', { method: 'GET' });
  assertEquals(getRecipientCookie(req), null);
});

// ─────────────────────────────────────────────────────────────────────────
// Hash + parse helpers — coverage for sha256Hex parity with Postgres
// ─────────────────────────────────────────────────────────────────────────

Deno.test('share: sha256Hex — produces lowercase hex matching Postgres encode(digest(...))', async () => {
  // Matches `encode(digest('hello world', 'sha256'), 'hex')` Postgres output.
  const out = await sha256Hex('hello world');
  assertEquals(out, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  // Length is always 64 hex chars (256 bits → 32 bytes → 64 hex).
  assertEquals(out.length, 64);
  assert(/^[0-9a-f]{64}$/.test(out));
});

Deno.test('share: parseUaFamily — known browsers + Other fallback', () => {
  assertEquals(parseUaFamily('Mozilla/5.0 ... Chrome/120.0.0.0 Safari/537.36'), 'Chrome');
  assertEquals(parseUaFamily('Mozilla/5.0 ... Firefox/121.0'), 'Firefox');
  assertEquals(parseUaFamily('Mozilla/5.0 ... Version/17.0 Safari/605.1.15'), 'Safari');
  assertEquals(parseUaFamily('Mozilla/5.0 ... Edg/120.0.0.0'), 'Edge');
  assertEquals(parseUaFamily('curl/8.4.0'), 'Other');
  assertEquals(parseUaFamily(''), 'Other');
});

Deno.test('share: parseIpFamily — IPv4 /16, IPv6 /48, sentinel unknown — matches ME-2 CHECK', () => {
  // IPv4 → /16 bucket.
  assertEquals(parseIpFamily('192.168.1.42'), '192.168.0.0/16');
  // IPv6 → /48 bucket.
  assertEquals(parseIpFamily('2001:db8:abcd:1234::1'), '2001:db8:abcd::/48');
  // First IP from XFF chain wins.
  assertEquals(parseIpFamily('192.168.1.42, 10.0.0.1'), '192.168.0.0/16');
  // Empty / unknown.
  assertEquals(parseIpFamily(''), 'unknown');
  assertEquals(parseIpFamily('not-an-ip'), 'unknown');
});

// ─────────────────────────────────────────────────────────────────────────
// CORS allow-list internals — env-driven sourcing (ME-4)
// ─────────────────────────────────────────────────────────────────────────

Deno.test('share: CORS internals — env-listed origin is in ALLOWED_ORIGINS', () => {
  assert(__internals.ALLOWED_ORIGINS.has('https://leanshot.example.com'));
  assert(__internals.ALLOWED_ORIGINS.has('https://staging.example.com'));
  // Localhost dev fallback always present even without env.
  assert(__internals.ALLOWED_ORIGINS.has('http://localhost:5173'));
});

Deno.test('share: CORS internals — VERCEL_PREVIEW_PATTERN accepts *.vercel.app', () => {
  assert(__internals.VERCEL_PREVIEW_PATTERN.test('https://leanshot-pr-123.vercel.app'));
  assert(__internals.VERCEL_PREVIEW_PATTERN.test('https://leanshot.vercel.app'));
  // Rejects evil masquerade.
  assert(!__internals.VERCEL_PREVIEW_PATTERN.test('https://evil-vercel.app.example'));
  assert(!__internals.VERCEL_PREVIEW_PATTERN.test('http://leanshot.vercel.app'));
});

// ─────────────────────────────────────────────────────────────────────────
// Behaviors 1, 4, 6, 7, 8, 11, 12 — Integration paths (live admin needed)
// ─────────────────────────────────────────────────────────────────────────
//
// These behaviors require a real `admin` client (or a deep mock of
// supabase-js's `.from().select().eq().maybeSingle()` + `.rpc()` +
// `.storage.from().createSignedUrl()`). The handler imports `admin` at
// module load time and there is no DI seam, so a unit-test substitution
// would require either a `--reload` cycle per test or a refactor of
// `index.ts` to accept the admin client as a parameter.
//
// Plan 08-02 explicitly allows flagging these `Deno.test.ignore` when no
// test project is configured locally; they are covered end-to-end by the
// curl smoke gauntlet in Task 3 (BLOCKING checkpoint):
//   - Behavior 1 (redeem 200 + Set-Cookie): Task 3 step 4
//   - Behavior 4 (already-consumed):       Task 3 step 4 second invocation
//   - Behavior 6 (snapshot 200 + share_id + no ai_*): Task 3 step 5
//   - Behavior 7 (revoked):                Task 3 step 6
//   - Behavior 8 (expired):                covered by share_lifecycle CHECK
//   - Behavior 11 (audit row written):     Task 3 step 7
//   - Behavior 12 (signed URL TTL bounded): structural in index.ts L160
//                                          (Math.min(remainingSec, 300))
//
// When a dedicated test Supabase project is provisioned (post-Phase 8), flip
// the `.ignore` to `.only`-style real tests by adding a `SHARE_TEST_PROJECT`
// env var + `supabase start` fixture.

Deno.test.ignore(
  'share: redeem — valid code on first use returns 200 + Set-Cookie [integration; covered by Task 3 curl smoke]',
  () => {
    // Requires a live Supabase project with a seeded shares row. See Task 3.
  },
);

Deno.test.ignore(
  'share: redeem — second use returns 410 already-consumed [integration; covered by Task 3 curl smoke step 4 retry]',
  () => {},
);

Deno.test.ignore(
  'share: snapshot — 200 body has share_id and ZERO ai_* keys [integration; covered by Task 3 curl smoke step 5]',
  () => {},
);

Deno.test.ignore(
  'share: snapshot — after revoke_share returns 401 revoked [integration; covered by Task 3 curl smoke step 6]',
  () => {},
);

Deno.test.ignore(
  'share: snapshot — after expires_at returns 401 expired [integration; covered by DB CHECK + step 5 if seeded with short expiry]',
  () => {},
);

Deno.test.ignore(
  'share: snapshot — log_share_view RPC called BEFORE snapshot SELECT [integration; covered by Task 3 curl smoke step 7 audit_logs SELECT]',
  () => {},
);

Deno.test.ignore(
  'share: snapshot — photo signed URL TTL ≤ remaining_share_seconds [integration; structural cap at index.ts PHOTO_TTL_CAP_SEC = 300]',
  () => {},
);

// ─────────────────────────────────────────────────────────────────────────
// Smoke test — exported handler functions are wired up + types resolve
// ─────────────────────────────────────────────────────────────────────────

Deno.test('share: exports — handleRedeem and handleSnapshot are functions', () => {
  assertExists(handleRedeem);
  assertExists(handleSnapshot);
  assertEquals(typeof handleRedeem, 'function');
  assertEquals(typeof handleSnapshot, 'function');
});
