/**
 * handler.test.ts — Deno tests for bs-status-poller handler.
 *
 * Phase 67 Plan 67-04 (OPS-10).
 *
 * Behavior covered:
 *  1. GET /healthz → 200 { ok:true }
 *  2. POST without bearer → 401
 *  3. POST with wrong bearer → 401
 *  4. BETTER_STACK_API_KEY missing → 503
 *  5. BETTER_STACK_API_KEY placeholder ('REPLACE_ME') → 503
 *  6. All indicators=none → polled=3, incidents_created=0
 *  7. One vendor 'minor' → 1 incident created
 *  8. All 3 vendors with 'minor'|'major'|'critical' → 3 incidents created
 *  9. Better Stack POST fails (500) → incidents_failed=1
 * 10. Upstream fetch fails (network) → indicator coerced to 'minor' + incident created
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handle, DEFAULT_ENDPOINTS, type BsStatusPollerDeps } from '../handler.ts';

const SERVICE_ROLE_KEY = 'test-service-role-key';
const VALID_BS_KEY = 'bs_test_key_abc123';

interface MockFetchCall {
  url: string;
  init?: RequestInit;
}

interface MockFetchOpts {
  /** Per-URL substring → response config. */
  responses: Array<{
    matches: string;
    body: unknown;
    status?: number;
    throwError?: string;
  }>;
}

function buildMockFetch(opts: MockFetchOpts): {
  fetchImpl: typeof fetch;
  calls: MockFetchCall[];
} {
  const calls: MockFetchCall[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    const cfg = opts.responses.find((r) => url.includes(r.matches));
    if (!cfg) {
      return Promise.reject(new Error(`No mock for ${url}`));
    }
    if (cfg.throwError) {
      return Promise.reject(new Error(cfg.throwError));
    }
    return Promise.resolve(
      new Response(JSON.stringify(cfg.body), {
        status: cfg.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function buildDeps(overrides?: Partial<BsStatusPollerDeps>): BsStatusPollerDeps {
  return {
    fetchImpl: globalThis.fetch,
    serviceRoleKey: SERVICE_ROLE_KEY,
    betterStackApiKey: VALID_BS_KEY,
    requesterEmail: 'noreply@leanshot.app',
    endpoints: DEFAULT_ENDPOINTS,
    ...overrides,
  };
}

function statusJson(indicator: string, description = '') {
  return {
    page: { id: 'mock' },
    status: { indicator, description },
  };
}

// ─── Test 1: GET /healthz ────────────────────────────────────────────────────

Deno.test('GET /healthz returns 200 ok', async () => {
  const req = new Request('http://localhost/bs-status-poller/healthz', { method: 'GET' });
  const res = await handle(req, buildDeps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'bs-status-poller');
});

// ─── Test 2: POST without bearer ─────────────────────────────────────────────

Deno.test('POST without Authorization header returns 401', async () => {
  const req = new Request('http://localhost/bs-status-poller', { method: 'POST' });
  const res = await handle(req, buildDeps());
  assertEquals(res.status, 401);
});

// ─── Test 3: POST with wrong bearer ──────────────────────────────────────────

Deno.test('POST with wrong bearer returns 401', async () => {
  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong-key' },
  });
  const res = await handle(req, buildDeps());
  assertEquals(res.status, 401);
});

// ─── Test 4: BETTER_STACK_API_KEY missing ────────────────────────────────────

Deno.test('Missing BETTER_STACK_API_KEY returns 503', async () => {
  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ betterStackApiKey: '' }));
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error, 'better_stack_api_key_not_configured');
});

// ─── Test 5: BETTER_STACK_API_KEY placeholder ────────────────────────────────

Deno.test("Placeholder 'REPLACE_ME' BETTER_STACK_API_KEY returns 503", async () => {
  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ betterStackApiKey: 'REPLACE_ME' }));
  assertEquals(res.status, 503);
});

Deno.test("Placeholder '[bracketed]' BETTER_STACK_API_KEY returns 503", async () => {
  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ betterStackApiKey: '[fill-me-in]' }));
  assertEquals(res.status, 503);
});

// ─── Test 6: All indicators=none ─────────────────────────────────────────────

Deno.test('All vendors none → 0 incidents created', async () => {
  const { fetchImpl, calls } = buildMockFetch({
    responses: [
      { matches: 'status.sentry.io', body: statusJson('none') },
      { matches: 'status.supabase.com', body: statusJson('none') },
      { matches: 'vercel-status.com', body: statusJson('none') },
      { matches: 'uptime.betterstack.com', body: {} },
    ],
  });

  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ fetchImpl }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.polled, 3);
  assertEquals(body.incidents_created, 0);
  assertEquals(body.incidents_failed, 0);
  // Better Stack should NOT be called when all indicators are none
  const bsCalls = calls.filter((c) => c.url.includes('uptime.betterstack.com'));
  assertEquals(bsCalls.length, 0);
});

// ─── Test 7: One vendor minor → 1 incident ───────────────────────────────────

Deno.test('One vendor minor → 1 incident created', async () => {
  const { fetchImpl, calls } = buildMockFetch({
    responses: [
      { matches: 'status.sentry.io', body: statusJson('minor', 'Elevated latency') },
      { matches: 'status.supabase.com', body: statusJson('none') },
      { matches: 'vercel-status.com', body: statusJson('none') },
      { matches: 'uptime.betterstack.com', body: { data: { id: 'inc_123' } }, status: 201 },
    ],
  });

  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ fetchImpl }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.polled, 3);
  assertEquals(body.incidents_created, 1);
  assertEquals(body.incidents_failed, 0);
  assertEquals(body.incidents[0].vendor, 'Sentry');
  assertEquals(body.incidents[0].indicator, 'minor');
  assertEquals(body.incidents[0].incident_id, 'inc_123');

  const bsCalls = calls.filter((c) => c.url.includes('uptime.betterstack.com'));
  assertEquals(bsCalls.length, 1);
  // Verify auth header set on Better Stack call
  const authHeader = (bsCalls[0].init?.headers as Record<string, string>)?.Authorization;
  assertEquals(authHeader, `Bearer ${VALID_BS_KEY}`);
});

// ─── Test 8: All 3 vendors with non-none indicators → 3 incidents ───────────

Deno.test('All 3 vendors minor|major|critical → 3 incidents created', async () => {
  const { fetchImpl } = buildMockFetch({
    responses: [
      { matches: 'status.sentry.io', body: statusJson('minor') },
      { matches: 'status.supabase.com', body: statusJson('major') },
      { matches: 'vercel-status.com', body: statusJson('critical') },
      { matches: 'uptime.betterstack.com', body: { data: { id: 'inc_x' } }, status: 201 },
    ],
  });

  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ fetchImpl }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.polled, 3);
  assertEquals(body.incidents_created, 3);

  const indicators = body.incidents.map((i: { indicator: string }) => i.indicator).sort();
  assertEquals(indicators, ['critical', 'major', 'minor']);
});

// ─── Test 9: Better Stack POST fails → incidents_failed=1 ────────────────────

Deno.test('Better Stack 500 → incidents_failed=1', async () => {
  const { fetchImpl } = buildMockFetch({
    responses: [
      { matches: 'status.sentry.io', body: statusJson('major') },
      { matches: 'status.supabase.com', body: statusJson('none') },
      { matches: 'vercel-status.com', body: statusJson('none') },
      { matches: 'uptime.betterstack.com', body: { error: 'oops' }, status: 500 },
    ],
  });

  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ fetchImpl }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.incidents_created, 0);
  assertEquals(body.incidents_failed, 1);
  assertEquals(body.incidents[0].ok, false);
});

// ─── Test 10: Upstream fetch throws → indicator='minor' + incident created ───

Deno.test('Upstream fetch throws → coerced to minor + incident created', async () => {
  const { fetchImpl } = buildMockFetch({
    responses: [
      { matches: 'status.sentry.io', body: {}, throwError: 'network down' },
      { matches: 'status.supabase.com', body: statusJson('none') },
      { matches: 'vercel-status.com', body: statusJson('none') },
      { matches: 'uptime.betterstack.com', body: { data: { id: 'inc_net' } }, status: 201 },
    ],
  });

  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ fetchImpl }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.polled, 3);
  assertEquals(body.incidents_created, 1);
  assertEquals(body.statuses[0].vendor, 'Sentry');
  assertEquals(body.statuses[0].indicator, 'minor');
});

// ─── Test 11: Upstream 503 → indicator='minor' + incident created ────────────

Deno.test('Upstream HTTP 503 → coerced to minor + incident created', async () => {
  const { fetchImpl } = buildMockFetch({
    responses: [
      { matches: 'status.sentry.io', body: { err: 'down' }, status: 503 },
      { matches: 'status.supabase.com', body: statusJson('none') },
      { matches: 'vercel-status.com', body: statusJson('none') },
      { matches: 'uptime.betterstack.com', body: { data: { id: 'x' } }, status: 201 },
    ],
  });

  const req = new Request('http://localhost/bs-status-poller', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handle(req, buildDeps({ fetchImpl }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.statuses[0].indicator, 'minor');
  assertEquals(body.statuses[0].raw_status_code, 503);
});

// ─── Test 12: Method not allowed ─────────────────────────────────────────────

Deno.test('PUT returns 405 method_not_allowed', async () => {
  const req = new Request('http://localhost/bs-status-poller', { method: 'PUT' });
  const res = await handle(req, buildDeps());
  assertEquals(res.status, 405);
});
