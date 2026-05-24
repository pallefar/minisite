/**
 * Phase 45 Plan 45-05 — Deno tests for community-admin-report-digest Edge Function.
 *
 * Per reference_deno_test_discovery — filename pattern <name>.test.ts.
 *
 * Test plan (3 Deno.test blocks per acceptance criteria):
 *   T1 — Missing bearer → 401 unauthorized
 *   T2 — Zero open reports → 200 sent_count=0, sendEmail never called
 *   T3 — Three admins opted-in + 4 open reports → 200 sent_count=3,
 *        sendEmail called 3 times with template='community_admin_report_digest'
 */
import { assertEquals } from 'jsr:@std/assert@^1';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

import { __internal } from './index.ts';

const SERVICE_BEARER = 'test-service-role-key';
const ADMIN_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_3_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// ---------------------------------------------------------------------------
// Fake admin builder — supports profiles SELECT + community_reports SELECT
// + auth.admin.getUserById for email lookup (per memory
// profiles_email_vs_auth_users_email: profiles has NO email column).
// ---------------------------------------------------------------------------

interface FakeAdminConfig {
  /** Rows returned for SELECT target_type FROM community_reports WHERE status='open'. */
  reportRows?: Array<{ target_type: string }>;
  /** Profiles rows returned for SELECT id FROM profiles WHERE is_staff AND admin_digest_opt_in. */
  adminProfileRows?: Array<{ id: string }>;
  /** Map of user_id → email returned by auth.admin.getUserById. */
  userEmails?: Record<string, string>;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    auth: {
      admin: {
        getUserById: (userId: string) => {
          const email = cfg.userEmails?.[userId];
          if (!email) {
            return Promise.resolve({ data: { user: null }, error: { message: 'not_found' } });
          }
          return Promise.resolve({ data: { user: { id: userId, email } }, error: null });
        },
      },
    },
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      const state: any = { table, filters: {} };
      const chain = {
        select(_cols?: string) {
          return chain;
        },
        eq(col: string, val: unknown) {
          state.filters[col] = val;
          return chain;
        },
        limit(_n: number) {
          return chain;
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          let result: unknown;
          if (table === 'community_reports') {
            result = { data: cfg.reportRows ?? [], error: null };
          } else if (table === 'profiles') {
            result = { data: cfg.adminProfileRows ?? [], error: null };
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

// ---------------------------------------------------------------------------
// sendEmail mock — captures calls
// ---------------------------------------------------------------------------

interface SendEmailCall {
  template: string;
  to: string;
  vars: Record<string, unknown>;
  phi: boolean;
}

let sendEmailCalls: SendEmailCall[] = [];
function installSendEmailMock(): void {
  sendEmailCalls = [];
  __internal.setSendEmailForTest(
    // deno-lint-ignore no-explicit-any
    (async (_supabase: unknown, args: any) => {
      sendEmailCalls.push({
        template: String(args.template),
        to: String(args.to),
        vars: args.vars as Record<string, unknown>,
        phi: Boolean(args.phi),
      });
      return { provider: 'resend' as const, id: 'mock-' + sendEmailCalls.length };
    }) as unknown as Parameters<typeof __internal.setSendEmailForTest>[0],
  );
}

function makeReq(opts?: { bearer?: string | null; method?: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = opts?.bearer !== undefined ? opts.bearer : SERVICE_BEARER;
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/functions/v1/community-admin-report-digest', {
    method: opts?.method ?? 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// T1: Missing bearer → 401
// ---------------------------------------------------------------------------

Deno.test('T1 — missing bearer returns 401 unauthorized', async () => {
  const req = makeReq({ bearer: null });
  const res = await __internal.handleDigest(req);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

// ---------------------------------------------------------------------------
// T2: Zero open reports → 200, sent_count=0, sendEmail never invoked
// ---------------------------------------------------------------------------

Deno.test('T2 — zero open reports returns sent_count=0 without sending email', async () => {
  installSendEmailMock();
  __internal.setAdminForTest(makeFakeAdmin({
    reportRows: [],
    adminProfileRows: [
      { id: ADMIN_1_ID },
      { id: ADMIN_2_ID },
    ],
    userEmails: {
      [ADMIN_1_ID]: 'admin1@leanshot.app',
      [ADMIN_2_ID]: 'admin2@leanshot.app',
    },
  }));
  const req = makeReq();
  const res = await __internal.handleDigest(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.sent_count, 0);
  assertEquals(json.open_count, 0);
  assertEquals(Array.isArray(json.by_type), true);
  assertEquals(json.by_type.length, 0);
  assertEquals(sendEmailCalls.length, 0);
  __internal.resetAdminForTest();
  __internal.resetSendEmailForTest();
});

// ---------------------------------------------------------------------------
// T3: Three admins opted in + 4 open reports across 2 target_types → 3 emails
// ---------------------------------------------------------------------------

Deno.test('T3 — three opted-in admins receive digest email with correct grouping', async () => {
  installSendEmailMock();
  __internal.setAdminForTest(makeFakeAdmin({
    reportRows: [
      { target_type: 'post' },
      { target_type: 'post' },
      { target_type: 'comment' },
      { target_type: 'post' },
    ],
    adminProfileRows: [
      { id: ADMIN_1_ID },
      { id: ADMIN_2_ID },
      { id: ADMIN_3_ID },
    ],
    userEmails: {
      [ADMIN_1_ID]: 'admin1@leanshot.app',
      [ADMIN_2_ID]: 'admin2@leanshot.app',
      [ADMIN_3_ID]: 'admin3@leanshot.app',
    },
  }));
  const req = makeReq();
  const res = await __internal.handleDigest(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.sent_count, 3);
  assertEquals(json.open_count, 4);
  // by_type should contain {target_type: 'post', count: 3} and {target_type: 'comment', count: 1}
  const byTypeMap: Record<string, number> = {};
  for (const row of json.by_type as Array<{ target_type: string; count: number }>) {
    byTypeMap[row.target_type] = row.count;
  }
  assertEquals(byTypeMap.post, 3);
  assertEquals(byTypeMap.comment, 1);

  assertEquals(sendEmailCalls.length, 3);
  for (const call of sendEmailCalls) {
    assertEquals(call.template, 'community_admin_report_digest');
    assertEquals(call.phi, false);
    assertEquals(typeof call.vars.open_count, 'number');
    assertEquals(call.vars.open_count, 4);
    assertEquals(Array.isArray(call.vars.by_type), true);
    assertEquals(typeof call.vars.digest_date, 'string');
    assertEquals(call.vars.admin_url, 'https://app.leanshot.app/admin/community/reports');
  }
  // Verify the three recipients are the configured admin emails
  const recipients = sendEmailCalls.map((c) => c.to).sort();
  assertEquals(recipients, ['admin1@leanshot.app', 'admin2@leanshot.app', 'admin3@leanshot.app']);
  __internal.resetAdminForTest();
  __internal.resetSendEmailForTest();
});
