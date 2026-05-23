/**
 * Phase 44 Plan 44-05 — Deno tests for notify-community Edge Function.
 *
 * Per reference_deno_test_discovery — filename pattern <name>.test.ts.
 *
 * Test plan (10 Deno.test blocks):
 *   T1  — Missing bearer → 401 unauthorized
 *   T2  — Service-role bearer + kind='mention' + target_type='post' → 3 fan-out calls, 200 { fanout_count: 3 }
 *   T3  — User JWT where sub === mentioned_by_user_id → proceeds (same fan-out)
 *   T4  — User JWT where sub !== mentioned_by_user_id → 403 identity_mismatch
 *   T5  — Invalid JWT (getUser error) → 401 unauthorized
 *   T6  — kind='mention' + target_type='comment' → queries community_comment_mentions
 *   T7  — kind='reply' + service-role + author_id !== commenter_user_id → 1 fan-out, fanout_count=1
 *   T8  — kind='reply' + service-role + author_id === commenter_user_id → fanout_count=0 (self-reply)
 *   T9  — kind='reply' + user JWT where sub === commenter_user_id → proceeds
 *   T10 — kind='reply' + user JWT where sub !== commenter_user_id → 403 identity_mismatch
 *   T11 — Invalid kind → 400 invalid_body
 *   T12 — Self-mention skip: mentioned_by_user_id appears in mention rows → filtered out, reduced count
 */
import { assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const SERVICE_BEARER = 'test-service-role-key';
const ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB_ID   = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const POST_ID  = '00000001-0000-4000-8000-000000000001';
const COMMENT_ID = '00000002-0000-4000-8000-000000000002';
const SPACE_ID   = '00000003-0000-4000-8000-000000000003';

// ---------------------------------------------------------------------------
// Fake admin builder
// ---------------------------------------------------------------------------

interface FakeAdminConfig {
  getUserResult?: { id: string } | null;
  getUserError?: { message: string } | null;
  mentionRows?: Array<{ user_id: string }>;
  commentMentionRows?: Array<{ user_id: string }>;
  postAuthorId?: string | null;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
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
      const state: any = { table, filters: {} };

      const chain = {
        select(_cols?: string) {
          return chain;
        },
        eq(_col: string, _val: unknown) {
          state.filters[_col] = _val;
          return chain;
        },
        single() {
          if (table === 'community_posts') {
            return Promise.resolve({
              data: cfg.postAuthorId ? { author_id: cfg.postAuthorId } : null,
              error: cfg.postAuthorId === undefined ? { message: 'not_found' } : null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        // PromiseLike: makes `await chain` work
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          let result: unknown;
          if (table === 'community_post_mentions') {
            result = { data: cfg.mentionRows ?? [], error: null };
          } else if (table === 'community_comment_mentions') {
            result = { data: cfg.commentMentionRows ?? [], error: null };
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

// Tracked fetch calls
let fetchCalls: Array<{ url: string; body: unknown }> = [];

function installFetchMock(): void {
  fetchCalls = [];
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = async (url: string, opts?: RequestInit) => {
    let parsedBody: unknown = null;
    if (opts?.body) {
      try {
        parsedBody = JSON.parse(opts.body as string);
      } catch {
        parsedBody = opts.body;
      }
    }
    fetchCalls.push({ url, body: parsedBody });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
}

function makeReq(body: unknown, opts?: { bearer?: string | null; method?: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = opts?.bearer !== undefined ? opts.bearer : SERVICE_BEARER;
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/functions/v1/notify-community', {
    method: opts?.method ?? 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// T1: Missing bearer → 401
// ---------------------------------------------------------------------------

Deno.test('T1 — missing bearer returns 401 unauthorized', async () => {
  const req = makeReq({ kind: 'mention', target_type: 'post', target_id: POST_ID, space_id: SPACE_ID, mentioned_by_user_id: ALICE_ID, mentioned_by_name: 'alice' }, { bearer: null });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

// ---------------------------------------------------------------------------
// T2: Service-role bearer + kind='mention' + target_type='post' → fan-out × 3
// ---------------------------------------------------------------------------

Deno.test('T2 — service-role bearer + mention + post → fan-out 3 times', async () => {
  installFetchMock();
  __internal.setAdminForTest(makeFakeAdmin({
    mentionRows: [
      { user_id: BOB_ID },
      { user_id: CAROL_ID },
      { user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    ],
  }));
  const req = makeReq({
    kind: 'mention',
    target_type: 'post',
    target_id: POST_ID,
    space_id: SPACE_ID,
    mentioned_by_user_id: ALICE_ID,
    mentioned_by_name: 'alice',
  });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.fanout_count, 3);
  assertEquals(fetchCalls.length, 3);
  // Each call should target notification-send
  for (const call of fetchCalls) {
    assertEquals(call.url.includes('/functions/v1/notification-send'), true);
    const b = call.body as Record<string, unknown>;
    assertEquals(b.category, 'community-mentions');
  }
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T3: User JWT where sub === mentioned_by_user_id → fan-out proceeds
// ---------------------------------------------------------------------------

Deno.test('T3 — user JWT sub === mentioned_by_user_id → fan-out proceeds', async () => {
  installFetchMock();
  __internal.setAdminForTest(makeFakeAdmin({
    getUserResult: { id: ALICE_ID },
    mentionRows: [{ user_id: BOB_ID }],
  }));
  const req = makeReq({
    kind: 'mention',
    target_type: 'post',
    target_id: POST_ID,
    space_id: SPACE_ID,
    mentioned_by_user_id: ALICE_ID,
    mentioned_by_name: 'alice',
  }, { bearer: 'user-jwt-for-alice' });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.fanout_count, 1);
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T4: User JWT where sub !== mentioned_by_user_id → 403 identity_mismatch
// ---------------------------------------------------------------------------

Deno.test('T4 — user JWT sub !== mentioned_by_user_id → 403 identity_mismatch', async () => {
  __internal.setAdminForTest(makeFakeAdmin({
    getUserResult: { id: BOB_ID }, // JWT belongs to Bob
  }));
  const req = makeReq({
    kind: 'mention',
    target_type: 'post',
    target_id: POST_ID,
    space_id: SPACE_ID,
    mentioned_by_user_id: ALICE_ID, // but body claims Alice
    mentioned_by_name: 'alice',
  }, { bearer: 'user-jwt-for-bob' });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, 'identity_mismatch');
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T5: Invalid JWT (getUser error) → 401
// ---------------------------------------------------------------------------

Deno.test('T5 — invalid JWT (getUser error) → 401 unauthorized', async () => {
  __internal.setAdminForTest(makeFakeAdmin({
    getUserError: { message: 'jwt_invalid' },
  }));
  const req = makeReq({
    kind: 'mention',
    target_type: 'post',
    target_id: POST_ID,
    space_id: SPACE_ID,
    mentioned_by_user_id: ALICE_ID,
    mentioned_by_name: 'alice',
  }, { bearer: 'malformed-jwt' });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T6: kind='mention' + target_type='comment' → queries community_comment_mentions
// ---------------------------------------------------------------------------

Deno.test('T6 — kind=mention + target_type=comment → queries community_comment_mentions', async () => {
  installFetchMock();
  __internal.setAdminForTest(makeFakeAdmin({
    commentMentionRows: [{ user_id: BOB_ID }, { user_id: CAROL_ID }],
  }));
  const req = makeReq({
    kind: 'mention',
    target_type: 'comment',
    target_id: COMMENT_ID,
    space_id: SPACE_ID,
    mentioned_by_user_id: ALICE_ID,
    mentioned_by_name: 'alice',
  });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.fanout_count, 2);
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T7: kind='reply' + service-role + author_id !== commenter → 1 fan-out
// ---------------------------------------------------------------------------

Deno.test('T7 — kind=reply + author !== commenter → fan-out 1', async () => {
  installFetchMock();
  __internal.setAdminForTest(makeFakeAdmin({
    postAuthorId: ALICE_ID, // post was written by Alice
  }));
  const req = makeReq({
    kind: 'reply',
    post_id: POST_ID,
    comment_id: COMMENT_ID,
    space_id: SPACE_ID,
    commenter_user_id: BOB_ID, // Bob is replying
    commenter_name: 'bob',
  });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.fanout_count, 1);
  assertEquals(fetchCalls.length, 1);
  const b = fetchCalls[0].body as Record<string, unknown>;
  assertEquals(b.category, 'community-replies');
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T8: kind='reply' + author === commenter (self-reply) → fanout_count=0
// ---------------------------------------------------------------------------

Deno.test('T8 — kind=reply + author === commenter (self-reply) → fanout_count=0', async () => {
  installFetchMock();
  __internal.setAdminForTest(makeFakeAdmin({
    postAuthorId: ALICE_ID, // Alice wrote the post
  }));
  const req = makeReq({
    kind: 'reply',
    post_id: POST_ID,
    comment_id: COMMENT_ID,
    space_id: SPACE_ID,
    commenter_user_id: ALICE_ID, // Alice is also replying to her own post
    commenter_name: 'alice',
  });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.fanout_count, 0);
  assertEquals(fetchCalls.length, 0);
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T9: kind='reply' + user JWT where sub === commenter_user_id → proceeds
// ---------------------------------------------------------------------------

Deno.test('T9 — kind=reply + user JWT sub === commenter_user_id → proceeds', async () => {
  installFetchMock();
  __internal.setAdminForTest(makeFakeAdmin({
    getUserResult: { id: BOB_ID },
    postAuthorId: ALICE_ID,
  }));
  const req = makeReq({
    kind: 'reply',
    post_id: POST_ID,
    comment_id: COMMENT_ID,
    space_id: SPACE_ID,
    commenter_user_id: BOB_ID,
    commenter_name: 'bob',
  }, { bearer: 'user-jwt-for-bob' });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.fanout_count, 1);
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T10: kind='reply' + user JWT where sub !== commenter_user_id → 403
// ---------------------------------------------------------------------------

Deno.test('T10 — kind=reply + user JWT sub !== commenter_user_id → 403 identity_mismatch', async () => {
  __internal.setAdminForTest(makeFakeAdmin({
    getUserResult: { id: CAROL_ID }, // JWT belongs to Carol
  }));
  const req = makeReq({
    kind: 'reply',
    post_id: POST_ID,
    comment_id: COMMENT_ID,
    space_id: SPACE_ID,
    commenter_user_id: BOB_ID, // but body claims Bob
    commenter_name: 'bob',
  }, { bearer: 'user-jwt-for-carol' });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, 'identity_mismatch');
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T11: Invalid kind → 400 invalid_body
// ---------------------------------------------------------------------------

Deno.test('T11 — invalid kind → 400 invalid_body', async () => {
  const req = makeReq({ kind: 'unknown', target_id: POST_ID });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, 'invalid_body');
});

// ---------------------------------------------------------------------------
// T12: Self-mention skip — mentioned_by_user_id present in rows → filtered out
// ---------------------------------------------------------------------------

Deno.test('T12 — self-mention: mentioned_by_user_id in rows → filtered out', async () => {
  installFetchMock();
  __internal.setAdminForTest(makeFakeAdmin({
    mentionRows: [
      { user_id: ALICE_ID }, // self — should be skipped
      { user_id: BOB_ID },
    ],
  }));
  const req = makeReq({
    kind: 'mention',
    target_type: 'post',
    target_id: POST_ID,
    space_id: SPACE_ID,
    mentioned_by_user_id: ALICE_ID, // Alice mentioned herself
    mentioned_by_name: 'alice',
  });
  const res = await __internal.handleNotify(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  // Only Bob should receive — Alice (self) is filtered
  assertEquals(json.fanout_count, 1);
  assertEquals(fetchCalls.length, 1);
  __internal.resetAdminForTest();
});
