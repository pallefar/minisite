/**
 * Deno tests for `lifecycle-behavior-triggered` Edge Function — Phase 22 plan 22-02 (ON-02).
 *
 * Test plan:
 *   T1 health-check fails → 200 + skipped:true, no fetch
 *   T2 health-check ok + no eligible recipients → 200 + sent:0
 *   T3 streak-warn fires when conditions met (Phase 35 plan 35-09 D-09)
 *   T4 streak-warn does NOT fire when alreadySent (idempotency proof)
 *   T5 challenge-nudge fires for users < threshold and 24h ahead (D-21)
 *   T6 preference disabled → no notification (ethical-only guardrail)
 */
import { assertEquals } from 'jsr:@std/assert@^1';
import { resetMirrorAdminForTest, setMirrorAdminForTest } from '../_shared/posthog-server.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('SITE_URL', 'https://app.leanshot.app');

const { __internal } = await import('./index.ts');

/** Stub posthog-server events_mirror admin so tests don't make real HTTP calls. */
function stubMirrorAdmin(): void {
  setMirrorAdminForTest({
    from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }),
  });
}

/** Build a fluent query proxy that returns emptyResult at any terminal .then() point. */
function makeFluentQuery(terminal: unknown = { data: [], error: null }): unknown {
  // A Proxy that returns itself for any chained method call, resolving to `terminal` as a Promise.
  const handler: ProxyHandler<object> = {
    get(_t, prop: string | symbol) {
      if (prop === 'then') {
        // Make it thenable (so `await fluentQuery` works)
        return (resolve: (v: unknown) => void) => resolve(terminal);
      }
      // Any method call returns the same proxy (for chaining)
      return (..._args: unknown[]) => proxy;
    },
  };
  const proxy = new Proxy({}, handler);
  return proxy;
}

function emptyFakeAdmin(): unknown {
  return {
    rpc: () => makeFluentQuery({ data: [], error: null }),
    from: () => ({
      select: () => makeFluentQuery({ data: [], error: null }),
      insert: () => makeFluentQuery({ data: null, error: null }),
      update: () => makeFluentQuery({ data: null, error: null }),
      upsert: () => makeFluentQuery({ data: null, error: null }),
    }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null }, error: null }) } },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };
}

Deno.test('T1 — health-check fails → 200 + skipped:true', async () => {
  Deno.env.delete('RESEND_API_KEY');
  __internal.setAdminForTest(emptyFakeAdmin());
  try {
    const req = new Request('http://localhost/lifecycle-behavior-triggered', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key' },
    });
    const res = await __internal.handleRun(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.skipped, true);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T2 — health ok + no recipients → 200 + sent:0', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  __internal.setAdminForTest(emptyFakeAdmin());
  try {
    const req = new Request('http://localhost/lifecycle-behavior-triggered', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key' },
    });
    const res = await __internal.handleRun(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.sent, 0);
    assertEquals(body.processed, 0);
  } finally {
    __internal.resetAdminForTest();
    Deno.env.delete('RESEND_API_KEY');
  }
});

// ---------------------------------------------------------------------------
// Phase 35 plan 35-09 — Gamification branch tests
// ---------------------------------------------------------------------------

Deno.test('T3 — streak-warn fires when conditions met (D-09)', async () => {
  // Mock: find_streak_warn_users returns 1 at-risk user; alreadySent returns empty; preference enabled.
  const inserted: unknown[] = [];
  const upserted: unknown[] = [];
  const fakeAdmin: unknown = {
    rpc: (name: string, _args: unknown) => {
      if (name === 'find_streak_warn_users') {
        return Promise.resolve({
          data: [{ user_id: 'user-a', current_streak_days: 5 }],
          error: null,
        });
      }
      return makeFluentQuery({ data: [], error: null });
    },
    from: (table: string) => ({
      // alreadySent: select returns empty; isPreferenceEnabled: consent_records returns empty (default opt-in)
      select: () => makeFluentQuery({ data: [], error: null }),
      insert: (row: unknown) => {
        if (table === 'user_notifications') inserted.push(row);
        return makeFluentQuery({ data: null, error: null });
      },
      update: () => makeFluentQuery({ data: null, error: null }),
      upsert: (row: unknown) => {
        upserted.push(row);
        return makeFluentQuery({ data: null, error: null });
      },
    }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null }, error: null }) } },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };

  __internal.setAdminForTest(fakeAdmin);
  stubMirrorAdmin();
  try {
    const result = await __internal.runStreakWarn();
    assertEquals(result.processed, 1);
    assertEquals(result.sent, 1);
    assertEquals(result.skipped_already_sent, 0);
    // user_notifications INSERT should have occurred
    assertEquals(inserted.length, 1);
    const payload = (inserted[0] as { payload: { subtype: string } }).payload;
    assertEquals(payload.subtype, 'gamification.streak_warn');
    // email_send_counters UPSERT should have occurred
    assertEquals(upserted.length, 1);
  } finally {
    __internal.resetAdminForTest();
    resetMirrorAdminForTest();
  }
});

Deno.test('T4 — streak-warn does NOT fire when alreadySent (idempotency proof)', async () => {
  const inserted: unknown[] = [];
  const fakeAdmin: unknown = {
    rpc: (name: string, _args: unknown) => {
      if (name === 'find_streak_warn_users') {
        return Promise.resolve({
          data: [{ user_id: 'user-b', current_streak_days: 3 }],
          error: null,
        });
      }
      return makeFluentQuery({ data: [], error: null });
    },
    from: (table: string) => ({
      // alreadySent returns a row: already sent → skip
      select: () => makeFluentQuery({ data: [{ key: 'behavior:user-b:streak-warn:already-sent' }], error: null }),
      insert: (row: unknown) => {
        if (table === 'user_notifications') inserted.push(row);
        return makeFluentQuery({ data: null, error: null });
      },
      update: () => makeFluentQuery({ data: null, error: null }),
      upsert: () => makeFluentQuery({ data: null, error: null }),
    }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null }, error: null }) } },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };

  __internal.setAdminForTest(fakeAdmin);
  try {
    const result = await __internal.runStreakWarn();
    assertEquals(result.processed, 1);
    assertEquals(result.sent, 0);
    assertEquals(result.skipped_already_sent, 1);
    // No user_notifications INSERT should have occurred
    assertEquals(inserted.length, 0);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T5 — challenge-nudge fires for users < threshold with 24h ahead (D-21)', async () => {
  const now = new Date();
  const endSoon = new Date(now.getTime() + 24.5 * 60 * 60 * 1000).toISOString();
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const upserted: unknown[] = [];

  const nudgeData = [{
    user_id: 'user-c',
    challenge_id: 'chall-1',
    progress_count: 2,
    weekly_challenges: { framing: 'Log 5 injections', threshold: 5, ends_at: endSoon, status: 'active' },
  }];

  const fakeAdmin: unknown = {
    rpc: () => makeFluentQuery({ data: [], error: null }),
    from: (table: string) => {
      let selectResult: unknown = { data: [], error: null };
      if (table === 'challenge_progress') {
        // challenge_nudge query returns nudgeData; alreadySent/isPreference return empty
        selectResult = { data: nudgeData, error: null };
      }
      return {
        select: () => makeFluentQuery(selectResult),
        insert: (row: unknown) => {
          if (table === 'user_notifications') inserted.push(row);
          return makeFluentQuery({ data: null, error: null });
        },
        update: (row: unknown) => {
          updated.push(row);
          return makeFluentQuery({ data: null, error: null });
        },
        upsert: (row: unknown) => {
          upserted.push(row);
          return makeFluentQuery({ data: null, error: null });
        },
      };
    },
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null }, error: null }) } },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };

  __internal.setAdminForTest(fakeAdmin);
  stubMirrorAdmin();
  try {
    const result = await __internal.runChallengeNudge();
    assertEquals(result.processed, 1);
    assertEquals(result.sent, 1);
    // user_notifications INSERT
    assertEquals(inserted.length, 1);
    const payload = (inserted[0] as { payload: { subtype: string } }).payload;
    assertEquals(payload.subtype, 'gamification.challenge_nudge');
    // notified_nudge_at UPDATE
    assertEquals(updated.length, 1);
    // email_send_counters UPSERT
    assertEquals(upserted.length, 1);
  } finally {
    __internal.resetAdminForTest();
    resetMirrorAdminForTest();
  }
});

Deno.test('T6 — preference disabled → no notification fired (ethical-only guardrail)', async () => {
  const inserted: unknown[] = [];
  const fakeAdmin: unknown = {
    rpc: (name: string, _args: unknown) => {
      if (name === 'find_streak_warn_users') {
        return Promise.resolve({
          data: [{ user_id: 'user-d', current_streak_days: 7 }],
          error: null,
        });
      }
      return makeFluentQuery({ data: [], error: null });
    },
    from: (table: string) => {
      return {
        // alreadySent: empty (not yet sent). isPreferenceEnabled: consent_records with ai-insights disabled.
        select: (cols?: string) => {
          if (cols && cols.includes('email_preferences')) {
            // consent_records query
            return makeFluentQuery({ data: [{ email_preferences: { 'ai-insights': false } }], error: null });
          }
          // email_send_counters key query or other
          return makeFluentQuery({ data: [], error: null });
        },
        insert: (row: unknown) => {
          if (table === 'user_notifications') inserted.push(row);
          return makeFluentQuery({ data: null, error: null });
        },
        update: () => makeFluentQuery({ data: null, error: null }),
        upsert: () => makeFluentQuery({ data: null, error: null }),
      };
    },
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null }, error: null }) } },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };

  __internal.setAdminForTest(fakeAdmin);
  try {
    const result = await __internal.runStreakWarn();
    assertEquals(result.processed, 1);
    assertEquals(result.sent, 0);
    assertEquals(result.skipped_preferences, 1);
    // No notification should have been inserted
    assertEquals(inserted.length, 0);
  } finally {
    __internal.resetAdminForTest();
  }
});
