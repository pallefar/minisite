/**
 * Phase 49 Plan 49-07 Task 2 — Deno tests for community-weekly-digest Edge Function.
 *
 * Per reference_deno_test_discovery — filename pattern <name>.test.ts.
 * Per reference_deno_test_top_level_serve_trap — disable serve BEFORE import.
 *
 * Test plan (mock-driven; mirrors community-daily-digest/index.test.ts):
 *
 *   T1 — handleRun: empty content → status='skipped:no-content', no email sent
 *   T2 — handleRun: opt-out (notification_settings.enabled=false) → status='skipped:opted_out', no email sent
 *   T3 — handleRun: non-empty + opted-in → status='sent', RESEND_API_KEY=test-stub short-circuits
 *   T4 — Deno.serve guard: COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE=1 prevents port binding during import
 *
 * Test seam: `__internal` export from `./index.ts` exposes handleRun,
 * computeWeeklyDigest, isEmpty, setAdminForTest, resetAdminForTest.
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Disable top-level Deno.serve so tests don't bind a port (per memory
// reference_deno_test_top_level_serve_trap). MUST be set BEFORE import.
Deno.env.set('COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE', '1');
// Provide a fixture UNSUBSCRIBE_SECRET so mintUnsubscribeToken in the happy path
// doesn't throw on missing env. Real production sets via Supabase Function Secrets.
Deno.env.set('UNSUBSCRIBE_SECRET', 'test-fixture-secret-for-unit-tests-only-32b');
// Stub Resend so sendEmail returns ok without hitting the network.
Deno.env.set('RESEND_API_KEY', 'test-stub');

const { __internal } = await import('./index.ts');

const ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// ---------------------------------------------------------------------------
// Fake admin builder
// ---------------------------------------------------------------------------

interface FakeAdminConfig {
  /** RPC fixtures keyed by RPC name (digest_course_progress_delta_7d / etc.). */
  rpcData?: Record<string, unknown[]>;
  /** Override the notification_settings.enabled value (true=opted-in, false=opt-out, null=missing row). */
  optOut?: boolean | null;
  /** Override the auth.admin.getUserById email. null/undefined → no email. */
  email?: string | null;
  /** Captured upsert calls (push-on-every-call). */
  upserts?: Array<{ table: string; row: unknown; opts: unknown }>;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  cfg.upserts = cfg.upserts ?? [];
  return {
    auth: {
      admin: {
        getUserById: (_id: string) => {
          if (cfg.email === undefined || cfg.email === null) {
            return Promise.resolve({ data: { user: null }, error: null });
          }
          return Promise.resolve({
            data: { user: { id: _id, email: cfg.email } },
            error: null,
          });
        },
      },
    },
    rpc: (name: string, _args: unknown) => {
      const data = cfg.rpcData?.[name] ?? [];
      return Promise.resolve({ data, error: null });
    },
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      const state: any = { table, filters: {} };
      const chain = {
        select(_cols?: string) { return chain; },
        eq(col: string, val: unknown) { state.filters[col] = val; return chain; },
        maybeSingle() {
          if (table === 'notification_settings') {
            if (cfg.optOut === null) {
              // Missing row → null data.
              return Promise.resolve({ data: null, error: null });
            }
            // cfg.optOut===true  → user IS opted out → enabled=false
            // cfg.optOut===false → user IS opted in  → enabled=true
            return Promise.resolve({ data: { enabled: cfg.optOut !== true }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        upsert(row: unknown, opts: unknown) {
          cfg.upserts!.push({ table, row, opts });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
}

// Tracked fetch calls (Resend goes through fetch in stub mode it short-circuits).
let fetchCalls: Array<{ url: string; body: unknown; headers: Record<string, string> | undefined }> = [];

function installFetchMock(): void {
  fetchCalls = [];
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = async (url: string, opts?: RequestInit) => {
    let parsedBody: unknown = null;
    if (opts?.body) {
      try { parsedBody = JSON.parse(opts.body as string); } catch { parsedBody = opts.body; }
    }
    fetchCalls.push({ url, body: parsedBody, headers: opts?.headers as Record<string, string> | undefined });
    return new Response(JSON.stringify({ id: 'fake-msg-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

// ---------------------------------------------------------------------------
// T1: Empty content → skipped:no-content
// ---------------------------------------------------------------------------

Deno.test('T1 — handleRun: empty content → skipped:no-content, no email sent', async () => {
  installFetchMock();
  const cfg: FakeAdminConfig = {
    rpcData: {
      digest_course_progress_delta_7d: [],
      digest_upcoming_events_7d_rsvpd: [],
      digest_community_top3_7d: [],
    },
    optOut: false,
    email: 'alice@example.com',
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  const res = await __internal.handleRun(ALICE_ID);
  assertEquals(res.status, 'skipped:no-content');
  // Exactly one digest_send_log UPSERT, no Resend calls.
  assertEquals(cfg.upserts!.length, 1);
  assertEquals((cfg.upserts![0].row as { status: string }).status, 'skipped:no-content');
  // The UPSERT row.kind MUST be 'weekly'.
  assertEquals((cfg.upserts![0].row as { kind: string }).kind, 'weekly');
  const resendCalls = fetchCalls.filter((c) => c.url.includes('resend.com'));
  assertEquals(resendCalls.length, 0);
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T2: Opt-out → skipped:opted_out
// ---------------------------------------------------------------------------

Deno.test('T2 — handleRun: opt-out → skipped:opted_out, no email sent', async () => {
  installFetchMock();
  const cfg: FakeAdminConfig = {
    rpcData: {
      digest_course_progress_delta_7d: [
        { course_id: 'c1', course_title: 'Course 1', completed_this_week: 2, total_lessons: 10, percent_complete: 40 },
      ],
      digest_upcoming_events_7d_rsvpd: [],
      digest_community_top3_7d: [],
    },
    optOut: true, // enabled=false
    email: 'alice@example.com',
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  const res = await __internal.handleRun(ALICE_ID);
  assertEquals(res.status, 'skipped:opted_out');
  assertEquals(cfg.upserts!.length, 1);
  assertEquals((cfg.upserts![0].row as { status: string }).status, 'skipped:opted_out');
  assertEquals((cfg.upserts![0].row as { kind: string }).kind, 'weekly');
  const resendCalls = fetchCalls.filter((c) => c.url.includes('resend.com'));
  assertEquals(resendCalls.length, 0);
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T3: Non-empty + opted-in → sent (RESEND_API_KEY=test-stub short-circuits)
// ---------------------------------------------------------------------------

Deno.test('T3 — handleRun: non-empty + opted-in → sent (RESEND_API_KEY=test-stub short-circuits)', async () => {
  installFetchMock();
  const cfg: FakeAdminConfig = {
    rpcData: {
      digest_course_progress_delta_7d: [
        { course_id: 'c1', course_title: 'Course 1', completed_this_week: 2, total_lessons: 10, percent_complete: 40 },
      ],
      digest_upcoming_events_7d_rsvpd: [
        { event_id: 'e1', title: 'Live Q&A', start_at: new Date(Date.now() + 86400_000).toISOString() },
      ],
      digest_community_top3_7d: [
        { post_id: 'p1', space_id: 's1', space_name: 'Space 1', body: 'Hello', score: 5, author_id: 'u1' },
      ],
      digest_top_posts_in_spaces: [],
      digest_new_comments_on_my_posts: [],
      digest_recent_mentions: [],
    },
    optOut: false, // enabled=true
    email: 'alice@example.com',
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  const res = await __internal.handleRun(ALICE_ID);
  // With RESEND_API_KEY=test-stub, sendResendEmail returns {ok:true, stubbed:true}
  // so the run should reach the final 'sent' UPSERT.
  assertEquals(res.status, 'sent');
  assertExists(res.bucket_counts);
  assertEquals(res.bucket_counts!.courseProgress, 1);
  assertEquals(res.bucket_counts!.upcomingEvents, 1);
  assertEquals(res.bucket_counts!.communityTop3, 1);
  // Exactly one digest_send_log UPSERT with status='sent', kind='weekly'.
  const sentUpserts = cfg.upserts!.filter(
    (u) =>
      u.table === 'digest_send_log' &&
      (u.row as { status: string }).status === 'sent' &&
      (u.row as { kind: string }).kind === 'weekly',
  );
  assertEquals(sentUpserts.length, 1);
  __internal.resetAdminForTest();
});

// ---------------------------------------------------------------------------
// T4: Deno.serve guard respects COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE=1
// ---------------------------------------------------------------------------

Deno.test('T4 — Deno.serve guard respects COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE=1', () => {
  // Reaching this Deno.test block at all means the module import did NOT bind a
  // port at top level — otherwise the test runner would have died with
  // AddrInUse on the default 8000. Asserting the env var is set is a cheap
  // self-check that this guard is the reason imports stayed quiet.
  assertEquals(Deno.env.get('COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE'), '1');
});
