/**
 * Deno tests for `plan-personalize` Edge Function — Phase 38 Plan 38-06.
 *
 * Per CONTEXT D-16 & D-17:
 *   - Rule-based v1 — ZERO LLM calls (mock fetch asserts no `ai-gateway.vercel.sh`).
 *   - Deterministic confidence per rule matched.
 *   - Rationale ≤200 chars, no clinical-action keywords.
 *
 * Test plan (10 behaviors from 38-06-PLAN.md <behavior>):
 *   T1  — Monthly subscriber, 0 paywall dismissals, 60+ days tenure   → annual_nudge
 *   T2  — User with ≥3 paywall dismissals                              → discount_eligible
 *   T3  — Trialing user near trial end + low activation score          → extended_trial
 *   T4  — Active paid user with context=save_offer                     → pause_offer
 *   T5  — User never activated (no activation_event row)               → extended_trial
 *   T6  — Invalid context value                                        → 400
 *   T7  — Unknown user_id                                              → 404
 *   T8  — ZERO calls to ai-gateway.vercel.sh                           → fetch-mock assert
 *   T9  — Response always includes a numeric confidence
 *   T10 — Rationale ≤200 chars, no clinical-action keywords
 *
 * Plus standard gates:
 *   G1 — OPTIONS preflight → 200 CORS
 *   G2 — non-POST method → 405
 *   G3 — missing Authorization → 401
 *   G4 — invalid JWT → 401
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts`.
 */
import { assertEquals, assert, assertExists } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const USER_UUID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ROLE = 'test-service-role-key';

// ----------------------------------------------------------------------------
// Fake admin builder — captures the single `from('profiles').…` query the fn issues.
// ----------------------------------------------------------------------------

interface UserFacts {
  id: string;
  signup_at: string | null;          // ISO
  plan_tier: 'paid_monthly' | 'paid_annual' | 'trial' | 'free' | null;
  is_active: boolean;
  activated_at: string | null;       // ISO; null = never activated
  activation_score: number | null;   // 0..1
  paywall_dismissals: number;
  trial_end: string | null;          // ISO
}

interface FetchCall {
  url: string;
  method?: string;
}

interface FakeAdminLog {
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  fromCalls: Array<{ table: string }>;
  fetches: FetchCall[];
}

interface FakeAdminConfig {
  authBehavior: 'ok' | 'error';
  userId?: string;
  /** If undefined → simulates "user row not found" (RPC returns null). */
  facts?: UserFacts;
  rpcBehavior?: 'ok' | 'error';
  log: FakeAdminLog;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (cfg.authBehavior === 'error') {
          return Promise.resolve({
            data: { user: null },
            error: { message: 'invalid_jwt' },
          });
        }
        return Promise.resolve({
          data: { user: { id: cfg.userId ?? USER_UUID } },
          error: null,
        });
      },
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      cfg.log.rpcCalls.push({ fn, args });
      if (cfg.rpcBehavior === 'error') {
        return Promise.resolve({ data: null, error: { message: 'fake_rpc_error' } });
      }
      // RPC `plan_personalize_facts` returns a SINGLE row (or null).
      return Promise.resolve({ data: cfg.facts ?? null, error: null });
    },
  };
}

function mkReq(opts: {
  method?: string;
  jwt?: string;
  body?: unknown;
}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/plan-personalize', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// Fetch-mock — fails the test if any call hits ai-gateway.vercel.sh (D-17).
function installFetchSpy(log: FakeAdminLog): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    log.fetches.push({ url, method: init?.method });
    // No network: pretend any call is a 500 so the fn cannot rely on it.
    return Promise.resolve(new Response('mocked', { status: 500 }));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

// Common factories ----------------------------------------------------------

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}

function baseFacts(over: Partial<UserFacts> = {}): UserFacts {
  return {
    id: USER_UUID,
    signup_at: daysAgo(30),
    plan_tier: 'free',
    is_active: false,
    activated_at: null,
    activation_score: null,
    paywall_dismissals: 0,
    trial_end: null,
    ...over,
  };
}

// ----------------------------------------------------------------------------
// G1 — OPTIONS preflight
// ----------------------------------------------------------------------------

Deno.test('G1: OPTIONS preflight returns 200 + CORS headers', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'ok', log }));

  const res = await __internal.handlePersonalize(mkReq({ method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertExists(res.headers.get('Access-Control-Allow-Origin'));
});

// ----------------------------------------------------------------------------
// G2 — non-POST → 405
// ----------------------------------------------------------------------------

Deno.test('G2: GET method → 405 method_not_allowed', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'ok', log }));

  const res = await __internal.handlePersonalize(mkReq({ method: 'GET', jwt: 'fake' }));
  assertEquals(res.status, 405);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'method_not_allowed');
});

// ----------------------------------------------------------------------------
// G3 — missing Authorization → 401
// ----------------------------------------------------------------------------

Deno.test('G3: missing Authorization → 401 unauthenticated', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'ok', log }));

  const res = await __internal.handlePersonalize(
    mkReq({ body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 401);
});

// ----------------------------------------------------------------------------
// G4 — invalid JWT → 401
// ----------------------------------------------------------------------------

Deno.test('G4: invalid JWT → 401 unauthenticated', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'error', log }));

  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'forged', body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 401);
});

// ----------------------------------------------------------------------------
// T6 — invalid context value → 400
// ----------------------------------------------------------------------------

Deno.test('T6: invalid context value → 400 bad_request', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ authBehavior: 'ok', log }));

  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'banana' } }),
  );
  assertEquals(res.status, 400);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'invalid_context');
  // No DB query issued for invalid input.
  assertEquals(log.rpcCalls.length, 0);
});

// ----------------------------------------------------------------------------
// T7 — unknown user_id → 404
// ----------------------------------------------------------------------------

Deno.test('T7: unknown user_id (RPC returns null) → 404', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({ authBehavior: 'ok', userId: USER_UUID, facts: undefined, log }),
  );

  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 404);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'user_not_found');
});

// ----------------------------------------------------------------------------
// T4 — Active paid user, context=save_offer → pause_offer
// ----------------------------------------------------------------------------

Deno.test('T4: save_offer + active paid monthly → pause_offer', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      userId: USER_UUID,
      facts: baseFacts({ plan_tier: 'paid_monthly', is_active: true, paywall_dismissals: 0 }),
      log,
    }),
  );

  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'save_offer' } }),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { offer_hint: string; confidence: number; rationale: string };
  assertEquals(body.offer_hint, 'pause_offer');
  assertEquals(typeof body.confidence, 'number');
  assert(body.confidence > 0 && body.confidence <= 1);
});

// ----------------------------------------------------------------------------
// T2 — ≥3 paywall dismissals → discount_eligible
// ----------------------------------------------------------------------------

Deno.test('T2: ≥3 paywall dismissals → discount_eligible', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      userId: USER_UUID,
      facts: baseFacts({
        plan_tier: 'free',
        is_active: false,
        paywall_dismissals: 3,
      }),
      log,
    }),
  );

  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { offer_hint: string; confidence: number };
  assertEquals(body.offer_hint, 'discount_eligible');
});

// ----------------------------------------------------------------------------
// T1 — paid_monthly + 0 dismissals + 60+ days tenure → annual_nudge
// ----------------------------------------------------------------------------

Deno.test('T1: paid_monthly + 0 dismissals + 60d tenure → annual_nudge', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      userId: USER_UUID,
      facts: baseFacts({
        plan_tier: 'paid_monthly',
        is_active: true,
        signup_at: daysAgo(90),
        paywall_dismissals: 0,
      }),
      log,
    }),
  );

  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { offer_hint: string };
  assertEquals(body.offer_hint, 'annual_nudge');
});

// ----------------------------------------------------------------------------
// T3 — trialing + low activation_score → extended_trial
// ----------------------------------------------------------------------------

Deno.test('T3: trial + low activation_score → extended_trial', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      userId: USER_UUID,
      facts: baseFacts({
        plan_tier: 'trial',
        is_active: false,
        activated_at: daysAgo(2),
        activation_score: 0.1,
        paywall_dismissals: 0,
      }),
      log,
    }),
  );

  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { offer_hint: string };
  assertEquals(body.offer_hint, 'extended_trial');
});

// ----------------------------------------------------------------------------
// T5 — never activated → extended_trial (D-17 hand-coded fallback)
// ----------------------------------------------------------------------------

Deno.test('T5: never activated → extended_trial fallback', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      userId: USER_UUID,
      facts: baseFacts({
        plan_tier: 'free',
        is_active: false,
        activated_at: null,
        activation_score: null,
      }),
      log,
    }),
  );

  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { offer_hint: string };
  assertEquals(body.offer_hint, 'extended_trial');
});

// ----------------------------------------------------------------------------
// T8 — ZERO calls to ai-gateway.vercel.sh
// ----------------------------------------------------------------------------

Deno.test('T8: zero calls to ai-gateway.vercel.sh (D-17 NO-LLM)', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      userId: USER_UUID,
      facts: baseFacts({ plan_tier: 'paid_monthly', is_active: true, paywall_dismissals: 5 }),
      log,
    }),
  );
  const restore = installFetchSpy(log);
  try {
    const res = await __internal.handlePersonalize(
      mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'paywall' } }),
    );
    assertEquals(res.status, 200);
  } finally {
    restore();
  }

  const aiCalls = log.fetches.filter((f) => /ai-gateway\.vercel\.sh|api\.anthropic\.com|api\.openai\.com|api\.moonshot\.ai/.test(f.url));
  assertEquals(aiCalls.length, 0, `AI Gateway must not be called; saw ${aiCalls.length} call(s): ${aiCalls.map((c) => c.url).join(', ')}`);
});

// ----------------------------------------------------------------------------
// T9 — response always includes numeric confidence
// ----------------------------------------------------------------------------

Deno.test('T9: response always includes numeric confidence (deterministic)', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'ok',
      userId: USER_UUID,
      facts: baseFacts({
        plan_tier: 'paid_monthly',
        is_active: true,
        signup_at: daysAgo(120),
        paywall_dismissals: 0,
      }),
      log,
    }),
  );
  const res = await __internal.handlePersonalize(
    mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { confidence: unknown };
  assertEquals(typeof body.confidence, 'number');
  assert((body.confidence as number) >= 0 && (body.confidence as number) <= 1);
});

// ----------------------------------------------------------------------------
// T10 — rationale ≤200 chars, no clinical-action keywords
// ----------------------------------------------------------------------------

Deno.test('T10: rationale capped at 200 chars + clinical-keyword filter', async () => {
  const CLINICAL_KEYWORDS = ['dose', 'mg', 'ml', 'titrate', 'inject', 'medication', 'prescribe'];
  // Exercise all rule paths, assert defensive properties for each.
  const cases: UserFacts[] = [
    baseFacts({ plan_tier: 'paid_monthly', is_active: true, paywall_dismissals: 0 }), // save_offer → pause
    baseFacts({ plan_tier: 'free', paywall_dismissals: 5 }),                            // discount
    baseFacts({ plan_tier: 'paid_monthly', signup_at: daysAgo(120), paywall_dismissals: 0 }), // annual
    baseFacts({ plan_tier: 'trial', activation_score: 0.1 }),                           // extended
    baseFacts({ plan_tier: 'free' }),                                                    // fallback
  ];
  const contexts = ['save_offer', 'paywall', 'paywall', 'paywall', 'paywall'] as const;

  for (let i = 0; i < cases.length; i++) {
    __internal.resetAdminForTest();
    const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
    __internal.setAdminForTest(
      makeFakeAdmin({ authBehavior: 'ok', userId: USER_UUID, facts: cases[i], log }),
    );
    const res = await __internal.handlePersonalize(
      mkReq({ jwt: 'valid', body: { user_id: USER_UUID, context: contexts[i] } }),
    );
    assertEquals(res.status, 200, `case ${i} expected 200`);
    const body = (await res.json()) as { rationale: string };
    assert(body.rationale.length <= 200, `case ${i} rationale too long: ${body.rationale.length}`);
    const lower = body.rationale.toLowerCase();
    for (const kw of CLINICAL_KEYWORDS) {
      assert(
        !lower.includes(kw),
        `case ${i} rationale leaks clinical keyword '${kw}': ${body.rationale}`,
      );
    }
  }
});

// ----------------------------------------------------------------------------
// AUTH — service_role token bypass (caller from Phase 39/40 backend)
// ----------------------------------------------------------------------------

Deno.test('Auth: service_role bearer is accepted without admin.getUser', async () => {
  __internal.resetAdminForTest();
  const log: FakeAdminLog = { rpcCalls: [], fromCalls: [], fetches: [] };
  // authBehavior 'error' to prove we DON'T call getUser when service_role is presented.
  __internal.setAdminForTest(
    makeFakeAdmin({
      authBehavior: 'error',
      userId: USER_UUID,
      facts: baseFacts({ plan_tier: 'paid_monthly', is_active: true, paywall_dismissals: 5 }),
      log,
    }),
  );
  const res = await __internal.handlePersonalize(
    mkReq({ jwt: SERVICE_ROLE, body: { user_id: USER_UUID, context: 'paywall' } }),
  );
  assertEquals(res.status, 200);
});
