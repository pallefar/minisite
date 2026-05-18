/**
 * affiliate-anomaly-sla-reminder/index.test.ts — Phase 26 Plan 26-02.
 *
 * Behaviors:
 *   1. Missing or wrong bearer → 401 (constant-time compare).
 *   2. No pending items → 200 { sent: false, reason: 'no_pending_items' }.
 *   3. Pending items present → 200 { sent: true, count: N }.
 *   4. Email body PHI-clean (Phase 25 D-09): NEVER includes 'patient',
 *      'medication', 'dose', 'diagnosis' keywords.
 *   5. Email body summary lines contain ONLY {affiliate_id, z_score,
 *      flagged-since timestamp} — no user_id, no PII.
 */

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('ADMIN_REVIEW_EMAIL_TO', 'review@leanshot.app');
Deno.env.set('RESEND_API_KEY', 'test-resend-key');

const { handleRun, __internal } = await import('./index.ts');

// ─── Fake admin builder ──────────────────────────────────────────────────────
interface ConvRow {
  id: string;
  affiliate_id: string;
  anomaly_z_score: number | null;
  created_at: string;
}

interface FakeAdminOpts {
  rows?: ConvRow[];
  queryErr?: { message: string } | null;
}

function buildFakeAdmin(opts: FakeAdminOpts) {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: unknown) {
              return {
                is(_c2: string, _v2: unknown) {
                  return {
                    lt(_c3: string, _v3: unknown) {
                      return {
                        order(_c4: string, _opts: unknown) {
                          return {
                            limit(_n: number) {
                              return Promise.resolve({
                                data: opts.rows ?? [],
                                error: opts.queryErr ?? null,
                              });
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

// ─── Fake fetch to capture Resend POST ───────────────────────────────────────
let lastFetchInit: RequestInit | null = null;
let lastFetchUrl: string | URL | Request | null = null;
const originalFetch = globalThis.fetch;
function installFakeFetch(status = 200): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    lastFetchUrl = url;
    lastFetchInit = init ?? null;
    return Promise.resolve(new Response(JSON.stringify({ id: 'em_fake' }), { status }));
  };
}
function restoreFetch(): void {
  globalThis.fetch = originalFetch;
  lastFetchUrl = null;
  lastFetchInit = null;
}

function buildAuthedRequest(token: string = 'test-service-role-key'): Request {
  return new Request('https://leanshot.app/functions/v1/affiliate-anomaly-sla-reminder', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('1a. missing Authorization → 401', async () => {
  __internal.setAdminForTest(buildFakeAdmin({ rows: [] }));
  try {
    const req = new Request('https://leanshot.app/functions/v1/affiliate-anomaly-sla-reminder', {
      method: 'POST',
    });
    const res = await handleRun(req);
    assertEquals(res.status, 401);
  } finally {
    __internal.setAdminForTest(null);
  }
});

Deno.test('1b. wrong bearer → 401 (constant-time)', async () => {
  __internal.setAdminForTest(buildFakeAdmin({ rows: [] }));
  try {
    const res = await handleRun(buildAuthedRequest('not-the-real-key'));
    assertEquals(res.status, 401);
  } finally {
    __internal.setAdminForTest(null);
  }
});

Deno.test('2. no pending items → 200 { sent: false }', async () => {
  __internal.setAdminForTest(buildFakeAdmin({ rows: [] }));
  try {
    const res = await handleRun(buildAuthedRequest());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.sent, false);
    assertEquals(body.reason, 'no_pending_items');
  } finally {
    __internal.setAdminForTest(null);
  }
});

Deno.test('3. pending items present → calls Resend + returns sent:true, count=N', async () => {
  installFakeFetch();
  __internal.setAdminForTest(
    buildFakeAdmin({
      rows: [
        {
          id: 'conv-1',
          affiliate_id: 'aff-1',
          anomaly_z_score: 5.4,
          created_at: '2026-05-10T12:00:00Z',
        },
        {
          id: 'conv-2',
          affiliate_id: 'aff-2',
          anomaly_z_score: 7.1,
          created_at: '2026-05-09T08:30:00Z',
        },
      ],
    }),
  );
  try {
    const res = await handleRun(buildAuthedRequest());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.sent, true);
    assertEquals(body.count, 2);
    assert(lastFetchUrl !== null, 'fetch should have been called');
    assertEquals(String(lastFetchUrl), 'https://api.resend.com/emails');
  } finally {
    __internal.setAdminForTest(null);
    restoreFetch();
  }
});

Deno.test('4. email body is PHI-clean (no patient/medication/dose/diagnosis)', async () => {
  installFakeFetch();
  __internal.setAdminForTest(
    buildFakeAdmin({
      rows: [
        {
          id: 'conv-1',
          affiliate_id: 'aff-x',
          anomaly_z_score: 9.9,
          created_at: '2026-05-10T12:00:00Z',
        },
      ],
    }),
  );
  try {
    await handleRun(buildAuthedRequest());
    assert(lastFetchInit !== null);
    const body = JSON.parse(lastFetchInit!.body as string);
    const bodyText = `${body.subject ?? ''}\n${body.text ?? ''}`.toLowerCase();
    assert(!bodyText.includes('patient'), 'PHI lint: email body must not contain "patient"');
    assert(!bodyText.includes('medication'), 'PHI lint: email body must not contain "medication"');
    assert(!bodyText.includes('dose'), 'PHI lint: email body must not contain "dose"');
    assert(!bodyText.includes('diagnosis'), 'PHI lint: email body must not contain "diagnosis"');
  } finally {
    __internal.setAdminForTest(null);
    restoreFetch();
  }
});

Deno.test('5. email body summary contains affiliate_id + z_score + created_at only', async () => {
  installFakeFetch();
  const created = '2026-05-10T12:00:00Z';
  __internal.setAdminForTest(
    buildFakeAdmin({
      rows: [
        {
          id: 'conv-9',
          affiliate_id: 'aff-uniq-marker',
          anomaly_z_score: 4.21,
          created_at: created,
        },
      ],
    }),
  );
  try {
    await handleRun(buildAuthedRequest());
    assert(lastFetchInit !== null);
    const body = JSON.parse(lastFetchInit!.body as string);
    const text = body.text as string;
    assertStringIncludes(text, 'aff-uniq-marker');
    assertStringIncludes(text, '4.21');
    assertStringIncludes(text, created);
    // Negative — conversion id MUST NOT appear (it could correlate to a user).
    assert(!text.includes('conv-9'), 'conversion id is internal — keep out of email body');
  } finally {
    __internal.setAdminForTest(null);
    restoreFetch();
  }
});

Deno.test('6. query error → 500 with error envelope', async () => {
  __internal.setAdminForTest(
    buildFakeAdmin({ queryErr: { message: 'simulated postgres error' } }),
  );
  try {
    const res = await handleRun(buildAuthedRequest());
    assertEquals(res.status, 500);
  } finally {
    __internal.setAdminForTest(null);
  }
});
