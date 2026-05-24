/**
 * Phase 45 Plan 45-04 — Deno tests for dm-create-thread Edge Function.
 *
 * Filename uses dot separator per memory reference_deno_test_discovery.
 *
 * Test plan (T1–T7 from 45-PATTERNS.md):
 *   T1 — Missing bearer → 401 unauthorized
 *   T2 — Rate-limit hit (count returns 3) → 429 rate_limited + Retry-After header
 *   T3 — Recipient has blocked sender (user_block_list row) → 403 blocked
 *   T4 — Verified-clinician bypass: skips rate limit even at count=5, inserts
 *        dm_thread_audit row reason='clinician_bypass'
 *   T5 — Recipient.dm_open=false → 403 dm_closed
 *   T6 — Happy path → 201 { thread_id, message_id }
 *   T7 — Recipient active within 5 min → notify-community NOT called, still 201
 */
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const SERVICE_BEARER = 'test-service-role-key';
const ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEW_THREAD_ID = '11111111-1111-4111-8111-111111111111';
const NEW_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// Fake admin builder
// ---------------------------------------------------------------------------

interface FakeAdminConfig {
  getUserResult?: { id: string } | null;
  getUserError?: { message: string } | null;
  recipientProfile?: {
    dm_open: boolean;
    community_last_active_at: string | null;
    is_clinician_verified: boolean;
    leaderboard_handle: string;
  } | null;
  senderProfile?: {
    is_clinician_verified: boolean;
    leaderboard_handle: string;
  } | null;
  blockedByRecipient?: boolean;
  threadCountIn24h?: number;
  oldestThreadCreatedAt?: string | null;
  threadInsertId?: string;
  messageInsertId?: string;
  // Sinks for side-effect assertions.
  auditInserts?: Array<{ thread_id: string; actor_user_id: string; reason: string }>;
  threadInserts?: Array<Record<string, unknown>>;
  messageInserts?: Array<Record<string, unknown>>;
  threadUpdates?: Array<Record<string, unknown>>;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  const auditInserts = cfg.auditInserts ?? [];
  const threadInserts = cfg.threadInserts ?? [];
  const messageInserts = cfg.messageInserts ?? [];
  const threadUpdates = cfg.threadUpdates ?? [];

  return {
    auth: {
      getUser: (_bearer: string) => {
        if (cfg.getUserError) {
          return Promise.resolve({ data: { user: null }, error: cfg.getUserError });
        }
        if (!cfg.getUserResult) {
          return Promise.resolve({ data: { user: null }, error: { message: 'not_found' } });
        }
        return Promise.resolve({ data: { user: cfg.getUserResult }, error: null });
      },
    },
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      const state: any = {
        table,
        filters: {} as Record<string, unknown>,
        insertedRow: null as unknown,
        updatedRow: null as unknown,
        selectOpts: undefined as unknown,
        order: null as null | { col: string; ascending: boolean },
        limited: null as number | null,
      };

      const chain = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          state.selectOpts = opts;
          return chain;
        },
        insert(row: Record<string, unknown>) {
          state.insertedRow = row;
          if (table === 'dm_threads') threadInserts.push(row);
          if (table === 'direct_messages') messageInserts.push(row);
          if (table === 'dm_thread_audit') {
            auditInserts.push(row as { thread_id: string; actor_user_id: string; reason: string });
          }
          return chain;
        },
        update(row: Record<string, unknown>) {
          state.updatedRow = row;
          if (table === 'dm_threads') threadUpdates.push(row);
          return chain;
        },
        eq(col: string, val: unknown) {
          state.filters[col] = val;
          return chain;
        },
        gte(_col: string, _val: unknown) {
          return chain;
        },
        order(col: string, opts: { ascending: boolean }) {
          state.order = { col, ascending: opts.ascending };
          return chain;
        },
        limit(n: number) {
          state.limited = n;
          return chain;
        },
        single() {
          // Count-only SELECT (head=true) is awaited via `then` not `single`; we ignore here.
          if (table === 'profiles') {
            const id = state.filters['id'];
            if (id === BOB_ID || id === cfg.recipientProfile && id) {
              // Recipient lookup keyed on body.recipient_user_id (BOB by convention).
            }
            if (id === ALICE_ID) {
              return Promise.resolve({
                data: cfg.senderProfile ?? null,
                error: cfg.senderProfile ? null : { message: 'not_found' },
              });
            }
            // Recipient is BOB by convention.
            return Promise.resolve({
              data: cfg.recipientProfile ?? null,
              error: cfg.recipientProfile ? null : { message: 'not_found' },
            });
          }
          if (table === 'dm_threads') {
            // Two paths: thread insert .select('id').single() OR oldest-in-window probe.
            if (state.insertedRow) {
              return Promise.resolve({
                data: { id: cfg.threadInsertId ?? NEW_THREAD_ID },
                error: null,
              });
            }
            if (state.order) {
              // Oldest thread probe for Retry-After calc.
              return Promise.resolve({
                data: cfg.oldestThreadCreatedAt
                  ? { created_at: cfg.oldestThreadCreatedAt }
                  : null,
                error: null,
              });
            }
          }
          if (table === 'direct_messages' && state.insertedRow) {
            return Promise.resolve({
              data: { id: cfg.messageInsertId ?? NEW_MESSAGE_ID },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() {
          if (table === 'user_block_list') {
            return Promise.resolve({
              data: cfg.blockedByRecipient ? { blocker_user_id: BOB_ID } : null,
              error: null,
            });
          }
          if (table === 'dm_threads' && !state.insertedRow) {
            // Existing-thread lookup after UNIQUE conflict — none in tests.
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        // PromiseLike — used for count queries + bare UPDATE awaits.
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          let result: unknown;
          if (
            table === 'dm_threads' && state.selectOpts &&
            (state.selectOpts as { count?: string }).count === 'exact'
          ) {
            // Rate-limit count query.
            result = { count: cfg.threadCountIn24h ?? 0, error: null };
          } else if (table === 'dm_threads' && state.updatedRow) {
            // last_message_at UPDATE — no rows returned.
            result = { data: null, error: null };
          } else {
            result = { data: [], error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

// Tracked notify-community calls
let notifyCalls: Array<{ payload: unknown }> = [];

function installNotifySpy(): void {
  notifyCalls = [];
  __internal.setNotifyCommunityForTest((payload) => {
    notifyCalls.push({ payload });
    return Promise.resolve();
  });
}

function makeReq(body: unknown, opts?: { bearer?: string | null; method?: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = opts?.bearer !== undefined ? opts.bearer : SERVICE_BEARER;
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/functions/v1/dm-create-thread', {
    method: opts?.method ?? 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function happyRecipient(activeAt: string | null = null) {
  return {
    dm_open: true,
    community_last_active_at: activeAt,
    is_clinician_verified: false,
    leaderboard_handle: 'bob_handle',
  };
}
function happySender(clinician = false) {
  return { is_clinician_verified: clinician, leaderboard_handle: 'alice_handle' };
}

// ===========================================================================
// T1 — Missing bearer → 401
// ===========================================================================

Deno.test('T1 — missing bearer returns 401 unauthorized', async () => {
  const req = makeReq(
    { recipient_user_id: BOB_ID, body: 'hi', creator_user_id: ALICE_ID },
    { bearer: null },
  );
  const res = await __internal.handleDmCreateThread(req);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.code, 'unauthorized');
  __internal.resetAdminForTest();
  __internal.setNotifyCommunityForTest(null);
});

// ===========================================================================
// T2 — Rate-limit hit (4th call) → 429 + Retry-After
// ===========================================================================

Deno.test('T2 — rate limit at count=3 returns 429 rate_limited with Retry-After', async () => {
  installNotifySpy();
  const oldest = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(); // 23h ago
  __internal.setAdminForTest(makeFakeAdmin({
    recipientProfile: happyRecipient(),
    senderProfile: happySender(false),
    blockedByRecipient: false,
    threadCountIn24h: 3,
    oldestThreadCreatedAt: oldest,
  }));
  const req = makeReq({
    recipient_user_id: BOB_ID,
    body: 'hi from alice',
    creator_user_id: ALICE_ID,
  });
  const res = await __internal.handleDmCreateThread(req);
  assertEquals(res.status, 429);
  const retryAfter = res.headers.get('Retry-After');
  assertNotEquals(retryAfter, null);
  // Retry-After should be roughly 1h (3600s) — within 23h to 24h remaining window.
  const secs = parseInt(retryAfter ?? '0', 10);
  assertEquals(secs > 0 && secs <= 24 * 60 * 60, true);
  const json = await res.json();
  assertEquals(json.code, 'rate_limited');
  // No notify on rate-limit reject.
  assertEquals(notifyCalls.length, 0);
  __internal.resetAdminForTest();
  __internal.setNotifyCommunityForTest(null);
});

// ===========================================================================
// T3 — Recipient blocked sender → 403 blocked
// ===========================================================================

Deno.test('T3 — recipient has blocked sender returns 403 blocked', async () => {
  installNotifySpy();
  __internal.setAdminForTest(makeFakeAdmin({
    recipientProfile: happyRecipient(),
    senderProfile: happySender(false),
    blockedByRecipient: true,
    threadCountIn24h: 0,
  }));
  const req = makeReq({
    recipient_user_id: BOB_ID,
    body: 'hello',
    creator_user_id: ALICE_ID,
  });
  const res = await __internal.handleDmCreateThread(req);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.code, 'blocked');
  assertEquals(notifyCalls.length, 0);
  __internal.resetAdminForTest();
  __internal.setNotifyCommunityForTest(null);
});

// ===========================================================================
// T4 — Verified-clinician bypass: count=5 but succeeds + audit row written
// ===========================================================================

Deno.test('T4 — verified-clinician bypass skips rate limit + writes audit row', async () => {
  installNotifySpy();
  const auditInserts: Array<{ thread_id: string; actor_user_id: string; reason: string }> = [];
  __internal.setAdminForTest(makeFakeAdmin({
    recipientProfile: happyRecipient(),
    senderProfile: happySender(true), // clinician
    blockedByRecipient: false,
    threadCountIn24h: 5, // way over the limit — but should be ignored
    auditInserts,
  }));
  const req = makeReq({
    recipient_user_id: BOB_ID,
    body: 'clinical follow-up',
    creator_user_id: ALICE_ID,
  });
  const res = await __internal.handleDmCreateThread(req);
  assertEquals(res.status, 201);
  const json = await res.json();
  assertEquals(json.thread_id, NEW_THREAD_ID);
  assertEquals(json.message_id, NEW_MESSAGE_ID);
  assertEquals(auditInserts.length, 1);
  assertEquals(auditInserts[0].reason, 'clinician_bypass');
  assertEquals(auditInserts[0].actor_user_id, ALICE_ID);
  assertEquals(auditInserts[0].thread_id, NEW_THREAD_ID);
  __internal.resetAdminForTest();
  __internal.setNotifyCommunityForTest(null);
});

// ===========================================================================
// T5 — Recipient.dm_open=false → 403 dm_closed
// ===========================================================================

Deno.test('T5 — recipient dm_open=false returns 403 dm_closed', async () => {
  installNotifySpy();
  __internal.setAdminForTest(makeFakeAdmin({
    recipientProfile: {
      dm_open: false,
      community_last_active_at: null,
      is_clinician_verified: false,
      leaderboard_handle: 'bob',
    },
    senderProfile: happySender(false),
    blockedByRecipient: false,
    threadCountIn24h: 0,
  }));
  const req = makeReq({
    recipient_user_id: BOB_ID,
    body: 'hi',
    creator_user_id: ALICE_ID,
  });
  const res = await __internal.handleDmCreateThread(req);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.code, 'dm_closed');
  assertEquals(notifyCalls.length, 0);
  __internal.resetAdminForTest();
  __internal.setNotifyCommunityForTest(null);
});

// ===========================================================================
// T6 — Happy path → 201 with thread_id + message_id
// ===========================================================================

Deno.test('T6 — happy path returns 201 with thread_id and message_id + fires notify', async () => {
  installNotifySpy();
  __internal.setAdminForTest(makeFakeAdmin({
    recipientProfile: happyRecipient(null), // never active → notify fires
    senderProfile: happySender(false),
    blockedByRecipient: false,
    threadCountIn24h: 0,
  }));
  const req = makeReq({
    recipient_user_id: BOB_ID,
    body: 'hello bob',
    creator_user_id: ALICE_ID,
  });
  const res = await __internal.handleDmCreateThread(req);
  assertEquals(res.status, 201);
  const json = await res.json();
  assertEquals(typeof json.thread_id, 'string');
  assertEquals(typeof json.message_id, 'string');
  assertEquals(json.thread_id, NEW_THREAD_ID);
  assertEquals(json.message_id, NEW_MESSAGE_ID);
  // Notify-community should have been called exactly once with dm_new payload.
  assertEquals(notifyCalls.length, 1);
  const payload = notifyCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.thread_id, NEW_THREAD_ID);
  assertEquals(payload.sender_user_id, ALICE_ID);
  assertEquals(payload.recipient_user_id, BOB_ID);
  __internal.resetAdminForTest();
  __internal.setNotifyCommunityForTest(null);
});

// ===========================================================================
// T7 — Recipient active within 5 min → notify SKIPPED, still 201
// ===========================================================================

Deno.test('T7 — recipient active within 5min → notify-community NOT called, still 201', async () => {
  installNotifySpy();
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  __internal.setAdminForTest(makeFakeAdmin({
    recipientProfile: happyRecipient(twoMinAgo), // active 2 min ago → within 5min debounce
    senderProfile: happySender(false),
    blockedByRecipient: false,
    threadCountIn24h: 0,
  }));
  const req = makeReq({
    recipient_user_id: BOB_ID,
    body: 'are you around?',
    creator_user_id: ALICE_ID,
  });
  const res = await __internal.handleDmCreateThread(req);
  assertEquals(res.status, 201);
  // Debounce: notify-community must NOT have been called.
  assertEquals(notifyCalls.length, 0);
  __internal.resetAdminForTest();
  __internal.setNotifyCommunityForTest(null);
});
