/**
 * handler.test.ts — Deno tests for stripe-dunning-orchestrator handler.
 *
 * Phase 65 Plan 65-05.
 *
 * Tests exercise these behavior cases:
 *  1. GET /healthz returns 200 without bearer
 *  2. POST / without bearer returns 401
 *  3. POST / with wrong bearer returns 401 (constant-time)
 *  4. POST / with PHYSICAL_ADDRESS=undefined returns 503
 *  5. POST / with placeholder PHYSICAL_ADDRESS returns 503
 *  6. POST / sends N emails for N actionable rows in first_failed state
 *  7. POST / returns skipped on composite-PK conflict (already sent)
 *  8. POST / honors email_marketing_consent=false (skipped)
 *  9. POST / on Resend 500 rolls back insert + records error
 * 10. POST / sets last_dunning_email_at=now() on success
 * 11. POST / uses correct stage template (first/second/final) per dunning_state
 * 12. POST / RESEND_API_KEY=test-stub → stubbed path increments sent
 * 13. POST / no candidates → returns sent:0, skipped:0, errors:[]
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handle } from '../handler.ts';
import type { DunningOrchestratorDeps } from '../handler.ts';

// ── Mock constants ──────────────────────────────────────────────────────────

const MOCK_SERVICE_ROLE_KEY = 'test-service-role-key';
const MOCK_SUPABASE_URL = 'https://test.supabase.co';
const MOCK_SIGNING_KEY = 'test-signing-key-32byteslongaaaa';
const MOCK_PHYSICAL_ADDRESS = '123 Test Street, San Francisco, CA 94105';
const MOCK_RESEND_API_KEY = 're_test_live_key';

type Stage = 'first_failed' | 'second_failed' | 'final_warning';

interface FakeRow {
  subscription_id: string;
  user_id: string;
  email: string;
  email_marketing_consent: boolean | null;
  dunning_state: Stage;
  user_first_name: string | null;
}

const ROWS_TWO_FIRST: FakeRow[] = [
  {
    subscription_id: 'sub_1',
    user_id: 'user-1',
    email: 'alice@example.com',
    email_marketing_consent: true,
    dunning_state: 'first_failed',
    user_first_name: 'Alice',
  },
  {
    subscription_id: 'sub_2',
    user_id: 'user-2',
    email: 'bob@example.com',
    email_marketing_consent: null,
    dunning_state: 'first_failed',
    user_first_name: 'Bob',
  },
];

// ── Mock Supabase client builder ────────────────────────────────────────────

interface MockState {
  /** subscription_ids that conflict on insert (already sent for that stage) */
  alreadySent: Set<string>;
  /** captured upsert calls */
  upserts: Array<{ subscription_id: string; stage: string }>;
  /** captured update calls on dunning_emails_sent.resend_message_id */
  resendIdUpdates: Array<{ subscription_id: string; stage: string; resend_message_id: string | null }>;
  /** captured update calls on subscriptions.last_dunning_email_at */
  subUpdates: Array<{ subscription_id: string; ts: string }>;
  /** captured deletes on dunning_emails_sent (rollback) */
  rollbacks: Array<{ subscription_id: string; stage: string }>;
}

function buildMockSupabaseClient(opts: {
  rows: FakeRow[];
  alreadySent?: string[];
  rpcError?: boolean;
}) {
  const state: MockState = {
    alreadySent: new Set(opts.alreadySent ?? []),
    upserts: [],
    resendIdUpdates: [],
    subUpdates: [],
    rollbacks: [],
  };

  const mockClient = {
    rpc: (_fn: string, _params: unknown) => ({
      select: () =>
        Promise.resolve({
          data: opts.rpcError ? null : opts.rows,
          error: opts.rpcError ? { message: 'db_error' } : null,
        }),
    }),
    from: (table: string) => {
      if (table === 'dunning_emails_sent') {
        return makeDunningEmailsSentTable(state);
      }
      if (table === 'subscriptions') {
        return makeSubscriptionsTable(state);
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      };
    },
  };

  return { client: mockClient as unknown as DunningOrchestratorDeps['supabaseServiceClient'], state };
}

function makeDunningEmailsSentTable(state: MockState) {
  let pendingUpdate: { resend_message_id: string | null } | null = null;
  let pendingDelete = false;
  let chainSubId: string | null = null;
  let chainStage: string | null = null;

  const chain = {
    upsert: (
      row: { subscription_id: string; stage: string; sent_at: string; resend_message_id: string | null },
      _opts: unknown,
    ) => ({
      select: () => {
        state.upserts.push({ subscription_id: row.subscription_id, stage: row.stage });
        // ON CONFLICT DO NOTHING → empty data on conflict
        if (state.alreadySent.has(row.subscription_id)) {
          return Promise.resolve({ data: [], error: null });
        }
        state.alreadySent.add(row.subscription_id);
        return Promise.resolve({ data: [row], error: null });
      },
    }),
    update: (patch: { resend_message_id: string | null }) => {
      pendingUpdate = patch;
      pendingDelete = false;
      return chain;
    },
    delete: () => {
      pendingDelete = true;
      pendingUpdate = null;
      return chain;
    },
    eq: (col: string, val: string) => {
      if (col === 'subscription_id') chainSubId = val;
      if (col === 'stage') chainStage = val;
      // Resolve after the second .eq() in the (subscription_id, stage) chain.
      if (chainSubId && chainStage) {
        if (pendingUpdate) {
          state.resendIdUpdates.push({
            subscription_id: chainSubId,
            stage: chainStage,
            resend_message_id: pendingUpdate.resend_message_id,
          });
          pendingUpdate = null;
        } else if (pendingDelete) {
          state.rollbacks.push({ subscription_id: chainSubId, stage: chainStage });
          pendingDelete = false;
        }
        chainSubId = null;
        chainStage = null;
        return Promise.resolve({ data: null, error: null });
      }
      return chain;
    },
  };

  return chain;
}

function makeSubscriptionsTable(state: MockState) {
  let pendingTs: string | null = null;

  const chain = {
    update: (patch: { last_dunning_email_at: string }) => {
      pendingTs = patch.last_dunning_email_at;
      return chain;
    },
    eq: (_col: string, val: string) => {
      if (pendingTs) {
        state.subUpdates.push({ subscription_id: val, ts: pendingTs });
        pendingTs = null;
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return chain;
}

// ── Mock fetch builder ──────────────────────────────────────────────────────

interface FetchOpts {
  resendShouldFail?: boolean;
  resendStatus?: number;
}

function buildMockFetch(opts: FetchOpts = {}) {
  const capturedEmails: Array<{ to: string; subject: string; html: string; text: string }> = [];

  const mockFetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr = url.toString();

    if (urlStr.includes('api.resend.com/emails')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      capturedEmails.push({
        to: Array.isArray(body.to) ? body.to[0] : body.to,
        subject: body.subject,
        html: body.html,
        text: body.text,
      });
      if (opts.resendShouldFail) {
        return new Response(JSON.stringify({ error: 'failed' }), {
          status: opts.resendStatus ?? 500,
        });
      }
      return new Response(
        JSON.stringify({ id: `msg-${capturedEmails.length}` }),
        { status: 200 },
      );
    }

    if (urlStr.includes('hooks.slack.com')) {
      return new Response('ok', { status: 200 });
    }

    return new Response('not found', { status: 404 });
  };

  return { mockFetch, capturedEmails };
}

// ── Deps builder ────────────────────────────────────────────────────────────

function buildDeps(overrides: Partial<DunningOrchestratorDeps> & {
  rows?: FakeRow[];
  alreadySent?: string[];
  rpcError?: boolean;
  fetchOpts?: FetchOpts;
} = {}) {
  const {
    rows = ROWS_TWO_FIRST,
    alreadySent = [],
    rpcError = false,
    fetchOpts = {},
    ...rest
  } = overrides;

  const { client, state } = buildMockSupabaseClient({ rows, alreadySent, rpcError });
  const { mockFetch, capturedEmails } = buildMockFetch(fetchOpts);

  const deps: DunningOrchestratorDeps = {
    fetchImpl: mockFetch,
    supabaseServiceClient: client,
    resendApiKey: MOCK_RESEND_API_KEY,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    signingKey: MOCK_SIGNING_KEY,
    physicalAddress: MOCK_PHYSICAL_ADDRESS,
    ...rest,
  };

  return { deps, state, capturedEmails };
}

function buildPostRequest(bearer?: string): Request {
  return new Request(
    'https://test.supabase.co/functions/v1/stripe-dunning-orchestrator',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer !== undefined ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({}),
    },
  );
}

// ── Test 1: GET /healthz ────────────────────────────────────────────────────

Deno.test('Test 1: GET /healthz returns 200 without bearer', async () => {
  const { deps } = buildDeps();
  const req = new Request(
    'https://test.supabase.co/functions/v1/stripe-dunning-orchestrator/healthz',
    { method: 'GET' },
  );
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; fn: string };
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'stripe-dunning-orchestrator');
});

// ── Test 2: POST without bearer ─────────────────────────────────────────────

Deno.test('Test 2: POST / without bearer returns 401', async () => {
  const { deps } = buildDeps();
  const req = new Request(
    'https://test.supabase.co/functions/v1/stripe-dunning-orchestrator',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
  const body = await res.json() as { error: string };
  assertEquals(body.error, 'unauthorized');
});

// ── Test 3: POST with wrong bearer ──────────────────────────────────────────

Deno.test('Test 3: POST / with wrong bearer returns 401 (constant-time)', async () => {
  const { deps } = buildDeps();
  const req = buildPostRequest('not-the-right-key');
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
});

// ── Test 4: PHYSICAL_ADDRESS=undefined → 503 ────────────────────────────────

Deno.test('Test 4: POST / with PHYSICAL_ADDRESS=undefined returns 503', async () => {
  const { deps, capturedEmails } = buildDeps({ physicalAddress: undefined });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 503);
  assertEquals(capturedEmails.length, 0);
  const body = await res.json() as { error: string };
  assertEquals(body.error, 'physical_address_missing_or_placeholder');
});

// ── Test 5: Placeholder PHYSICAL_ADDRESS → 503 ──────────────────────────────

Deno.test('Test 5: POST / with placeholder PHYSICAL_ADDRESS returns 503', async () => {
  const { deps, capturedEmails } = buildDeps({
    physicalAddress: '[YOUR PHYSICAL ADDRESS]',
  });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 503);
  assertEquals(capturedEmails.length, 0);
});

// ── Test 6: Happy path — 2 first_failed rows ────────────────────────────────

Deno.test('Test 6: POST / returns sent:2 when 2 actionable rows in first_failed state', async () => {
  const { deps, capturedEmails } = buildDeps();
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number; errors: unknown[] };
  assertEquals(body.sent, 2);
  assertEquals(body.skipped, 0);
  assertEquals(body.errors.length, 0);
  assertEquals(capturedEmails.length, 2);
});

// ── Test 7: Composite-PK conflict → skipped ─────────────────────────────────

Deno.test('Test 7: POST / returns skipped when row was already sent (composite PK conflict)', async () => {
  const { deps, capturedEmails } = buildDeps({
    alreadySent: ['sub_1'],
  });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number; errors: unknown[] };
  // sub_1 already-sent → skipped; sub_2 fresh → sent
  assertEquals(body.sent, 1);
  assertEquals(body.skipped, 1);
  assertEquals(capturedEmails.length, 1);
  assertEquals(capturedEmails[0].to, 'bob@example.com');
});

// ── Test 8: email_marketing_consent=false → skipped ─────────────────────────

Deno.test('Test 8: POST / honors email_marketing_consent=false (row excluded)', async () => {
  const rows: FakeRow[] = [
    {
      subscription_id: 'sub_1',
      user_id: 'user-1',
      email: 'alice@example.com',
      email_marketing_consent: false,
      dunning_state: 'first_failed',
      user_first_name: 'Alice',
    },
    {
      subscription_id: 'sub_2',
      user_id: 'user-2',
      email: 'bob@example.com',
      email_marketing_consent: true,
      dunning_state: 'first_failed',
      user_first_name: 'Bob',
    },
  ];
  const { deps, capturedEmails } = buildDeps({ rows });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  assertEquals(body.sent, 1);
  assertEquals(body.skipped, 1);
  assertEquals(capturedEmails.length, 1);
  assertEquals(capturedEmails[0].to, 'bob@example.com');
});

// ── Test 9: Resend 500 → rollback + error ───────────────────────────────────

Deno.test('Test 9: POST / on Resend 500 rolls back the dunning_emails_sent insert + records error', async () => {
  const singleRow: FakeRow[] = [ROWS_TWO_FIRST[0]];
  const { deps, state, capturedEmails } = buildDeps({
    rows: singleRow,
    fetchOpts: { resendShouldFail: true, resendStatus: 500 },
  });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as {
    sent: number;
    skipped: number;
    errors: Array<{ subscription_id: string; error: string }>;
  };
  assertEquals(body.sent, 0);
  assertEquals(body.errors.length, 1);
  assertEquals(body.errors[0].subscription_id, 'sub_1');
  assertEquals(body.errors[0].error, 'resend_failed');
  assertEquals(capturedEmails.length, 1);
  // Rollback must have happened.
  assertEquals(state.rollbacks.length, 1);
  assertEquals(state.rollbacks[0].subscription_id, 'sub_1');
  assertEquals(state.rollbacks[0].stage, 'first_failed');
});

// ── Test 10: last_dunning_email_at set on success ───────────────────────────

Deno.test('Test 10: POST / sets last_dunning_email_at=now() on success', async () => {
  const singleRow: FakeRow[] = [ROWS_TWO_FIRST[0]];
  const { deps, state } = buildDeps({ rows: singleRow });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  await handle(req, deps);
  assertEquals(state.subUpdates.length, 1);
  assertEquals(state.subUpdates[0].subscription_id, 'sub_1');
  // Timestamp is an ISO string.
  const parsed = Date.parse(state.subUpdates[0].ts);
  if (Number.isNaN(parsed)) {
    throw new Error(`expected ISO timestamp, got: ${state.subUpdates[0].ts}`);
  }
});

// ── Test 11: Correct stage template per dunning_state ───────────────────────

Deno.test('Test 11: POST / uses the correct stage template (first/second/final) per dunning_state', async () => {
  const stagedRows: FakeRow[] = [
    {
      subscription_id: 'sub_a',
      user_id: 'user-a',
      email: 'a@example.com',
      email_marketing_consent: true,
      dunning_state: 'first_failed',
      user_first_name: 'A',
    },
    {
      subscription_id: 'sub_b',
      user_id: 'user-b',
      email: 'b@example.com',
      email_marketing_consent: true,
      dunning_state: 'second_failed',
      user_first_name: 'B',
    },
    {
      subscription_id: 'sub_c',
      user_id: 'user-c',
      email: 'c@example.com',
      email_marketing_consent: true,
      dunning_state: 'final_warning',
      user_first_name: 'C',
    },
  ];
  const { deps, capturedEmails } = buildDeps({ rows: stagedRows });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  await handle(req, deps);
  assertEquals(capturedEmails.length, 3);
  assertEquals(capturedEmails[0].subject, "We couldn't process your last payment");
  assertEquals(capturedEmails[1].subject, 'Action needed: second payment attempt failed');
  assertEquals(capturedEmails[2].subject, 'Your subscription will be cancelled in 24 hours');
  // Stage-specific copy must be present in each rendered body.
  if (!capturedEmails[0].text.includes('Payment issue')) {
    throw new Error('first_failed text missing "Payment issue"');
  }
  if (!capturedEmails[1].text.includes('Action needed')) {
    throw new Error('second_failed text missing "Action needed"');
  }
  if (!capturedEmails[2].text.includes('Final notice')) {
    throw new Error('final_warning text missing "Final notice"');
  }
});

// ── Test 12: RESEND_API_KEY=test-stub → stubbed ─────────────────────────────

Deno.test('Test 12: POST / RESEND_API_KEY=test-stub → stubbed path increments sent', async () => {
  const singleRow: FakeRow[] = [ROWS_TWO_FIRST[0]];
  const { deps, capturedEmails } = buildDeps({
    rows: singleRow,
    resendApiKey: 'test-stub',
  });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  assertEquals(body.sent, 1);
  assertEquals(body.skipped, 0);
  // Stubbed path does NOT call fetch for Resend.
  assertEquals(capturedEmails.length, 0);
});

// ── Test 13: No candidates → empty response ─────────────────────────────────

Deno.test('Test 13: POST / no candidates → returns sent:0, skipped:0, errors:[]', async () => {
  const { deps, capturedEmails } = buildDeps({ rows: [] });
  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number; errors: unknown[] };
  assertEquals(body.sent, 0);
  assertEquals(body.skipped, 0);
  assertEquals(body.errors.length, 0);
  assertEquals(capturedEmails.length, 0);
});
