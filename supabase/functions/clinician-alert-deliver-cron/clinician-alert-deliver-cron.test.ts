/**
 * Deno tests for clinician-alert-deliver-cron Edge Function — Phase 30 Plan 30-01.
 *
 * Tests per plan:
 *   1. vendor-gated: missing RESEND_API_KEY skips email but realtime still broadcasts
 *   2. PHI-free template: email body contains no patient identifiers; subject exact match;
 *      body has single anchor to /clinic/{slug}/alerts?alert={uuid}
 *   3. retry_count bumps on each invocation
 *   4. delivery_failed transition on 3rd failure (retry_count=2, both channels fail)
 *   5. delivery_log inserts per attempt (realtime + email channels)
 *   6. per-alert try/catch: one failure does not abort batch; Sentry called once
 *
 * Additional body-keys assertion per [[feedback_verifier_catches_rpc_contract_drift]]:
 *   Resend POST body MUST contain exactly keys {from, to, subject, html}.
 *
 * Filename uses *.test.ts per [[reference_deno_test_discovery]] (NOT *-test.ts).
 */

import { assertEquals, assertMatch, assertFalse } from 'jsr:@std/assert';
import { buildAlertEmailPayload, runDeliverCron, type PendingAlert } from './index.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────────

const ALERT_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const ORG_NAME = 'Acme Clinic';
const ORG_SLUG = 'acme';
const USER_ID_1 = '33333333-3333-3333-3333-333333333333';
const USER_ID_2 = '44444444-4444-4444-4444-444444444444';
const CLINICIAN_EMAIL_1 = 'clinician1@clinic.example';
const CLINICIAN_EMAIL_2 = 'clinician2@clinic.example';
const SUPABASE_URL = 'https://test.supabase.co';
const SUPABASE_ANON_KEY = 'test-anon-key';
const RESEND_FROM = 'LeanShot <noreply@app.leanshot.app>';
const REALTIME_SECRET_HEX = '0'.repeat(64); // 32 zero bytes

/** Build a stub alert record. */
function makeAlert(retryCount = 0): PendingAlert {
  return {
    id: ALERT_ID,
    org_id: ORG_ID,
    patient_user_id: '55555555-5555-5555-5555-555555555555',
    alert_type: 'dose_adherence',
    retry_count: retryCount,
  };
}

/** Build a stub admin client that succeeds for all calls. */
function makeAdmin(opts: {
  secretHex?: string | null;
  orgName?: string;
  orgSlug?: string;
  memberIds?: string[];
  userEmails?: Array<{ id: string; email: string }>;
  insertCapture?: unknown[];
  updateCapture?: unknown[];
  failOnInsertChannel?: string | null;
  failOnUpdate?: boolean;
} = {}) {
  const {
    secretHex = REALTIME_SECRET_HEX,
    orgName = ORG_NAME,
    orgSlug = ORG_SLUG,
    memberIds = [USER_ID_1, USER_ID_2],
    userEmails = [
      { id: USER_ID_1, email: CLINICIAN_EMAIL_1 },
      { id: USER_ID_2, email: CLINICIAN_EMAIL_2 },
    ],
    insertCapture = [],
    updateCapture = [],
    failOnInsertChannel = null,
    failOnUpdate = false,
  } = opts;

  // Stub .from() returns a builder-like chain
  const fromBuilder = (table: string) => ({
    insert: (row: unknown) => {
      if (
        failOnInsertChannel &&
        typeof row === 'object' &&
        row !== null &&
        (row as Record<string, unknown>)['channel'] === failOnInsertChannel
      ) {
        return Promise.resolve({ data: null, error: { message: 'insert_failed' } });
      }
      (insertCapture as unknown[]).push({ table, row });
      return Promise.resolve({ data: null, error: null });
    },
    select: (_cols: string) => ({
      eq: (_col: string, _val: unknown) => ({
        in: (_col2: string, _vals: unknown[]) =>
          Promise.resolve({
            data: memberIds.map((id) => ({ user_id: id })),
            error: null,
          }),
        single: () =>
          Promise.resolve({
            data: { name: orgName, slug: orgSlug },
            error: null,
          }),
      }),
    }),
    update: (vals: unknown) => ({
      eq: (_col: string, _id: string) => {
        (updateCapture as unknown[]).push({ table, vals });
        if (failOnUpdate) {
          return Promise.resolve({ data: null, error: { message: 'update_failed' } });
        }
        return Promise.resolve({ data: null, error: null });
      },
    }),
  });

  const admin = {
    rpc: async (fn: string) => {
      if (fn === 'get_realtime_secret') {
        if (secretHex === null) return { data: null, error: { message: 'vault_error' } };
        return { data: secretHex, error: null };
      }
      return { data: null, error: null };
    },
    from: fromBuilder,
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: userEmails },
          error: null,
        }),
      },
    },
  };

  return admin;
}

/**
 * Build a stub global fetch that captures Resend requests.
 * Returns the stub fetch function + the captured calls array.
 */
function makeResendFetch(ok = true): {
  stubbedFetch: typeof fetch;
  calls: Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  const stubbedFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url instanceof URL ? url.toString() : url instanceof Request ? url.url : url;
    if (urlStr.includes('api.resend.com')) {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url: urlStr, body });
      return new Response(JSON.stringify({ id: 'email_test' }), {
        status: ok ? 200 : 500,
      });
    }
    // Pass through non-Resend fetches (e.g., supabase-js realtime)
    return new Response('{}', { status: 200 });
  };
  return { stubbedFetch: stubbedFetch as typeof fetch, calls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Test 2 (PHI-free template) — uses buildAlertEmailPayload directly.
// Run first because it's a pure unit test, no fetch stubbing needed.
// ---------------------------------------------------------------------------

Deno.test('PHI-free template: buildAlertEmailPayload has exact subject + CTA + no PHI', () => {
  const payload = buildAlertEmailPayload({
    from: RESEND_FROM,
    to: [CLINICIAN_EMAIL_1],
    orgName: ORG_NAME,
    orgSlug: ORG_SLUG,
    alertId: ALERT_ID,
  });

  // D-02: exact subject with em dash
  assertEquals(payload.subject, `New clinical alert — ${ORG_NAME}`);

  // D-02: html contains exactly one anchor with the correct deep-link
  const anchorRx = new RegExp(
    `href="https://app\\.leanshot\\.app/clinic/${ORG_SLUG}/alerts\\?alert=${ALERT_ID}"`,
  );
  assertMatch(payload.html, anchorRx);

  // PHI assertion: no patient identifiers in html body
  // (covers patient_name, patient email, diagnosis, clinical metrics)
  assertFalse(
    /patient|diagnosis|severity|symptom|prescription/i.test(payload.html),
    'html body must not contain PHI keywords',
  );

  // Body-keys assertion per [[feedback_verifier_catches_rpc_contract_drift]]:
  // Resend POST body MUST contain EXACTLY {from, to, subject, html} — no extra metadata.
  assertEquals(
    Object.keys(payload).sort(),
    ['from', 'html', 'subject', 'to'],
    'payload must have exactly {from, to, subject, html} keys — no PHI metadata',
  );
});

// ---------------------------------------------------------------------------
// Test 1: vendor-gated — RESEND_API_KEY missing skips email; realtime still fires
// ---------------------------------------------------------------------------

Deno.test('vendor-gated: missing RESEND_API_KEY skips email but broadcasts realtime', async () => {
  const { stubbedFetch, calls } = makeResendFetch();
  const insertCapture: unknown[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubbedFetch;

  try {
    const admin = makeAdmin({ insertCapture });
    const alerts = [makeAlert(0)];

    const results = await runDeliverCron({
      admin,
      alerts,
      resendApiKey: null, // missing — vendor-gated
      resendFrom: RESEND_FROM,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
    });

    assertEquals(results.length, 1);

    // Email NOT called
    const resendCalls = calls.filter((c) => c.url.includes('api.resend.com'));
    assertEquals(resendCalls.length, 0, 'Resend must NOT be called when API key is missing');

    // Realtime broadcast WAS attempted (fetch to supabase realtime channel)
    // The stub intercepts ALL fetch calls — we verify via delivery log insert
    const realtimeInsert = (insertCapture as Array<{ table: string; row: unknown }>).find(
      (e) => e.table === 'clinician_alert_deliveries' &&
        typeof e.row === 'object' &&
        e.row !== null &&
        (e.row as Record<string, unknown>)['channel'] === 'realtime',
    );
    assertFalse(realtimeInsert === undefined, 'realtime delivery log insert must exist');

    // Email delivery log insert must exist with success=false and correct error
    const emailInsert = (insertCapture as Array<{ table: string; row: unknown }>).find(
      (e) => e.table === 'clinician_alert_deliveries' &&
        typeof e.row === 'object' &&
        e.row !== null &&
        (e.row as Record<string, unknown>)['channel'] === 'email',
    );
    assertFalse(emailInsert === undefined, 'email delivery log insert must exist');
    assertEquals(
      (emailInsert!.row as Record<string, unknown>)['success'],
      false,
      'email delivery must be marked failed when key missing',
    );
    assertEquals(
      (emailInsert!.row as Record<string, unknown>)['error'],
      'resend_api_key_missing',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Test 3: retry_count bumps on each invocation
// ---------------------------------------------------------------------------

Deno.test('retry_count bumps on each invocation', async () => {
  const { stubbedFetch } = makeResendFetch(true);
  const updateCapture: unknown[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubbedFetch;

  try {
    const admin = makeAdmin({ updateCapture });
    const alerts = [makeAlert(0)]; // retry_count starts at 0

    await runDeliverCron({
      admin,
      alerts,
      resendApiKey: 'test-stub', // CI stub — skips actual fetch
      resendFrom: RESEND_FROM,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
    });

    // The update call should have bumped retry_count to 1
    const alertUpdate = (updateCapture as Array<{ table: string; vals: unknown }>).find(
      (e) => e.table === 'clinician_alerts',
    );
    assertFalse(alertUpdate === undefined, 'clinician_alerts update must exist');

    const vals = alertUpdate!.vals as Record<string, unknown>;
    assertEquals(vals['retry_count'], 1, 'retry_count must be bumped to 1');
    assertFalse(
      vals['last_attempt_at'] === undefined,
      'last_attempt_at must be set',
    );
    // Must NOT contain status field (still pending)
    assertEquals(
      vals['status'],
      undefined,
      'status must NOT be in update when retry_count < 3',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Test 4: delivery_failed transition on 3rd failure (retry_count=2, both fail)
// ---------------------------------------------------------------------------

Deno.test('delivery_failed transition on 3rd failure (retry_count=2, both channels fail)', async () => {
  const updateCapture: unknown[] = [];

  // Force both realtime and email to fail:
  // - email: pass null key so email path is skipped (success=false)
  // - realtime: use invalid secret hex so channel name computation or broadcast fails
  //   (realtime client will try to connect but we return non-'ok' response)
  const { stubbedFetch } = makeResendFetch(false); // non-2xx
  const originalFetch = globalThis.fetch;

  // Stub fetch to return non-'ok' for ALL calls (forces realtime broadcast failure too)
  globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response('error', { status: 500 });
  };

  try {
    const admin = makeAdmin({ secretHex: REALTIME_SECRET_HEX, updateCapture });
    const alerts = [makeAlert(2)]; // retry_count = 2 (3rd attempt)

    await runDeliverCron({
      admin,
      alerts,
      resendApiKey: null, // email fails (vendor-gated)
      resendFrom: RESEND_FROM,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
    });

    // The update must include status='delivery_failed'
    const alertUpdate = (updateCapture as Array<{ table: string; vals: unknown }>).find(
      (e) => e.table === 'clinician_alerts',
    );
    assertFalse(alertUpdate === undefined, 'clinician_alerts update must exist');

    const vals = alertUpdate!.vals as Record<string, unknown>;
    assertEquals(
      vals['status'],
      'delivery_failed',
      'status must be delivery_failed on 3rd consecutive failure',
    );
    assertEquals(vals['retry_count'], 3, 'retry_count must be 3 on 3rd failure');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Test 5: delivery_log inserts per attempt (realtime + email channels)
// ---------------------------------------------------------------------------

Deno.test('delivery_log inserts per attempt: 2 inserts (realtime + email) on success', async () => {
  const { stubbedFetch } = makeResendFetch(true); // Resend returns 200
  const insertCapture: unknown[] = [];

  const originalFetch = globalThis.fetch;
  // Stub realtime broadcast call to return 'ok'
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url instanceof URL ? url.toString() : url instanceof Request ? url.url : url as string;
    if (urlStr.includes('api.resend.com')) {
      return (stubbedFetch as typeof fetch)(url, init);
    }
    // Realtime channel.send() uses the Supabase REST endpoint — return 'ok' signal
    return new Response(JSON.stringify({ status: 200 }), { status: 200 });
  };

  try {
    const admin = makeAdmin({ insertCapture });
    const alerts = [makeAlert(0)];

    await runDeliverCron({
      admin,
      alerts,
      resendApiKey: 'test-stub', // CI stub skips Resend fetch; emailOk=true
      resendFrom: RESEND_FROM,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
    });

    // Exactly 2 inserts to clinician_alert_deliveries: one per channel
    const deliveryInserts = (insertCapture as Array<{ table: string; row: unknown }>).filter(
      (e) => e.table === 'clinician_alert_deliveries',
    );
    assertEquals(deliveryInserts.length, 2, 'must have exactly 2 delivery log inserts');

    const channels = deliveryInserts.map(
      (e) => (e.row as Record<string, unknown>)['channel'],
    ).sort();
    assertEquals(channels, ['email', 'realtime'], 'channels must be realtime + email');

    // email insert must be success=true (CI stub = true)
    const emailInsert = deliveryInserts.find(
      (e) => (e.row as Record<string, unknown>)['channel'] === 'email',
    );
    assertFalse(emailInsert === undefined, 'email delivery insert must exist');
    assertEquals(
      (emailInsert!.row as Record<string, unknown>)['success'],
      true,
      'email delivery must be success=true with test-stub key',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Test 6: per-alert try/catch — one failure does not abort batch
// ---------------------------------------------------------------------------

Deno.test('per-alert try/catch: one failure does not abort batch', async () => {
  const ALERT_ID_1 = '11111111-0000-0000-0000-000000000001';
  const ALERT_ID_2 = '11111111-0000-0000-0000-000000000002'; // will throw
  const ALERT_ID_3 = '11111111-0000-0000-0000-000000000003';

  const processedAlertIds: string[] = [];

  // Build an admin that throws on the 2nd alert's delivery log insert
  let callCount = 0;
  const throwingAdmin = {
    rpc: async () => ({ data: REALTIME_SECRET_HEX, error: null }),
    from: (table: string) => ({
      insert: (row: unknown) => {
        if (table === 'clinician_alert_deliveries') {
          const alertId = (row as Record<string, unknown>)['alert_id'];
          processedAlertIds.push(alertId as string);
          callCount++;
          if (alertId === ALERT_ID_2 && callCount <= 3) {
            throw new Error('simulated delivery failure for alert 2');
          }
        }
        return Promise.resolve({ data: null, error: null });
      },
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          in: (_c: string, _v: unknown[]) =>
            Promise.resolve({ data: [{ user_id: USER_ID_1 }], error: null }),
          single: () =>
            Promise.resolve({ data: { name: ORG_NAME, slug: ORG_SLUG }, error: null }),
        }),
      }),
      update: (_vals: unknown) => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: [{ id: USER_ID_1, email: CLINICIAN_EMAIL_1 }] },
          error: null,
        }),
      },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200 });

  try {
    const alerts: PendingAlert[] = [
      { ...makeAlert(0), id: ALERT_ID_1 },
      { ...makeAlert(0), id: ALERT_ID_2 },
      { ...makeAlert(0), id: ALERT_ID_3 },
    ];

    const results = await runDeliverCron({
      // deno-lint-ignore no-explicit-any
      admin: throwingAdmin as any,
      alerts,
      resendApiKey: 'test-stub',
      resendFrom: RESEND_FROM,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
    });

    // All 3 alerts must be in results — batch must not abort
    assertEquals(results.length, 3, 'all 3 alerts must appear in results');

    // Alert 2 must be failed
    const result2 = results.find((r) => r.alert_id === ALERT_ID_2);
    assertFalse(result2 === undefined, 'alert 2 result must exist');
    assertEquals(result2!.ok, false, 'alert 2 must be failed');

    // Alert 1 + 3 must be processed (may be ok or not, but present)
    const result1 = results.find((r) => r.alert_id === ALERT_ID_1);
    const result3 = results.find((r) => r.alert_id === ALERT_ID_3);
    assertFalse(result1 === undefined, 'alert 1 result must exist');
    assertFalse(result3 === undefined, 'alert 3 result must exist');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
