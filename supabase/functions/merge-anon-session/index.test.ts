/**
 * Deno tests for `merge-anon-session` Edge Function — Phase 34 Plan 34-05.
 *
 * Per [[reference_deno_test_discovery]]: filename MUST be `index.test.ts`
 * (Deno's directory-walk matches `{*_,*.,}test.*`; `*-test.ts` is skipped on
 * Supabase CI).
 *
 * Behaviors covered (8 tests from 34-05-PLAN.md Task 2):
 *   T1 — Happy path: RPC returns winner → profiles update + affiliate
 *        propagation + aliasServerSide invoked + 200 { merged: true,
 *        draft_entries: [...] }
 *   T2 — No winner (RPC {winner_id:null}) → 200 { merged: false }; no
 *        downstream writes / no alias
 *   T3 — No auth → 401
 *   T4 — Invalid body → 400
 *   T5 — cookie_ids array length > 8 → 400
 *   T6 — anon_distinct_id passed → aliasServerSide receives that value
 *   T7 — anon_distinct_id NOT passed → aliasServerSide NOT called
 *   T8 — shutdownPostHog called in `finally` even when RPC errors
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const {
  handleMergeAnonSession,
  setAdminForTest,
  resetAdminForTest,
  setAliasSpyForTest,
  setShutdownSpyForTest,
  resetSpiesForTest,
} = __internal;

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

// ----------------------------------------------------------------------------
// Fake admin builder
// ----------------------------------------------------------------------------

interface FakeOps {
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  profileUpdates: Array<{ patch: Record<string, unknown>; eqUserId: string | null }>;
  affiliateUpdates: Array<{ patch: Record<string, unknown>; eqReferralCode: string | null; isUserId: unknown }>;
}

interface FakeAdminConfig {
  authResult?: { data: { user: { id: string } | null } | null; error: { message: string } | null };
  rpcResult?: { data: unknown; error: { message: string } | null };
  profileResult?: { error: { message: string } | null };
  affiliateResult?: { error: { message: string } | null };
  log: FakeOps;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    auth: {
      getUser(_jwt: string) {
        return Promise.resolve(
          cfg.authResult ?? { data: { user: { id: 'user-abc' } }, error: null },
        );
      },
    },
    rpc(fn: string, args: Record<string, unknown>) {
      cfg.log.rpcCalls.push({ fn, args });
      return Promise.resolve(cfg.rpcResult ?? { data: { winner_id: null }, error: null });
    },
    from(table: string) {
      const eqState: Record<string, unknown> = {};
      const isState: Record<string, unknown> = {};
      let pendingPatch: Record<string, unknown> | null = null;

      const builder = {
        update(patch: Record<string, unknown>) {
          pendingPatch = patch;
          return builder;
        },
        eq(col: string, val: unknown) {
          eqState[col] = val;
          return builder;
        },
        is(col: string, val: unknown) {
          isState[col] = val;
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          // Terminal: await on builder commits the operation.
          if (table === 'profiles') {
            cfg.log.profileUpdates.push({
              patch: pendingPatch ?? {},
              eqUserId: (eqState['id'] as string) ?? null,
            });
            resolve(cfg.profileResult ?? { error: null });
          } else if (table === 'affiliate_clicks') {
            cfg.log.affiliateUpdates.push({
              patch: pendingPatch ?? {},
              eqReferralCode: (eqState['referral_code'] as string) ?? null,
              isUserId: isState['user_id'],
            });
            resolve(cfg.affiliateResult ?? { error: null });
          } else {
            resolve({ error: null });
          }
        },
      };

      return builder;
    },
  };
}

function newLog(): FakeOps {
  return { rpcCalls: [], profileUpdates: [], affiliateUpdates: [] };
}

interface SpyState {
  aliasCalls: Array<{ supabaseUid: string; anonDistinctId: string }>;
  shutdownCalls: number;
}

function newSpies(): SpyState {
  return { aliasCalls: [], shutdownCalls: 0 };
}

function installSpies(state: SpyState): void {
  setAliasSpyForTest((uid: string, anon: string) => {
    state.aliasCalls.push({ supabaseUid: uid, anonDistinctId: anon });
  });
  setShutdownSpyForTest(() => {
    state.shutdownCalls += 1;
  });
}

// ----------------------------------------------------------------------------
// T1 — Happy path
// ----------------------------------------------------------------------------
Deno.test('T1: happy path — winner row triggers profile + affiliate + alias + 200 merged:true', async () => {
  const log = newLog();
  const spies = newSpies();
  installSpies(spies);
  setAdminForTest(
    makeFakeAdmin({
      log,
      rpcResult: {
        data: {
          winner_id: 'sess-1',
          cookie_id: '11111111-1111-4111-8111-111111111111',
          preferences: { locale: 'en', units: 'metric', primary_goal: 'lose-weight' },
          draft_entries: [{ kind: 'weight', data: { kg: 80 }, created_at: '2026-05-19' }],
          aff_code: 'PROMO-X',
        },
        error: null,
      },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/merge-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer user-jwt' },
      body: JSON.stringify({
        cookie_ids: ['11111111-1111-4111-8111-111111111111'],
        anon_distinct_id: 'ph-anon-abc',
      }),
    });
    const res = await handleMergeAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { merged: boolean; draft_entries: unknown[] };
    assertEquals(body.merged, true);
    assertEquals(body.draft_entries.length, 1);

    // RPC was called once with correct args
    assertEquals(log.rpcCalls.length, 1);
    assertEquals(log.rpcCalls[0].fn, 'merge_anon_session');
    assertEquals(log.rpcCalls[0].args.p_user_id, 'user-abc');

    // Profile update with preferences (locale + units + primary_goal — no timezone)
    assertEquals(log.profileUpdates.length, 1);
    assertEquals(log.profileUpdates[0].patch.locale, 'en');
    assertEquals(log.profileUpdates[0].patch.units, 'metric');
    assertEquals(log.profileUpdates[0].patch.primary_goal, 'lose-weight');
    assertEquals(log.profileUpdates[0].eqUserId, 'user-abc');

    // Affiliate propagation (referral_code === aff_code; user_id was null)
    assertEquals(log.affiliateUpdates.length, 1);
    assertEquals(log.affiliateUpdates[0].patch.user_id, 'user-abc');
    assertEquals(log.affiliateUpdates[0].eqReferralCode, 'PROMO-X');

    // PostHog alias invoked with the anon_distinct_id from the body
    assertEquals(spies.aliasCalls.length, 1);
    assertEquals(spies.aliasCalls[0].supabaseUid, 'user-abc');
    assertEquals(spies.aliasCalls[0].anonDistinctId, 'ph-anon-abc');

    // shutdownPostHog invoked in finally
    assertEquals(spies.shutdownCalls, 1);
  } finally {
    resetAdminForTest();
    resetSpiesForTest();
  }
});

// ----------------------------------------------------------------------------
// T2 — No winner → merged:false; no downstream writes / no alias
// ----------------------------------------------------------------------------
Deno.test('T2: no winner — 200 merged:false; no profile/affiliate/alias writes', async () => {
  const log = newLog();
  const spies = newSpies();
  installSpies(spies);
  setAdminForTest(
    makeFakeAdmin({
      log,
      rpcResult: { data: { winner_id: null }, error: null },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/merge-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer user-jwt' },
      body: JSON.stringify({
        cookie_ids: ['11111111-1111-4111-8111-111111111111'],
        anon_distinct_id: 'ph-anon-abc',
      }),
    });
    const res = await handleMergeAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { merged: boolean };
    assertEquals(body.merged, false);

    assertEquals(log.profileUpdates.length, 0);
    assertEquals(log.affiliateUpdates.length, 0);
    assertEquals(spies.aliasCalls.length, 0);
    // shutdownPostHog still runs in finally
    assertEquals(spies.shutdownCalls, 1);
  } finally {
    resetAdminForTest();
    resetSpiesForTest();
  }
});

// ----------------------------------------------------------------------------
// T3 — No auth → 401
// ----------------------------------------------------------------------------
Deno.test('T3: missing authorization header returns 401', async () => {
  const log = newLog();
  const spies = newSpies();
  installSpies(spies);
  setAdminForTest(makeFakeAdmin({ log }));
  try {
    const req = new Request('http://localhost/functions/v1/merge-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie_ids: ['11111111-1111-4111-8111-111111111111'] }),
    });
    const res = await handleMergeAnonSession(req);
    assertEquals(res.status, 401);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'unauthenticated');
    assertEquals(log.rpcCalls.length, 0);
    // shutdownPostHog still runs in finally
    assertEquals(spies.shutdownCalls, 1);
  } finally {
    resetAdminForTest();
    resetSpiesForTest();
  }
});

// ----------------------------------------------------------------------------
// T4 — Invalid body → 400
// ----------------------------------------------------------------------------
Deno.test('T4: invalid body (missing cookie_ids) returns 400', async () => {
  const log = newLog();
  const spies = newSpies();
  installSpies(spies);
  setAdminForTest(makeFakeAdmin({ log }));
  try {
    const req = new Request('http://localhost/functions/v1/merge-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer user-jwt' },
      body: JSON.stringify({ /* no cookie_ids */ }),
    });
    const res = await handleMergeAnonSession(req);
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'invalid_body');
    assertEquals(log.rpcCalls.length, 0);
  } finally {
    resetAdminForTest();
    resetSpiesForTest();
  }
});

// ----------------------------------------------------------------------------
// T5 — cookie_ids array > 8 → 400 (DoS mitigation T-34-05-06)
// ----------------------------------------------------------------------------
Deno.test('T5: cookie_ids array length > 8 returns 400', async () => {
  const log = newLog();
  const spies = newSpies();
  installSpies(spies);
  setAdminForTest(makeFakeAdmin({ log }));
  try {
    // 9 valid uuid-like strings
    const tooMany = Array.from({ length: 9 }, (_, i) =>
      `${String(i).repeat(8).padEnd(8, '0')}-0000-4000-8000-000000000000`,
    );
    const req = new Request('http://localhost/functions/v1/merge-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer user-jwt' },
      body: JSON.stringify({ cookie_ids: tooMany }),
    });
    const res = await handleMergeAnonSession(req);
    assertEquals(res.status, 400);
    assertEquals(log.rpcCalls.length, 0);
  } finally {
    resetAdminForTest();
    resetSpiesForTest();
  }
});

// ----------------------------------------------------------------------------
// T6 — anon_distinct_id passed → aliasServerSide receives that value
// ----------------------------------------------------------------------------
Deno.test('T6: anon_distinct_id passed → aliasServerSide called with that value', async () => {
  const log = newLog();
  const spies = newSpies();
  installSpies(spies);
  setAdminForTest(
    makeFakeAdmin({
      log,
      rpcResult: {
        data: {
          winner_id: 'sess-2',
          cookie_id: 'cc',
          preferences: {},
          draft_entries: [],
          aff_code: null,
        },
        error: null,
      },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/merge-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer user-jwt' },
      body: JSON.stringify({
        cookie_ids: ['11111111-1111-4111-8111-111111111111'],
        anon_distinct_id: 'ph-distinct-XYZ',
      }),
    });
    const res = await handleMergeAnonSession(req);
    assertEquals(res.status, 200);
    assertEquals(spies.aliasCalls.length, 1);
    assertEquals(spies.aliasCalls[0].anonDistinctId, 'ph-distinct-XYZ');
    assertEquals(spies.aliasCalls[0].supabaseUid, 'user-abc');
  } finally {
    resetAdminForTest();
    resetSpiesForTest();
  }
});

// ----------------------------------------------------------------------------
// T7 — anon_distinct_id NOT passed → aliasServerSide NOT called
// ----------------------------------------------------------------------------
Deno.test('T7: anon_distinct_id omitted → aliasServerSide NOT called', async () => {
  const log = newLog();
  const spies = newSpies();
  installSpies(spies);
  setAdminForTest(
    makeFakeAdmin({
      log,
      rpcResult: {
        data: {
          winner_id: 'sess-3',
          cookie_id: 'cc',
          preferences: {},
          draft_entries: [],
          aff_code: null,
        },
        error: null,
      },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/merge-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer user-jwt' },
      body: JSON.stringify({
        cookie_ids: ['11111111-1111-4111-8111-111111111111'],
        // No anon_distinct_id
      }),
    });
    const res = await handleMergeAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { merged: boolean };
    assertEquals(body.merged, true);
    assertEquals(spies.aliasCalls.length, 0, 'alias must NOT run without anon_distinct_id');
  } finally {
    resetAdminForTest();
    resetSpiesForTest();
  }
});

// ----------------------------------------------------------------------------
// T8 — shutdownPostHog called even when RPC errors
// ----------------------------------------------------------------------------
Deno.test('T8: shutdownPostHog called in finally even when RPC fails', async () => {
  const log = newLog();
  const spies = newSpies();
  installSpies(spies);
  setAdminForTest(
    makeFakeAdmin({
      log,
      rpcResult: { data: null, error: { message: 'simulated rpc failure' } },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/merge-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer user-jwt' },
      body: JSON.stringify({
        cookie_ids: ['11111111-1111-4111-8111-111111111111'],
        anon_distinct_id: 'ph-distinct-XYZ',
      }),
    });
    const res = await handleMergeAnonSession(req);
    assertEquals(res.status, 500);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'rpc_error');
    assert(spies.shutdownCalls >= 1, 'shutdownPostHog must run even on RPC failure');
    // No downstream writes when RPC fails
    assertEquals(log.profileUpdates.length, 0);
    assertEquals(log.affiliateUpdates.length, 0);
    assertEquals(spies.aliasCalls.length, 0);
  } finally {
    resetAdminForTest();
    resetSpiesForTest();
  }
});
