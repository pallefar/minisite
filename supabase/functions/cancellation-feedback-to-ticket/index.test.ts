/**
 * Phase 40 Plan 40-04 (D-21) — Deno test suite for cancellation-feedback-to-ticket Edge Fn.
 *
 * Coverage:
 *   T1. Missing Bearer → 401 unauthenticated
 *   T2. valid user JWT + reason='service_quality_issue' → RPC called with correct subject+body;
 *       tickets UPDATE called with both tags ['cancellation-feedback', 'sentiment:negative']
 *   T3. reason='too_expensive' → 400 wrong_reason (defensive guard)
 *   T4. reason_other_text > 4000 chars → body truncated to 4000 chars
 *
 * Strategy: uses __internal.setCreateClientForTest to inject a mock supabase client,
 * mirroring the challenge-evaluate-cron pattern from Phase 35. The mock records all
 * rpc() calls and from().update().eq() calls for assertion.
 *
 * CRITICAL (done criterion): no SUPABASE_SERVICE_ROLE_KEY reference in index.ts.
 * This is verified in the plan grep-based done criteria, not in this test.
 */
import { assertEquals } from 'jsr:@std/assert@^1';

// ─── 1. Env vars BEFORE module import ────────────────────────────────────────
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_ANON_KEY', 'test_anon_key');

// ─── 2. Import the module ────────────────────────────────────────────────────
const { __internal } = await import('./index.ts');

// ─── 3. Mock supabase-js client factory ──────────────────────────────────────
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface UpdateCall {
  table: string;
  data: Record<string, unknown>;
  filterId: string | null;
}

const MOCK_TICKET_ID = '00000000-0000-0000-0000-000000000001';

let rpcCalls: RpcCall[] = [];
let updateCalls: UpdateCall[] = [];

function makeMockClient() {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: MOCK_TICKET_ID, error: null });
    },
    from: (table: string) => ({
      update: (data: Record<string, unknown>) => ({
        eq: (_column: string, value: string) => {
          updateCalls.push({ table, data, filterId: value });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
}

function resetMocks(): void {
  rpcCalls = [];
  updateCalls = [];
  // Inject fresh mock client for each test
  __internal.setCreateClientForTest((_url: string, _key: string, _opts?: unknown) => {
    return makeMockClient() as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>;
  });
}

// ─── 4. Helper to build requests ─────────────────────────────────────────────
function makeRequest(
  body: unknown,
  authHeader: string | null = 'Bearer user_jwt_token',
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authHeader !== null) {
    headers['Authorization'] = authHeader;
  }
  return new Request(
    'http://localhost/functions/v1/cancellation-feedback-to-ticket',
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
}

// ─── 5. Tests ────────────────────────────────────────────────────────────────

Deno.test('T1: missing Bearer → 401 unauthenticated', async () => {
  resetMocks();
  const req = makeRequest({ reason: 'service_quality_issue' }, null);
  const res = await __internal.handler(req);
  assertEquals(res.status, 401);
  const json = await res.json() as { error: string };
  assertEquals(json.error, 'unauthenticated');
  assertEquals(rpcCalls.length, 0, 'No RPC should be called on auth failure');
});

Deno.test('T2: valid user JWT + service_quality_issue → RPC + tags UPDATE', async () => {
  resetMocks();
  const req = makeRequest({
    reason: 'service_quality_issue',
    reason_other_text: 'The app crashed repeatedly',
  });
  const res = await __internal.handler(req);
  assertEquals(res.status, 200);
  const json = await res.json() as { ticket_id: string };
  assertEquals(json.ticket_id, MOCK_TICKET_ID);

  // Verify RPC was called with the correct subject and body
  assertEquals(rpcCalls.length >= 1, true, 'Expected at least one RPC call');
  const rpc = rpcCalls[0]!;
  assertEquals(rpc.name, 'create_ticket_with_first_message');
  assertEquals(
    rpc.args['p_subject'],
    'Feedback from cancellation: service quality issue',
    'Subject must match exactly',
  );
  assertEquals(rpc.args['p_body'], 'The app crashed repeatedly');
  assertEquals(rpc.args['p_priority'], 'p3');

  // Verify tickets UPDATE was called with both required tags
  assertEquals(updateCalls.length >= 1, true, 'Expected at least one UPDATE call');
  const upd = updateCalls[0]!;
  assertEquals(upd.table, 'tickets');
  const tags = upd.data['tags'] as string[];
  assertEquals(Array.isArray(tags), true, 'tags must be an array');
  assertEquals(tags.includes('cancellation-feedback'), true, 'Must include cancellation-feedback tag');
  assertEquals(tags.includes('sentiment:negative'), true, 'Must include sentiment:negative tag');
});

Deno.test('T3: reason=too_expensive → 400 wrong_reason', async () => {
  resetMocks();
  const req = makeRequest({ reason: 'too_expensive' });
  const res = await __internal.handler(req);
  assertEquals(res.status, 400);
  const json = await res.json() as { error: string };
  assertEquals(json.error, 'wrong_reason');
  assertEquals(rpcCalls.length, 0, 'No RPC should be called for wrong reason');
});

Deno.test('T4: reason_other_text > 4000 chars → body truncated to ≤4000', async () => {
  resetMocks();
  const longText = 'A'.repeat(5000);
  const req = makeRequest({
    reason: 'service_quality_issue',
    reason_other_text: longText,
  });
  const res = await __internal.handler(req);
  assertEquals(res.status, 200);
  assertEquals(rpcCalls.length >= 1, true, 'Expected RPC call');
  const rpc = rpcCalls[0]!;
  const body = rpc.args['p_body'] as string;
  assertEquals(
    body.length <= 4000,
    true,
    `body length ${body.length} should be ≤ 4000 chars (truncated from 5000)`,
  );
});

// ─── 6. Cleanup ──────────────────────────────────────────────────────────────
__internal.resetCreateClientForTest();
