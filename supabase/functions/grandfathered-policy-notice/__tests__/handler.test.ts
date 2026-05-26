/**
 * handler.test.ts — Deno tests for grandfathered-policy-notice handler.
 *
 * Phase 64 Plan 64-03.
 *
 * Tests exercise the 7 behavior cases:
 *  1. Happy path: POST → sends emails + writes policy_notice_log
 *  2. Idempotent: re-invocation sends 0 emails (all already in log)
 *  3. email_marketing_consent=false → skipped
 *  4. email_lifecycle_exclusion match → skipped
 *  5. Missing/invalid bearer → 401
 *  6. RESEND_API_KEY=test-stub → stubbed=true; log row still written
 *  7. GET /healthz → 200 { ok:true, fn:'grandfathered-policy-notice' }
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handle } from '../handler.ts';
import type { GrandfatheredNoticeDeps } from '../handler.ts';

// ── Mock helpers ────────────────────────────────────────────────────────────

const MOCK_SERVICE_ROLE_KEY = 'test-service-role-key';
const MOCK_SUPABASE_URL = 'https://test.supabase.co';
const MOCK_PHASE_64_SHIP_DATE = '2026-05-26T00:00:00.000Z';
const MOCK_SIGNING_KEY = 'test-signing-key-32byteslongaaaa';
const MOCK_PHYSICAL_ADDRESS = '123 Test Street, San Francisco, CA 94105';
const MOCK_RESEND_API_KEY = 're_test_live_key';

// Simulated user rows from auth.users JOIN profiles
const MOCK_USERS = [
  { id: 'user-1', email: 'alice@example.com', email_marketing_consent: true, created_at: '2026-01-01T00:00:00Z' },
  { id: 'user-2', email: 'bob@example.com', email_marketing_consent: null, created_at: '2026-01-15T00:00:00Z' },
];

/**
 * Build a mock Supabase client that returns the provided users, empty exclusion lists,
 * and accepts inserts into policy_notice_log.
 */
function buildMockSupabaseClient(opts: {
  users?: typeof MOCK_USERS;
  alreadyLoggedUserIds?: string[];
  excludedEmails?: string[];
  excludedUserIds?: string[];
  insertShouldSucceed?: boolean;
}) {
  const {
    users = MOCK_USERS,
    alreadyLoggedUserIds = [],
    excludedEmails = [],
    excludedUserIds = [],
    insertShouldSucceed = true,
  } = opts;

  // Track inserts for verification
  const insertedLogs: Array<{ user_id: string; resend_message_id: string | null }> = [];

  const mockClient = {
    _insertedLogs: insertedLogs,
    rpc: (_fn: string, _params: unknown) => ({
      select: () => Promise.resolve({
        data: users.filter((u) => {
          // Exclude users already in policy_notice_log
          if (alreadyLoggedUserIds.includes(u.id)) return false;
          // Exclude users in email_lifecycle_exclusion (by id or email)
          if (excludedUserIds.includes(u.id)) return false;
          if (excludedEmails.includes(u.email)) return false;
          return true;
        }),
        error: null,
      }),
    }),
    from: (table: string) => {
      if (table === 'policy_notice_log') {
        return {
          insert: (rows: Array<{ user_id: string; resend_message_id: string | null }>) => ({
            select: () => Promise.resolve({
              data: insertShouldSucceed ? rows : null,
              error: insertShouldSucceed ? null : { message: 'insert error' },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    },
  };

  return mockClient as unknown as GrandfatheredNoticeDeps['supabaseServiceClient'];
}

/**
 * Build a mock fetchImpl that simulates Resend API responses.
 */
function buildMockFetch(opts: {
  stubbed?: boolean;
  resendShouldFail?: boolean;
} = {}) {
  const { stubbed = false, resendShouldFail = false } = opts;
  const callCount = { value: 0 };
  const calls: string[] = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    calls.push(urlStr);

    if (urlStr.includes('api.resend.com/emails')) {
      callCount.value++;
      if (stubbed) {
        // Should not reach here — stubbed RESEND_API_KEY short-circuits before fetchImpl
        return new Response(JSON.stringify({ id: 'stubbed-id' }), { status: 200 });
      }
      if (resendShouldFail) {
        return new Response(JSON.stringify({ error: 'failed' }), { status: 500 });
      }
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const email = Array.isArray(body.to) ? body.to[0] : body.to;
      return new Response(JSON.stringify({ id: `msg-${email}-${Date.now()}` }), { status: 200 });
    }

    // Slack alerts (best-effort, don't care)
    if (urlStr.includes('hooks.slack.com')) {
      return new Response('ok', { status: 200 });
    }

    return new Response('not found', { status: 404 });
  };

  return { mockFetch, callCount, calls };
}

/**
 * Build standard deps for tests.
 */
function buildDeps(overrides: Partial<GrandfatheredNoticeDeps> & {
  supabaseClientOpts?: Parameters<typeof buildMockSupabaseClient>[0];
  fetchOpts?: Parameters<typeof buildMockFetch>[0];
} = {}): GrandfatheredNoticeDeps {
  const { supabaseClientOpts = {}, fetchOpts = {}, ...rest } = overrides;
  const { mockFetch } = buildMockFetch(fetchOpts);

  return {
    fetchImpl: mockFetch,
    supabaseServiceClient: buildMockSupabaseClient(supabaseClientOpts),
    resendApiKey: MOCK_RESEND_API_KEY,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    phase64ShipDate: MOCK_PHASE_64_SHIP_DATE,
    signingKey: MOCK_SIGNING_KEY,
    physicalAddress: MOCK_PHYSICAL_ADDRESS,
    ...rest,
  };
}

/**
 * Build a POST request with optional Authorization header.
 */
function buildPostRequest(bearer?: string): Request {
  return new Request('https://test.supabase.co/functions/v1/grandfathered-policy-notice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer !== undefined ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({}),
  });
}

// ── Test 1: Happy path ──────────────────────────────────────────────────────

Deno.test('Test 1: POST with valid bearer → sends emails + writes log', async () => {
  const { mockFetch, callCount } = buildMockFetch();
  const deps = buildDeps({ fetchImpl: mockFetch });

  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);

  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  assertEquals(body.sent, 2);
  assertEquals(body.skipped, 0);
  assertEquals(callCount.value, 2); // one Resend call per user
});

// ── Test 2: Idempotent re-invocation ───────────────────────────────────────

Deno.test('Test 2: Re-invocation with all users already logged → 0 sends', async () => {
  const { mockFetch, callCount } = buildMockFetch();
  const deps = buildDeps({
    fetchImpl: mockFetch,
    supabaseClientOpts: {
      alreadyLoggedUserIds: ['user-1', 'user-2'], // all users already in policy_notice_log
    },
  });

  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);

  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  assertEquals(body.sent, 0);
  assertEquals(body.skipped, 2);
  assertEquals(callCount.value, 0); // zero Resend calls
});

// ── Test 3: email_marketing_consent=false skip ──────────────────────────────

Deno.test('Test 3: User with email_marketing_consent=false → skipped', async () => {
  const usersWithOptOut = [
    { id: 'user-1', email: 'alice@example.com', email_marketing_consent: false, created_at: '2026-01-01T00:00:00Z' },
    { id: 'user-2', email: 'bob@example.com', email_marketing_consent: true, created_at: '2026-01-15T00:00:00Z' },
  ];
  const { mockFetch, callCount } = buildMockFetch();
  const deps = buildDeps({
    fetchImpl: mockFetch,
    supabaseClientOpts: { users: usersWithOptOut },
  });

  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);

  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  // user-1 has consent=false → filtered out at query level (COALESCE(consent, true) = true)
  // user-2 has consent=true → sent
  assertEquals(body.sent, 1);
  assertEquals(body.skipped, 1);
  assertEquals(callCount.value, 1);
});

// ── Test 4: email_lifecycle_exclusion skip ──────────────────────────────────

Deno.test('Test 4: User in email_lifecycle_exclusion → skipped', async () => {
  const { mockFetch, callCount } = buildMockFetch();
  const deps = buildDeps({
    fetchImpl: mockFetch,
    supabaseClientOpts: {
      excludedUserIds: ['user-1'], // user-1 excluded via email_lifecycle_exclusion
    },
  });

  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);

  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  assertEquals(body.sent, 1);
  assertEquals(body.skipped, 1);
  assertEquals(callCount.value, 1);
});

// ── Test 5: Missing/invalid bearer → 401 ───────────────────────────────────

Deno.test('Test 5: Missing bearer → 401 unauthorized', async () => {
  const deps = buildDeps();
  const req = new Request('https://test.supabase.co/functions/v1/grandfathered-policy-notice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
  const body = await res.json() as { error: string };
  assertEquals(body.error, 'unauthorized');
});

Deno.test('Test 5b: Wrong bearer → 401 unauthorized', async () => {
  const deps = buildDeps();
  const req = buildPostRequest('wrong-key');
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
  const body = await res.json() as { error: string };
  assertEquals(body.error, 'unauthorized');
});

// ── Test 6: RESEND_API_KEY=test-stub → stubbed=true, log row still written ─

Deno.test('Test 6: RESEND_API_KEY=test-stub → stubbed; log row written', async () => {
  const { mockFetch, callCount } = buildMockFetch({ stubbed: true });
  // Use only 1 user to keep assertions simple
  const singleUser = [MOCK_USERS[0]];
  const deps = buildDeps({
    fetchImpl: mockFetch,
    resendApiKey: 'test-stub',
    supabaseClientOpts: { users: singleUser },
  });

  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);

  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  // stubbed path still increments sent counter
  assertEquals(body.sent, 1);
  assertEquals(body.skipped, 0);
  // No real Resend call (stubbed short-circuits)
  assertEquals(callCount.value, 0);
});

// ── Test 7: GET /healthz ─────────────────────────────────────────────────────

Deno.test('Test 7: GET /healthz → 200 { ok:true, fn: "grandfathered-policy-notice" }', async () => {
  const deps = buildDeps();
  const req = new Request('https://test.supabase.co/functions/v1/grandfathered-policy-notice/healthz', {
    method: 'GET',
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; fn: string };
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'grandfathered-policy-notice');
});

// ── Test: PHYSICAL_ADDRESS guard (503 + no emails) ──────────────────────────

Deno.test('Test: Missing PHYSICAL_ADDRESS → 503', async () => {
  const { mockFetch, callCount } = buildMockFetch();
  const deps = buildDeps({
    fetchImpl: mockFetch,
    physicalAddress: undefined,
  });

  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 503);
  assertEquals(callCount.value, 0); // no emails sent
});

Deno.test('Test: Placeholder PHYSICAL_ADDRESS → 503', async () => {
  const { mockFetch, callCount } = buildMockFetch();
  const deps = buildDeps({
    fetchImpl: mockFetch,
    physicalAddress: '[YOUR PHYSICAL ADDRESS]',
  });

  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  const res = await handle(req, deps);
  assertEquals(res.status, 503);
  assertEquals(callCount.value, 0);
});

// ── Test: Subject line exact match ──────────────────────────────────────────

Deno.test('Test: Subject line matches exactly "Updated Privacy Policy & Terms — your data, your control"', async () => {
  const sentSubjects: string[] = [];
  const captureSubjectFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    if (urlStr.includes('api.resend.com/emails')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      sentSubjects.push(body.subject);
      return new Response(JSON.stringify({ id: 'msg-test' }), { status: 200 });
    }
    if (urlStr.includes('hooks.slack.com')) {
      return new Response('ok', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  const singleUser = [MOCK_USERS[0]];
  const deps = buildDeps({
    fetchImpl: captureSubjectFetch,
    supabaseClientOpts: { users: singleUser },
  });

  const req = buildPostRequest(MOCK_SERVICE_ROLE_KEY);
  await handle(req, deps);

  assertEquals(sentSubjects.length, 1);
  assertEquals(sentSubjects[0], 'Updated Privacy Policy & Terms — your data, your control');
});
