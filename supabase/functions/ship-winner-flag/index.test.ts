/**
 * Deno tests for `ship-winner-flag` Edge Function — Phase 34 Plan 34-09.
 *
 * Per CONTEXT D-17 + memory [[vendor-gated-send-via-health-check]]:
 *  - The function builds the full prod path (PostHog REST PATCH + audit_logs)
 *    but returns 503 with NO outbound traffic when the vendor secret env vars
 *    are unset. Plan 34-10's human checkpoint sets these secrets.
 *
 * Test plan (10 behaviors from 34-09-PLAN.md Task 1 <behavior>):
 *   T1 — POSTHOG_PERSONAL_API_KEY unset → 503 vendor_unconfigured; no fetch
 *   T2 — POSTHOG_PROJECT_ID unset → 503 vendor_unconfigured; no fetch
 *   T3 — Both secrets set + no auth → 401
 *   T4 — Both secrets set + auth valid + admin_role='admin' → 403 forbidden_not_superadmin
 *   T5 — superadmin → fetch PATCH called to correct URL; 200 ok
 *   T6 — PostHog returns 403 → 403 posthog_patch_failed
 *   T7 — PostHog returns 500 → 502 posthog_patch_failed
 *   T8 — Body missing flag_id → 400 invalid_body
 *   T9 — OPTIONS → 204 CORS preflight
 *   T10 — Audit insert error does NOT change the 200 response (best-effort)
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts`.
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const USER_UUID = '11111111-1111-4111-8111-111111111111';
const VALID_JWT = 'valid-jwt';

// ---------------------------------------------------------------------------
// Env helpers — flip secrets per test case
// ---------------------------------------------------------------------------

function setVendorConfigured(): void {
  Deno.env.set('POSTHOG_PERSONAL_API_KEY', 'phx_test_key');
  Deno.env.set('POSTHOG_PROJECT_ID', '12345');
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk');
}

function unsetVendor(which: 'key' | 'project' | 'both'): void {
  if (which === 'key' || which === 'both') Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  if (which === 'project' || which === 'both') Deno.env.delete('POSTHOG_PROJECT_ID');
}

// ---------------------------------------------------------------------------
// Fake admin + fetch spy
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method?: string;
  body?: string;
  authHeader?: string;
}

interface FakeAdminLog {
  fetches: FetchCall[];
  auditInserts: Array<Record<string, unknown>>;
}

interface FakeAdminCfg {
  adminRole: 'superadmin' | 'admin' | null;
  authBehavior?: 'ok' | 'error';
  auditBehavior?: 'ok' | 'error';
  log: FakeAdminLog;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminCfg): any {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (cfg.authBehavior === 'error') {
          return Promise.resolve({ data: { user: null }, error: { message: 'invalid_jwt' } });
        }
        return Promise.resolve({ data: { user: { id: USER_UUID } }, error: null });
      },
    },
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: () => {
            if (table === 'profiles') {
              return Promise.resolve({
                data: cfg.adminRole === null ? null : { admin_role: cfg.adminRole },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        cfg.log.auditInserts.push(row);
        if (cfg.auditBehavior === 'error') {
          return Promise.resolve({ data: null, error: { message: 'audit_insert_failed' } });
        }
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
}

function installFetchSpy(
  log: FakeAdminLog,
  responder: (url: string) => Response,
): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const authHeader = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    log.fetches.push({ url, method: init?.method, body, authHeader });
    return Promise.resolve(responder(url));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

function mkReq(opts: { method?: string; jwt?: string; body?: unknown }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/ship-winner-flag', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// ---------------------------------------------------------------------------
// T1 — POSTHOG_PERSONAL_API_KEY unset → 503; no fetch
// ---------------------------------------------------------------------------

Deno.test('T1: POSTHOG_PERSONAL_API_KEY unset → 503 vendor_unconfigured', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  unsetVendor('key');
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'superadmin', log }));
  const restore = installFetchSpy(log, () => new Response('{}', { status: 200 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ jwt: VALID_JWT, body: { flag_id: '42', variant: 'B' } }),
    );
    assertEquals(res.status, 503);
    const body = (await res.json()) as { error: string; service: string };
    assertEquals(body.error, 'vendor_unconfigured');
    assertEquals(body.service, 'posthog');
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
    setVendorConfigured();
  }
});

// ---------------------------------------------------------------------------
// T2 — POSTHOG_PROJECT_ID unset → 503; no fetch
// ---------------------------------------------------------------------------

Deno.test('T2: POSTHOG_PROJECT_ID unset → 503 vendor_unconfigured', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  unsetVendor('project');
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'superadmin', log }));
  const restore = installFetchSpy(log, () => new Response('{}', { status: 200 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ jwt: VALID_JWT, body: { flag_id: '42', variant: 'B' } }),
    );
    assertEquals(res.status, 503);
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
    setVendorConfigured();
  }
});

// ---------------------------------------------------------------------------
// T3 — Both secrets set + no auth → 401
// ---------------------------------------------------------------------------

Deno.test('T3: secrets set + no auth → 401 unauthenticated', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'superadmin', log }));
  const restore = installFetchSpy(log, () => new Response('{}', { status: 200 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ body: { flag_id: '42', variant: 'B' } }),
    );
    assertEquals(res.status, 401);
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T4 — auth valid + admin (not superadmin) → 403 forbidden_not_superadmin
// ---------------------------------------------------------------------------

Deno.test('T4: admin role (non-superadmin) → 403 forbidden_not_superadmin; no fetch', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => new Response('{}', { status: 200 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ jwt: VALID_JWT, body: { flag_id: '42', variant: 'B' } }),
    );
    assertEquals(res.status, 403);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'forbidden_not_superadmin');
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T5 — superadmin → PATCH called to correct URL; 200 ok
// ---------------------------------------------------------------------------

Deno.test('T5: superadmin → PostHog PATCH + 200 ok', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'superadmin', log }));
  const restore = installFetchSpy(log, () => new Response('{"ok":true}', { status: 200 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ jwt: VALID_JWT, body: { flag_id: '42', variant: 'B' } }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { ok: boolean; flag_id: string; variant: string };
    assertEquals(body.ok, true);
    assertEquals(body.flag_id, '42');
    assertEquals(body.variant, 'B');
    // Verify the PATCH call shape
    assertEquals(log.fetches.length, 1);
    const call = log.fetches[0];
    assertEquals(call.method, 'PATCH');
    assert(call.url.includes('/api/projects/12345/feature_flags/42/'));
    assertEquals(call.authHeader, 'Bearer phx_test_key');
    // Audit row inserted
    assertEquals(log.auditInserts.length, 1);
    assertEquals(log.auditInserts[0].action, 'onboarding.ship_winner');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T6 — PostHog returns 403 → 403 posthog_patch_failed
// ---------------------------------------------------------------------------

Deno.test('T6: PostHog 403 → 403 posthog_patch_failed', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'superadmin', log }));
  const restore = installFetchSpy(log, () => new Response('forbidden', { status: 403 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ jwt: VALID_JWT, body: { flag_id: '42', variant: 'B' } }),
    );
    assertEquals(res.status, 403);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'posthog_patch_failed');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T7 — PostHog returns 500 → 502 posthog_patch_failed
// ---------------------------------------------------------------------------

Deno.test('T7: PostHog 500 → 502 posthog_patch_failed', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'superadmin', log }));
  const restore = installFetchSpy(log, () => new Response('internal', { status: 500 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ jwt: VALID_JWT, body: { flag_id: '42', variant: 'B' } }),
    );
    assertEquals(res.status, 502);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'posthog_patch_failed');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T8 — body missing flag_id → 400
// ---------------------------------------------------------------------------

Deno.test('T8: body missing flag_id → 400 invalid_body', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'superadmin', log }));
  const restore = installFetchSpy(log, () => new Response('{}', { status: 200 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ jwt: VALID_JWT, body: { variant: 'B' } }),
    );
    assertEquals(res.status, 400);
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T9 — OPTIONS → 204 (CORS preflight)
// ---------------------------------------------------------------------------

Deno.test('T9: OPTIONS preflight → 204 with CORS headers', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'superadmin', log }));
  const restore = installFetchSpy(log, () => new Response('{}', { status: 200 }));

  try {
    const res = await __internal.handleShipWinner(mkReq({ method: 'OPTIONS' }));
    assertEquals(res.status, 204);
    assert(res.headers.get('Access-Control-Allow-Origin') !== null);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T10 — Audit insert error does NOT change the 200 response (best-effort)
// ---------------------------------------------------------------------------

Deno.test('T10: audit insert error → still returns 200', async () => {
  __internal.resetAdminForTest();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [], auditInserts: [] };
  __internal.setAdminForTest(
    makeFakeAdmin({ adminRole: 'superadmin', auditBehavior: 'error', log }),
  );
  const restore = installFetchSpy(log, () => new Response('{}', { status: 200 }));

  try {
    const res = await __internal.handleShipWinner(
      mkReq({ jwt: VALID_JWT, body: { flag_id: '42', variant: 'B' } }),
    );
    assertEquals(res.status, 200);
  } finally {
    restore();
  }
});
