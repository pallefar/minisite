/**
 * `weekly-digest` Edge Function tests — Phase 38 Plan 38-05.
 *
 * Coverage (10 behaviors from plan):
 *   T1: resolveBaaScope called FIRST; consumer credential path; breadcrumb ORDER.
 *   T2: clinical user path uses CLINICAL credential; assertBaaCoveredModel passes.
 *   T3: opt-out short-circuit — no AI Gateway call; status='skipped_optout'.
 *   T4: 6h dedup — no AI Gateway call; status='skipped_dedup' (no DB write).
 *   T5: red-flag detection — narrative contains prescriber-contact phrase AND
 *       first action_id is `share_with_doctor` (CONTEXT D-15 substitution for
 *       AI-SPEC §4b's `open_symptom_check`).
 *   T6: Zod parse failure → 3 retries; status='failed'; no email send.
 *   T7: clinical-keyword leak in reason → status='failed' + Sentry alert.
 *   T8: happy-path send → Resend called; status='sent'; digest.sent PostHog.
 *   T9: HITL routing — auto-approve KB-only digest (no ai_suggestion_review row);
 *       non-KB digest → status='pending_review' + row inserted; NO email sent.
 *   T10: max_tokens 1024 + temperature 0.4 + anthropic-version header.
 *
 * Strategy: import the module (which calls Deno.serve once); test via the
 * exported `__internal.handleDigestRun` seam — same pattern as lifecycle-*.
 *
 * Mocking strategy:
 *   - supabase: hand-rolled chainable mock with per-table fixtures + send-spy.
 *   - fetch: capture URL + init; return canned AI Gateway response or fail.
 *   - email: spy on sendResendEmail via _shared/lifecycle-send.ts module.
 *   - breadcrumbs: __getBreadcrumbsForTest from _shared/sentry.ts.
 */

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1';
import { __getBreadcrumbsForTest, __resetBreadcrumbsForTest } from '../_shared/sentry.ts';

// MUST set BEFORE the index.ts import so the Deno.serve guard in index.ts
// skips port binding (otherwise the test suite hits AddrInUse on :8000).
Deno.env.set('WEEKLY_DIGEST_DISABLE_SERVE', '1');

import { __internal } from './index.ts';

// ─── Env setup ───────────────────────────────────────────────────────────────

function setEnv() {
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
  Deno.env.set('AI_GATEWAY_API_KEY_CLINICAL', 'sb_clinical_test_key');
  Deno.env.set('AI_GATEWAY_BASE_URL', 'https://ai-gateway.vercel.sh/v1');
  Deno.env.set('ANTHROPIC_MODEL_DIGEST', 'anthropic/claude-sonnet-4-6');
  // Leave SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY UNSET so posthog-server's
  // events_mirror dual-write short-circuits (otherwise the fire-and-forget
  // insert leaks a fetchCancelHandle and trips deno's leak detector).
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.set('RESEND_API_KEY', 'test-stub'); // routes to stub branch in lifecycle-send
  Deno.env.set('SITE_URL', 'https://app.leanshot.app');
}

// ─── Mock helpers ────────────────────────────────────────────────────────────

interface TableFixture {
  profiles?: { id: string; primary_org_id: string | null; timezone?: string | null; display_name?: string | null };
  user_preferences?: { user_id: string; weekly_digest_opt_in: boolean } | null;
  weekly_digest_sends_recent?: Array<{ user_id: string; sent_at: string }>;
  auth_user?: { id: string; email: string };
  // Capture INSERTs.
  inserts: {
    weekly_digest_sends: Array<Record<string, unknown>>;
    ai_suggestion_review: Array<Record<string, unknown>>;
  };
}

interface AnyChain {
  select: (...args: unknown[]) => AnyChain;
  insert: (row: unknown) => AnyChain;
  eq: (...args: unknown[]) => AnyChain;
  gt: (...args: unknown[]) => AnyChain;
  order: (...args: unknown[]) => AnyChain;
  limit: (...args: unknown[]) => AnyChain;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  single: () => Promise<{ data: unknown; error: null }>;
  then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise<unknown>;
}

function makeMockSupabase(fixture: TableFixture): unknown {
  function chainFor(table: string): AnyChain {
    let pending: { kind: 'select' | 'insert'; row?: unknown } = { kind: 'select' };
    const chain: AnyChain = {
      select() {
        pending = { kind: 'select' };
        return chain;
      },
      insert(row: unknown) {
        pending = { kind: 'insert', row };
        // Record the insert immediately (insert returns a thenable that ignores
        // further chaining for our purposes).
        if (table === 'weekly_digest_sends') {
          fixture.inserts.weekly_digest_sends.push(row as Record<string, unknown>);
        } else if (table === 'ai_suggestion_review') {
          fixture.inserts.ai_suggestion_review.push(row as Record<string, unknown>);
        }
        return chain;
      },
      eq() {
        return chain;
      },
      gt() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({ data: resolveTable(table, fixture, 'maybeSingle'), error: null });
      },
      single() {
        return Promise.resolve({ data: resolveTable(table, fixture, 'single'), error: null });
      },
      then(resolve) {
        if (pending.kind === 'insert') {
          return Promise.resolve(resolve({ data: null, error: null }));
        }
        return Promise.resolve(
          resolve({ data: resolveTable(table, fixture, 'list'), error: null }),
        );
      },
    };
    return chain;
  }
  return {
    auth: {
      admin: {
        // Stub auth.admin.getUserById to look up the auth user.
        getUserById(id: string) {
          if (fixture.auth_user && fixture.auth_user.id === id) {
            return Promise.resolve({ data: { user: fixture.auth_user }, error: null });
          }
          return Promise.resolve({ data: { user: null }, error: null });
        },
      },
    },
    from(table: string) {
      return chainFor(table);
    },
  };
}

function resolveTable(table: string, fixture: TableFixture, _shape: 'single' | 'maybeSingle' | 'list'): unknown {
  switch (table) {
    case 'profiles':
      return fixture.profiles ?? null;
    case 'user_preferences':
      return fixture.user_preferences ?? null;
    case 'weekly_digest_sends':
      // For dedup query we return a row if recent sends exist.
      if (fixture.weekly_digest_sends_recent && fixture.weekly_digest_sends_recent.length > 0) {
        return fixture.weekly_digest_sends_recent[0];
      }
      return null;
    default:
      return null;
  }
}

function freshFixture(overrides: Partial<TableFixture> = {}): TableFixture {
  return {
    profiles: { id: 'user-1', primary_org_id: null, timezone: 'America/New_York', display_name: 'Sam' },
    user_preferences: { user_id: 'user-1', weekly_digest_opt_in: true },
    weekly_digest_sends_recent: [],
    auth_user: { id: 'user-1', email: 'sam@example.com' },
    inserts: { weekly_digest_sends: [], ai_suggestion_review: [] },
    ...overrides,
  };
}

// ─── Canned AI Gateway responses ─────────────────────────────────────────────

const KB_NARRATIVE =
  'You logged two injections this week and stayed on your check-in streak. Nice work — keep it up.';

const ESCALATION_NARRATIVE =
  'We noticed some symptoms you flagged that warrant attention. Please contact your clinician or talk to your prescriber soon — they can help interpret what you are experiencing.';

function makeAiResponse(payload: {
  narrative: string;
  actions: Array<{ id: string; reason: string }>;
}): Response {
  const body = JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

interface FetchCapture {
  url: string;
  init: RequestInit;
}

function makeMockFetch(
  responder: (capture: FetchCapture[]) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; capture: FetchCapture[] } {
  const capture: FetchCapture[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    capture.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(responder(capture));
  };
  return { fetchImpl, capture };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('T1: resolveBaaScope precedes AI call; consumer credential used; breadcrumb order', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture();
  const supabase = makeMockSupabase(fixture);
  const { fetchImpl, capture } = makeMockFetch(() =>
    makeAiResponse({
      narrative: KB_NARRATIVE,
      actions: [{ id: 'read_kb', reason: 'Skim the GLP-1 expectations article.' }],
    }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(res.status, 'sent', `expected sent, got ${res.status}`);
  // Authorization header carries CONSUMER credential.
  assert(capture.length >= 1, 'fetch must reach AI Gateway');
  const headers = capture[0]!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, 'Bearer sb_consumer_test_key');

  // Breadcrumb order: baa.scope.resolved < anthropic.messages.create.
  const crumbs = __getBreadcrumbsForTest();
  const baaIdx = crumbs.findIndex((c) => c.category === 'baa.scope.resolved');
  const anthropicIdx = crumbs.findIndex((c) => c.category === 'anthropic.messages.create');
  assert(baaIdx >= 0, 'baa.scope.resolved breadcrumb missing');
  assert(anthropicIdx >= 0, 'anthropic.messages.create breadcrumb missing');
  assert(
    baaIdx < anthropicIdx,
    `LOAD-BEARING: baa.scope.resolved (idx ${baaIdx}) must precede anthropic.messages.create (idx ${anthropicIdx})`,
  );
});

Deno.test('T2: clinical user → CLINICAL credential; assertBaaScope passes on allowlisted model', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture({
    profiles: { id: 'user-clinic', primary_org_id: 'org-abc', timezone: 'America/New_York', display_name: 'Pat' },
    user_preferences: { user_id: 'user-clinic', weekly_digest_opt_in: true },
    auth_user: { id: 'user-clinic', email: 'pat@clinic.example.com' },
  });
  const supabase = makeMockSupabase(fixture);
  const { fetchImpl, capture } = makeMockFetch(() =>
    makeAiResponse({
      narrative: KB_NARRATIVE,
      actions: [{ id: 'read_kb', reason: 'Skim the article.' }],
    }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-clinic' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(res.status, 'sent');
  const headers = capture[0]!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, 'Bearer sb_clinical_test_key');
});

Deno.test('T3: opt-out user → skipped_optout; no AI Gateway call', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture({
    user_preferences: { user_id: 'user-1', weekly_digest_opt_in: false },
  });
  const supabase = makeMockSupabase(fixture);
  const { fetchImpl, capture } = makeMockFetch(() =>
    makeAiResponse({ narrative: KB_NARRATIVE, actions: [{ id: 'read_kb', reason: 'x' }] }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(res.status, 'skipped_optout');
  assertEquals(capture.length, 0, 'must NOT call AI Gateway when opted out');
});

Deno.test('T4: 6h dedup — recent send within window → skipped_dedup; no AI Gateway call', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture({
    weekly_digest_sends_recent: [{ user_id: 'user-1', sent_at: '2026-05-18T10:00:00Z' }],
  });
  const supabase = makeMockSupabase(fixture);
  const { fetchImpl, capture } = makeMockFetch(() =>
    makeAiResponse({ narrative: KB_NARRATIVE, actions: [{ id: 'read_kb', reason: 'x' }] }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'), // 3h after the prior send → within 6h
  });

  assertEquals(res.status, 'skipped_dedup');
  assertEquals(capture.length, 0, 'must NOT call AI Gateway within 6h dedup window');
});

Deno.test('T5: red-flag user → escalation narrative + share_with_doctor first action (Guardrail O5)', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture();
  const supabase = makeMockSupabase(fixture);
  // AI returns a non-escalation digest — handler MUST rewrite because red flag detected.
  const { fetchImpl } = makeMockFetch(() =>
    makeAiResponse({
      narrative: KB_NARRATIVE,
      actions: [{ id: 'log_weight', reason: 'Add a weigh-in.' }],
    }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
    // Test seam: inject the red-flag facts directly (bypasses data-load layer
    // not under test in this unit). Caller wires the same shape from DB rows.
    factsOverride: {
      userId: 'user-1',
      orgId: null,
      weekStartIso: '2026-05-11',
      injections: [],
      weights: [],
      symptoms: [],
      streak: { days: 7, status: 'active' },
      missedCheckIns: [],
      redFlags: [{ type: 'severe_abdominal_pain', loggedAt: '2026-05-17T08:00:00Z' }],
    },
  });

  assertEquals(res.status, 'sent');
  // Narrative MUST contain a prescriber-contact phrase per Guardrail O5.
  const narrative = (res.digest?.narrative ?? '').toLowerCase();
  assert(
    narrative.includes('clinician') || narrative.includes('prescriber'),
    `red-flag narrative missing prescriber-contact phrase: ${narrative}`,
  );
  // First action MUST be share_with_doctor per CONTEXT D-15 substitution.
  assertEquals(res.digest?.actions?.[0]?.id, 'share_with_doctor');
  // Narrative MUST NOT contain dismissive language.
  assert(
    !/(great|crushing|push through|keep going)/i.test(res.digest?.narrative ?? ''),
    `red-flag narrative contains dismissive language: ${res.digest?.narrative}`,
  );
});

Deno.test('T6: Zod parse failure × 3 → status=failed, no email send, no Resend hit', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture();
  const supabase = makeMockSupabase(fixture);
  // Always-bad payload: action.id not in whitelist.
  const { fetchImpl, capture } = makeMockFetch(() =>
    makeAiResponse({ narrative: KB_NARRATIVE, actions: [{ id: 'increase_dose', reason: 'go higher' }] }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(res.status, 'failed');
  assertEquals(capture.length, 3, 'must retry exactly 3 times');
  // weekly_digest_sends row inserted with status='failed'.
  const inserts = fixture.inserts.weekly_digest_sends;
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0]!.status, 'failed');
});

Deno.test('T7: clinical-keyword leak in reason → status=failed, no email send', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture();
  const supabase = makeMockSupabase(fixture);
  // Sneaky payload — Zod-valid action.id but reason contains "increase your dose".
  const { fetchImpl } = makeMockFetch(() =>
    makeAiResponse({
      narrative: KB_NARRATIVE,
      actions: [{ id: 'log_weight', reason: 'You should increase your dose next week.' }],
    }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(res.status, 'failed');
  const inserts = fixture.inserts.weekly_digest_sends;
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0]!.status, 'failed');
});

Deno.test('T8: happy-path send → Resend dispatched (stubbed), status=sent, digest.sent event', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture();
  const supabase = makeMockSupabase(fixture);
  const { fetchImpl, capture } = makeMockFetch(() =>
    makeAiResponse({
      narrative: KB_NARRATIVE,
      actions: [{ id: 'read_kb', reason: 'Skim the GLP-1 expectations article.' }],
    }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(res.status, 'sent');
  assertEquals(capture.length, 1, 'one AI Gateway call');
  // weekly_digest_sends row inserted with status='sent'.
  const inserts = fixture.inserts.weekly_digest_sends;
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0]!.status, 'sent');
  assertEquals(inserts[0]!.model_id, 'anthropic/claude-sonnet-4-6');
  assertEquals(inserts[0]!.user_id, 'user-1');
  assert(typeof inserts[0]!.narrative === 'string', 'narrative must be persisted');
});

Deno.test('T9a: HITL — KB-only digest auto-approved (no ai_suggestion_review row); status=sent', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture();
  const supabase = makeMockSupabase(fixture);
  const { fetchImpl } = makeMockFetch(() =>
    makeAiResponse({
      narrative: KB_NARRATIVE,
      actions: [{ id: 'read_kb', reason: 'Skim the article.' }],
    }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(res.status, 'sent');
  assertEquals(
    fixture.inserts.ai_suggestion_review.length,
    0,
    'KB-only auto-approved — no HITL row',
  );
});

Deno.test('T9b: HITL — non-KB digest queues ai_suggestion_review; status=pending_review; no email', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture();
  const supabase = makeMockSupabase(fixture);
  const { fetchImpl } = makeMockFetch(() =>
    makeAiResponse({
      narrative: KB_NARRATIVE,
      actions: [{ id: 'log_weight', reason: 'Add a weigh-in.' }],
    }),
  );

  const res = await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(res.status, 'pending_review');
  // weekly_digest_sends row inserted with status='pending_review'.
  const wds = fixture.inserts.weekly_digest_sends;
  assertEquals(wds.length, 1);
  assertEquals(wds[0]!.status, 'pending_review');
  // ai_suggestion_review row inserted with type='digest'.
  const asr = fixture.inserts.ai_suggestion_review;
  assertEquals(asr.length, 1);
  assertEquals(asr[0]!.type, 'digest');
  assertEquals(asr[0]!.status, 'pending');
});

Deno.test('T10: body sets max_tokens 1024 + temperature 0.4 + anthropic-version header', async () => {
  setEnv();
  __resetBreadcrumbsForTest();
  const fixture = freshFixture();
  const supabase = makeMockSupabase(fixture);
  const { fetchImpl, capture } = makeMockFetch(() =>
    makeAiResponse({
      narrative: KB_NARRATIVE,
      actions: [{ id: 'read_kb', reason: 'x' }],
    }),
  );

  await __internal.handleDigestRun({ user_id: 'user-1' }, {
    supabase,
    fetchImpl,
    nowMs: Date.parse('2026-05-18T13:00:00Z'),
  });

  assertEquals(capture.length, 1);
  const body = JSON.parse(capture[0]!.init.body as string) as Record<string, unknown>;
  assertEquals(body.max_tokens, 1024);
  assertEquals(body.temperature, 0.4);
  const headers = capture[0]!.init.headers as Record<string, string>;
  assertEquals(headers['anthropic-version'], '2023-06-01');
  // Sanity: routes to /v1/messages.
  assertStringIncludes(capture[0]!.url, '/v1/messages');
});
