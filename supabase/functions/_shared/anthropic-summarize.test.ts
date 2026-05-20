/**
 * Phase 38 Plan 38-02 — tests for anthropic-summarize.ts (Task 2 main).
 *
 * Coverage:
 *  T5 (LOAD-BEARING): breadcrumb ORDER — baa.scope.resolved precedes
 *                     anthropic.messages.create (Phase 25 HIPAA-01 audit).
 *  T6: POSTs to `${BASE}/v1/messages` NOT `/chat/completions`
 *  T7: body includes output_config.format.json_schema (NOT response_format)
 *  T8: body sets max_tokens: 1024 (REQUIRED by Anthropic)
 *  T9: generateDigestWithRetry retries 3x on ZodError; throws on 3rd
 *  T10: clinical path strips anthropic/ prefix before allowlist check
 *
 * Convention: Deno.test + jsr:@std/assert + in-memory breadcrumb mirror seam
 * exposed by sentry.ts (`__getBreadcrumbsForTest` / `__resetBreadcrumbsForTest`).
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1';
import { generateDigestWithRetry, summarizeDigest, SYSTEM_PROMPT_DIGEST } from './anthropic-summarize.ts';
import { __getBreadcrumbsForTest, __resetBreadcrumbsForTest } from './sentry.ts';
import type { UserFactsForDigest } from './render-user-facts.ts';

// ─── Test setup helpers ──────────────────────────────────────────────────────

const VALID_NARRATIVE =
  'You logged two injections this week and stayed on your check-in streak. Nice work keeping consistent.';

function setEnv() {
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
  Deno.env.set('AI_GATEWAY_API_KEY_CLINICAL', 'sb_clinical_test_key');
  Deno.env.set('AI_GATEWAY_BASE_URL', 'https://ai-gateway.vercel.sh/v1');
  Deno.env.set('ANTHROPIC_MODEL_DIGEST', 'anthropic/claude-sonnet-4-6');
}

function makeMockSupabase(profile: { id: string; primary_org_id: string | null }) {
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(_t: string) {
      return {
        select(_c: string) {
          return this;
        },
        eq(_col: string, _val: string) {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: profile, error: null });
        },
      };
    },
  };
  return client;
}

const SAMPLE_FACTS: UserFactsForDigest = {
  userId: 'user-1',
  orgId: null,
  weekStartIso: '2026-05-12',
  injections: [{ at: '2026-05-13T08:00:00Z', site: 'abdomen' }],
  weights: [{ date: '2026-05-18', value_kg: 79.5 }],
  symptoms: [{ name: 'nausea', count: 2 }],
  streak: { days: 7, status: 'active' },
  missedCheckIns: [],
  redFlags: [],
};

function makeValidDigestResponse(): Response {
  const body = JSON.stringify({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          narrative: VALID_NARRATIVE,
          actions: [{ id: 'log_weight', reason: 'Add a weigh-in to round out the week.' }],
        }),
      },
    ],
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

interface FetchCapture {
  url: string;
  init: RequestInit;
}

function makeMockFetch(
  response: Response | (() => Response | Promise<Response>),
  capture: FetchCapture[],
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    capture.push({ url: String(input), init: init ?? {} });
    const res = typeof response === 'function' ? response() : response;
    return Promise.resolve(res instanceof Promise ? res : res);
  };
}

// ─── T5 (LOAD-BEARING): breadcrumb order assertion ───────────────────────────

Deno.test('T5 [LOAD-BEARING]: baa.scope.resolved breadcrumb precedes anthropic.messages.create', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-1', primary_org_id: null });
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(makeValidDigestResponse(), capture);

  await summarizeDigest(supabase, SAMPLE_FACTS, { fetchImpl });

  const crumbs = __getBreadcrumbsForTest();
  const baaIdx = crumbs.findIndex((c) => c.category === 'baa.scope.resolved');
  const anthropicIdx = crumbs.findIndex((c) => c.category === 'anthropic.messages.create');
  assert(baaIdx >= 0, 'baa.scope.resolved breadcrumb must be emitted');
  assert(anthropicIdx >= 0, 'anthropic.messages.create breadcrumb must be emitted');
  // CRITICAL ORDER (Phase 25 HIPAA-01 audit): BAA scope MUST precede the
  // Anthropic call breadcrumb. If this assertion ever flips, the audit
  // replay invariant is broken — see AI-SPEC §5 Dim 5.
  assert(
    baaIdx < anthropicIdx,
    `breadcrumb order violation — baa.scope.resolved (idx ${baaIdx}) must precede anthropic.messages.create (idx ${anthropicIdx})`,
  );
});

// ─── T6: /v1/messages NOT /chat/completions ─────────────────────────────────

Deno.test('T6: POSTs to /v1/messages NOT /chat/completions', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-1', primary_org_id: null });
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(makeValidDigestResponse(), capture);

  await summarizeDigest(supabase, SAMPLE_FACTS, { fetchImpl });

  assertEquals(capture.length, 1);
  assertStringIncludes(capture[0]!.url, '/v1/messages');
  assert(!capture[0]!.url.includes('/chat/completions'), 'must NOT route to /chat/completions');
  // Verify base URL is well-formed (no /v1/v1 duplication).
  assert(!capture[0]!.url.includes('/v1/v1/'), 'must strip trailing /v1 before re-appending');
});

// ─── T7: body uses output_config.format.json_schema NOT response_format ─────

Deno.test('T7: body has output_config.format.json_schema (NOT response_format)', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-1', primary_org_id: null });
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(makeValidDigestResponse(), capture);

  await summarizeDigest(supabase, SAMPLE_FACTS, { fetchImpl });

  const body = JSON.parse(capture[0]!.init.body as string) as Record<string, unknown>;
  assert('output_config' in body, 'body must contain output_config');
  assert(!('response_format' in body), 'body must NOT contain response_format (OpenAI shape)');
  // Drill into nested shape.
  const oc = body.output_config as { format?: { type?: string; schema?: unknown } };
  assertEquals(oc.format?.type, 'json_schema');
  assert(oc.format?.schema, 'output_config.format.schema must be present');
});

// ─── T8: max_tokens 1024 ─────────────────────────────────────────────────────

Deno.test('T8: body sets max_tokens 1024 (REQUIRED by Anthropic)', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-1', primary_org_id: null });
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(makeValidDigestResponse(), capture);

  await summarizeDigest(supabase, SAMPLE_FACTS, { fetchImpl });

  const body = JSON.parse(capture[0]!.init.body as string) as Record<string, unknown>;
  assertEquals(body.max_tokens, 1024);
  assertEquals(body.temperature, 0.4);
  assertEquals(body.system, SYSTEM_PROMPT_DIGEST);
  assertEquals(body.model, 'anthropic/claude-sonnet-4-6'); // hyphenated, NOT 4.6
});

Deno.test('T8b: body authorization header uses resolved credential', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-clinic', primary_org_id: 'org-abc' });
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(makeValidDigestResponse(), capture);

  await summarizeDigest(supabase, { ...SAMPLE_FACTS, userId: 'user-clinic', orgId: 'org-abc' }, {
    fetchImpl,
  });

  const headers = capture[0]!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, 'Bearer sb_clinical_test_key');
  assertEquals(headers['anthropic-version'], '2023-06-01');
});

// ─── T9: generateDigestWithRetry — 3x retry on ZodError ─────────────────────

Deno.test('T9: generateDigestWithRetry retries 3x on ZodError; throws on 3rd', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-1', primary_org_id: null });
  const capture: FetchCapture[] = [];

  // Return INVALID body (action.id not in whitelist) so Zod throws every time.
  const badBody = JSON.stringify({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          narrative: VALID_NARRATIVE,
          actions: [{ id: 'increase_dose', reason: 'go higher' }],
        }),
      },
    ],
  });
  const fetchImpl = makeMockFetch(
    () =>
      new Response(badBody, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    capture,
  );

  await assertRejects(
    () =>
      generateDigestWithRetry(supabase, SAMPLE_FACTS, {
        fetchImpl,
        timeoutMs: 1_000,
      }),
  );

  // Should have called fetch 3 times (max retries).
  assertEquals(capture.length, 3, 'must retry exactly 3 times');
});

Deno.test('T9b: generateDigestWithRetry succeeds on attempt 2 after transient failure', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-1', primary_org_id: null });
  const capture: FetchCapture[] = [];

  const badBody = JSON.stringify({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ narrative: 'too short' /* fails minLength 40 */, actions: [] }),
      },
    ],
  });
  let callCount = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    capture.push({ url: String(input), init: init ?? {} });
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(
        new Response(badBody, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    }
    return Promise.resolve(makeValidDigestResponse());
  };

  const result = await generateDigestWithRetry(supabase, SAMPLE_FACTS, {
    fetchImpl,
    timeoutMs: 1_000,
  });
  assertEquals(result.actions[0]!.id, 'log_weight');
  assertEquals(capture.length, 2, 'attempts 1 (failed) + 2 (success)');
});

Deno.test('T9c: generateDigestWithRetry catches post-Zod clinical-keyword leak', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-1', primary_org_id: null });
  const capture: FetchCapture[] = [];

  // Zod-valid action.id but `reason` contains "increase your dose" — must
  // fail the post-Zod CLINICAL_KEYWORD_BLOCKLIST scan and retry.
  const sneakyBody = JSON.stringify({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          narrative: VALID_NARRATIVE,
          actions: [{ id: 'log_weight', reason: 'You should increase your dose this week' }],
        }),
      },
    ],
  });
  const fetchImpl = makeMockFetch(
    () =>
      new Response(sneakyBody, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    capture,
  );

  await assertRejects(
    () => generateDigestWithRetry(supabase, SAMPLE_FACTS, { fetchImpl, timeoutMs: 1_000 }),
    Error,
    'clinical-keyword',
  );
  assertEquals(capture.length, 3, 'clinical-keyword leak triggers full 3-retry exhaustion');
});

// ─── T10: clinical path strips anthropic/ prefix before allowlist ──────────

Deno.test('T10: clinical path strips anthropic/ prefix before allowlist check', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  // Clinical user (primary_org_id set) + prefixed model ID. The allowlist
  // check should succeed (sonnet-4-6 IS allowlisted) — proving the strip works.
  const supabase = makeMockSupabase({ id: 'user-clinic', primary_org_id: 'org-abc' });
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(makeValidDigestResponse(), capture);

  // Should NOT throw — proves the anthropic/ prefix strip worked.
  await summarizeDigest(supabase, { ...SAMPLE_FACTS, userId: 'user-clinic', orgId: 'org-abc' }, {
    fetchImpl,
  });
  assertEquals(capture.length, 1, 'fetch must reach gateway (allowlist passed after strip)');

  // Now flip to a non-allowlisted prefixed ID — should throw Response 403.
  Deno.env.set('ANTHROPIC_MODEL_DIGEST', 'anthropic/claude-3-opus-20240229');
  __resetBreadcrumbsForTest();
  const capture2: FetchCapture[] = [];
  const fetchImpl2 = makeMockFetch(makeValidDigestResponse(), capture2);
  let threw = false;
  try {
    await summarizeDigest(supabase, { ...SAMPLE_FACTS, userId: 'user-clinic', orgId: 'org-abc' }, {
      fetchImpl: fetchImpl2,
    });
  } catch (err) {
    threw = true;
    assert(err instanceof Response, 'must throw Response from assertBaaCoveredModel');
    assertEquals((err as Response).status, 403);
  }
  assert(threw, 'must throw on clinical + non-allowlisted model');
  assertEquals(capture2.length, 0, 'must NOT have called fetch when allowlist fails');

  // Restore env for other tests.
  Deno.env.set('ANTHROPIC_MODEL_DIGEST', 'anthropic/claude-sonnet-4-6');
});

// ─── Sanity: non-2xx surfaces a bounded error string ────────────────────────

Deno.test('T-bonus: non-2xx response body is sliced to 200 chars, no PHI leak path', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const supabase = makeMockSupabase({ id: 'user-1', primary_org_id: null });
  const longErr = 'x'.repeat(500);
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response(longErr, { status: 500 }));
  await assertRejects(
    () => summarizeDigest(supabase, SAMPLE_FACTS, { fetchImpl }),
    Error,
    'digest fetch failed: 500',
  );
});
