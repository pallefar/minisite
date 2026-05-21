/**
 * Deno tests for `onboarding-funnel-query` Edge Function — Phase 34 Plan 34-09.
 *
 * Proxies two PostHog REST calls (vendor-gated):
 *   - kind='step_funnel'      → POST /api/projects/{pid}/query/ (HogQL Insights)
 *   - kind='list_experiments' → GET  /api/projects/{pid}/feature_flags/?search=onboarding
 *
 * Per [[vendor-gated-send-via-health-check]]: vendor health check short-circuits
 * to 503 BEFORE any outbound traffic when secrets are missing.
 *
 * Test plan:
 *   T1 — vendor unconfigured → 503; no fetch
 *   T2 — auth missing → 401
 *   T3 — admin_role='staff' → 403 forbidden; no fetch
 *   T4 — admin_role='admin' + step_funnel → fetch called; 200 with steps[]
 *   T5 — body validation (invalid uuid) → 400
 *   T6 — cache hit within 60s → fetch NOT called second time
 *   T7 — cache miss for different key → fetch called
 *   T8 — list_experiments branch → GET to feature_flags endpoint; 200 experiments[]
 *   T9 — OPTIONS → 204
 *   T10 — PostHog 500 → 502 posthog_query_failed
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts`.
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const USER_UUID = '11111111-1111-4111-8111-111111111111';
const FLOW_UUID = 'aaaa1111-2222-4333-8444-555566667777';
const VALID_JWT = 'valid-jwt';

function setVendorConfigured(): void {
  Deno.env.set('POSTHOG_PERSONAL_API_KEY', 'phx_test_key');
  Deno.env.set('POSTHOG_PROJECT_ID', '12345');
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-srk');
}

interface FetchCall {
  url: string;
  method?: string;
  body?: string;
  authHeader?: string;
}

interface FakeAdminLog {
  fetches: FetchCall[];
}

interface FakeAdminCfg {
  adminRole: 'superadmin' | 'admin' | 'staff' | null;
  authBehavior?: 'ok' | 'error';
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
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: cfg.adminRole === null ? null : { admin_role: cfg.adminRole },
              error: null,
            }),
        }),
      }),
    }),
  };
}

function installFetchSpy(
  log: FakeAdminLog,
  responder: (url: string, init?: RequestInit) => Response,
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
    return Promise.resolve(responder(url, init));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

function mkReq(opts: { method?: string; jwt?: string; body?: unknown }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/onboarding-funnel-query', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// HogQL Insights mock response shape per PostHog API
function hogqlOk(): Response {
  return new Response(
    JSON.stringify({
      results: [
        ['step_a', 100, 80, 1500],
        ['step_b', 80, 60, 2200],
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function listFlagsOk(): Response {
  return new Response(
    JSON.stringify({
      results: [
        {
          id: 7,
          key: 'onboarding-cta-test',
          name: 'Onboarding CTA test',
          rollout_percentage: 50,
          filters: {
            multivariate: {
              variants: [{ key: 'control' }, { key: 'B' }],
            },
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ---------------------------------------------------------------------------
// T1 — vendor unconfigured → 503; no fetch
// ---------------------------------------------------------------------------

Deno.test('T1: vendor unconfigured → 503 vendor_unconfigured', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  Deno.env.delete('POSTHOG_PERSONAL_API_KEY');
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => hogqlOk());

  try {
    const res = await __internal.handleFunnelQuery(
      mkReq({
        jwt: VALID_JWT,
        body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 14 },
      }),
    );
    assertEquals(res.status, 503);
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
    setVendorConfigured();
  }
});

// ---------------------------------------------------------------------------
// T2 — auth missing → 401
// ---------------------------------------------------------------------------

Deno.test('T2: auth missing → 401', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => hogqlOk());
  try {
    const res = await __internal.handleFunnelQuery(
      mkReq({
        body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 14 },
      }),
    );
    assertEquals(res.status, 401);
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T3 — admin_role='staff' → 403
// ---------------------------------------------------------------------------

Deno.test('T3: admin_role=staff → 403 forbidden; no fetch', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'staff', log }));
  const restore = installFetchSpy(log, () => hogqlOk());

  try {
    const res = await __internal.handleFunnelQuery(
      mkReq({
        jwt: VALID_JWT,
        body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 14 },
      }),
    );
    assertEquals(res.status, 403);
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T4 — admin role + step_funnel → fetch called; 200 with steps[]
// ---------------------------------------------------------------------------

Deno.test('T4: step_funnel as admin → PostHog HogQL POST + 200 steps[]', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => hogqlOk());

  try {
    const res = await __internal.handleFunnelQuery(
      mkReq({
        jwt: VALID_JWT,
        body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 14 },
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      steps: Array<{
        step_id: string;
        views: number;
        completions: number;
        drop_off_pct: number;
        avg_time_ms: number;
      }>;
    };
    assertEquals(body.steps.length, 2);
    assertEquals(body.steps[0].step_id, 'step_a');
    assertEquals(body.steps[0].views, 100);
    assertEquals(body.steps[0].completions, 80);
    assertEquals(body.steps[0].drop_off_pct, 20);
    // Fetch called to /query/ endpoint
    assertEquals(log.fetches.length, 1);
    assert(log.fetches[0].url.includes('/api/projects/12345/query/'));
    assertEquals(log.fetches[0].method, 'POST');
    assertEquals(log.fetches[0].authHeader, 'Bearer phx_test_key');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T5 — body validation: invalid uuid → 400
// ---------------------------------------------------------------------------

Deno.test('T5: invalid flow_id (not uuid) → 400 invalid_body', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => hogqlOk());

  try {
    const res = await __internal.handleFunnelQuery(
      mkReq({
        jwt: VALID_JWT,
        body: {
          kind: 'step_funnel',
          flow_id: "not-a-uuid'; DROP TABLE events; --",
          time_range_days: 14,
        },
      }),
    );
    assertEquals(res.status, 400);
    assertEquals(log.fetches.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T6 — cache hit within 60s → fetch NOT called the second time
// ---------------------------------------------------------------------------

Deno.test('T6: cache hit within 60s → only one fetch', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => hogqlOk());

  try {
    const req1 = mkReq({
      jwt: VALID_JWT,
      body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 14 },
    });
    const req2 = mkReq({
      jwt: VALID_JWT,
      body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 14 },
    });
    const r1 = await __internal.handleFunnelQuery(req1);
    const r2 = await __internal.handleFunnelQuery(req2);
    assertEquals(r1.status, 200);
    assertEquals(r2.status, 200);
    assertEquals(log.fetches.length, 1);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T7 — cache MISS for a different key → second fetch fires
// ---------------------------------------------------------------------------

Deno.test('T7: different cache key → fetch fires twice', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => hogqlOk());

  try {
    const r1 = await __internal.handleFunnelQuery(
      mkReq({
        jwt: VALID_JWT,
        body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 14 },
      }),
    );
    const r2 = await __internal.handleFunnelQuery(
      mkReq({
        jwt: VALID_JWT,
        body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 30 },
      }),
    );
    assertEquals(r1.status, 200);
    assertEquals(r2.status, 200);
    assertEquals(log.fetches.length, 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T8 — list_experiments branch → GET feature_flags + 200 experiments[]
// ---------------------------------------------------------------------------

Deno.test('T8: list_experiments → GET feature_flags + shaped response', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => listFlagsOk());

  try {
    const res = await __internal.handleFunnelQuery(
      mkReq({ jwt: VALID_JWT, body: { kind: 'list_experiments' } }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      experiments: Array<{
        id: number;
        key: string;
        name: string;
        current_rollout: number;
        variants: string[];
      }>;
    };
    assertEquals(body.experiments.length, 1);
    assertEquals(body.experiments[0].id, 7);
    assertEquals(body.experiments[0].key, 'onboarding-cta-test');
    assertEquals(body.experiments[0].current_rollout, 50);
    assertEquals(body.experiments[0].variants, ['control', 'B']);
    assertEquals(log.fetches.length, 1);
    assertEquals(log.fetches[0].method, 'GET');
    assert(log.fetches[0].url.includes('/api/projects/12345/feature_flags/'));
    assert(log.fetches[0].url.includes('search=onboarding'));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T9 — OPTIONS → 204
// ---------------------------------------------------------------------------

Deno.test('T9: OPTIONS preflight → 204', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => hogqlOk());

  try {
    const res = await __internal.handleFunnelQuery(mkReq({ method: 'OPTIONS' }));
    assertEquals(res.status, 204);
    assert(res.headers.get('Access-Control-Allow-Origin') !== null);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T10 — PostHog 500 → 502 posthog_query_failed
// ---------------------------------------------------------------------------

Deno.test('T10: PostHog 500 → 502 posthog_query_failed', async () => {
  __internal.resetAdminForTest();
  __internal.clearCache();
  setVendorConfigured();
  const log: FakeAdminLog = { fetches: [] };
  __internal.setAdminForTest(makeFakeAdmin({ adminRole: 'admin', log }));
  const restore = installFetchSpy(log, () => new Response('internal', { status: 500 }));

  try {
    const res = await __internal.handleFunnelQuery(
      mkReq({
        jwt: VALID_JWT,
        body: { kind: 'step_funnel', flow_id: FLOW_UUID, time_range_days: 14 },
      }),
    );
    assertEquals(res.status, 502);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'posthog_query_failed');
  } finally {
    restore();
  }
});
