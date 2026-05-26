/**
 * handler.test.ts — Deno tests for nexus-monitor handler.
 *
 * Phase 65 Plan 65-08 (PAY-04).
 *
 * 11 behavior cases:
 *  1.  GET /healthz → 200
 *  2.  POST / without bearer → 401
 *  3.  POST / refreshes matview via refresh_nexus_revenue RPC
 *  4.  POST / classifies states across all tiers (safe / monitoring / at_risk / nexus_established)
 *  5.  POST / fires Slack alert for at_risk state (CA at 81%)
 *  6.  POST / fires CRITICAL Slack alert for nexus_established state (TX at 102%)
 *  7.  POST / does NOT fire duplicate alert when nexus_alert_log has entry within 23h
 *  8.  POST / records nexus_alert_log row after firing Slack alert
 *  9.  POST / returns { refreshed:true, alerts_fired, alerts_skipped, states_checked }
 *  10. Slack webhook failure: logs error + still records alert_log row (23h gate works)
 *  11. POST / with SLACK_GUARDRAIL_WEBHOOK_URL unset → 503 early-exit
 */

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handle } from '../handler.ts';
import type { NexusMonitorDeps } from '../handler.ts';

// ── Mock constants ──────────────────────────────────────────────────────────

const MOCK_SERVICE_ROLE_KEY = 'test-service-role-key';
const MOCK_SUPABASE_URL = 'https://test.supabase.co';
const MOCK_SLACK_URL = 'https://hooks.slack.com/services/T000/B000/test';

// Proximity fixtures spanning every tier.
// thresholds.threshold_amount_cents matches 65-01's seed (CA/TX = $500k = 50_000_000_000c).
type ProximityRow = {
  state: string;
  state_name: string;
  threshold_amount_cents: number;
  revenue_cents: number;
  proximity_percent: number;
};

const PROX_ALL_TIERS: ProximityRow[] = [
  // safe (<60)
  { state: 'AZ', state_name: 'Arizona',   threshold_amount_cents: 10000000000, revenue_cents:  1000000000, proximity_percent:  10.0 },
  // monitoring (60-79)
  { state: 'WA', state_name: 'Washington', threshold_amount_cents: 10000000000, revenue_cents:  7000000000, proximity_percent:  70.0 },
  // at_risk (80-99)
  { state: 'CA', state_name: 'California', threshold_amount_cents: 50000000000, revenue_cents: 40500000000, proximity_percent:  81.0 },
  // nexus_established (≥100)
  { state: 'TX', state_name: 'Texas',      threshold_amount_cents: 50000000000, revenue_cents: 51000000000, proximity_percent: 102.0 },
];

// ── Mock Supabase client ────────────────────────────────────────────────────

interface MockOpts {
  proximityRows?: ProximityRow[];
  recentlyAlerted?: Array<{ state: string; alert_tier: string }>; // 23h-gate hits
  refreshRpcError?: { message: string } | null;
  proximityRpcError?: { message: string } | null;
}

interface MockClient {
  rpc_calls: Array<{ fn: string; params: unknown }>;
  inserted_rows: Array<Record<string, unknown>>;
  client: unknown;
}

function buildMockClient(opts: MockOpts = {}): MockClient {
  const proximityRows = opts.proximityRows ?? PROX_ALL_TIERS;
  const recentlyAlerted = opts.recentlyAlerted ?? [];
  const rpc_calls: Array<{ fn: string; params: unknown }> = [];
  const inserted_rows: Array<Record<string, unknown>> = [];

  const client = {
    rpc: (fn: string, params: unknown) => {
      rpc_calls.push({ fn, params });
      if (fn === 'refresh_nexus_revenue') {
        return Promise.resolve({
          data: null,
          error: opts.refreshRpcError ?? null,
        });
      }
      if (fn === 'get_nexus_proximity') {
        return {
          select: () => Promise.resolve({
            data: proximityRows,
            error: opts.proximityRpcError ?? null,
          }),
        };
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc: ${fn}` } });
    },
    from: (table: string) => {
      if (table === 'nexus_alert_log') {
        return {
          insert: (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const r = Array.isArray(row) ? row[0] : row;
            inserted_rows.push(r);
            return {
              select: () => Promise.resolve({ data: [r], error: null }),
            };
          },
          // 23h de-dup gate query:
          //   .from('nexus_alert_log').select('id').eq('state',?).eq('alert_tier',?)
          //     .gt('alerted_at', isoCutoff).limit(1).maybeSingle()
          select: (_cols?: string) => {
            const builder = {
              _state: undefined as string | undefined,
              _tier: undefined as string | undefined,
              eq(col: string, val: string) {
                if (col === 'state') this._state = val;
                if (col === 'alert_tier') this._tier = val;
                return this;
              },
              gt(_col: string, _val: string) {
                return this;
              },
              limit(_n: number) {
                return this;
              },
              maybeSingle() {
                const hit = recentlyAlerted.find(
                  (r) => r.state === this._state && r.alert_tier === this._tier,
                );
                return Promise.resolve({
                  data: hit ? { id: 'existing-id' } : null,
                  error: null,
                });
              },
            };
            return builder;
          },
        };
      }
      // Unknown table — return empty/no-op chain
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              gt: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  };

  return { rpc_calls, inserted_rows, client };
}

// ── Mock fetch (Slack webhook capture) ──────────────────────────────────────

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
}

function buildMockFetch(opts: { slackFails?: boolean } = {}): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(init.body as string) : null;
    } catch {
      body = init?.body;
    }
    calls.push({ url, init, body });
    if (opts.slackFails) {
      return Promise.resolve(new Response('slack down', { status: 500 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

// ── Helper: build deps + POST request with valid bearer ─────────────────────

function buildDeps(overrides: Partial<NexusMonitorDeps> = {}): NexusMonitorDeps {
  const mock = buildMockClient();
  const mockFetch = buildMockFetch();
  return {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: MOCK_SLACK_URL,
    ...overrides,
  };
}

function buildPostReq(): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MOCK_SERVICE_ROLE_KEY}` },
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

Deno.test('1. GET /healthz returns 200', async () => {
  const res = await handle(
    new Request('http://localhost/healthz', { method: 'GET' }),
    buildDeps(),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'nexus-monitor');
});

Deno.test('2. POST / without bearer returns 401', async () => {
  const res = await handle(
    new Request('http://localhost/', { method: 'POST' }),
    buildDeps(),
  );
  assertEquals(res.status, 401);
});

Deno.test('3. POST / refreshes matview via refresh_nexus_revenue RPC', async () => {
  const mock = buildMockClient();
  const mockFetch = buildMockFetch();
  const res = await handle(buildPostReq(), {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: MOCK_SLACK_URL,
  });
  assertEquals(res.status, 200);
  const refreshCall = mock.rpc_calls.find((c) => c.fn === 'refresh_nexus_revenue');
  assertEquals(!!refreshCall, true, 'refresh_nexus_revenue RPC must be invoked');
});

Deno.test('4. POST / classifies states across all tiers', async () => {
  const mock = buildMockClient();
  const mockFetch = buildMockFetch();
  const res = await handle(buildPostReq(), {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: MOCK_SLACK_URL,
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  // 4 states in: 1 safe, 1 monitoring, 1 at_risk, 1 nexus_established → 3 alerts fired
  assertEquals(body.states_checked, 4);
  assertEquals(body.alerts_fired, 3);
  assertEquals(body.alerts_skipped, 0);
});

Deno.test('5. POST / fires Slack alert for at_risk state (CA 81%)', async () => {
  const mock = buildMockClient({
    proximityRows: [{
      state: 'CA',
      state_name: 'California',
      threshold_amount_cents: 50000000000,
      revenue_cents: 40500000000,
      proximity_percent: 81.0,
    }],
  });
  const mockFetch = buildMockFetch();
  const res = await handle(buildPostReq(), {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: MOCK_SLACK_URL,
  });
  assertEquals(res.status, 200);
  assertEquals(mockFetch.calls.length, 1, 'one Slack alert fired');
  assertEquals(mockFetch.calls[0].url, MOCK_SLACK_URL);
  const sent = mockFetch.calls[0].body as { text?: string; attachments?: Array<{ title?: string; text?: string }> };
  const text = JSON.stringify(sent);
  assertStringIncludes(text, 'AT RISK');
  assertStringIncludes(text, 'California');
  assertStringIncludes(text, '81');
});

Deno.test('6. POST / fires CRITICAL Slack alert for nexus_established state (TX 102%)', async () => {
  const mock = buildMockClient({
    proximityRows: [{
      state: 'TX',
      state_name: 'Texas',
      threshold_amount_cents: 50000000000,
      revenue_cents: 51000000000,
      proximity_percent: 102.0,
    }],
  });
  const mockFetch = buildMockFetch();
  const res = await handle(buildPostReq(), {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: MOCK_SLACK_URL,
  });
  assertEquals(res.status, 200);
  assertEquals(mockFetch.calls.length, 1);
  const sent = mockFetch.calls[0].body as Record<string, unknown>;
  const text = JSON.stringify(sent);
  assertStringIncludes(text, 'NEXUS ESTABLISHED');
  assertStringIncludes(text, 'REGISTRATION REQUIRED');
  assertStringIncludes(text, 'Texas');
});

Deno.test('7. POST / does NOT fire duplicate alert when nexus_alert_log has 23h entry', async () => {
  const mock = buildMockClient({
    proximityRows: [{
      state: 'CA',
      state_name: 'California',
      threshold_amount_cents: 50000000000,
      revenue_cents: 40500000000,
      proximity_percent: 81.0,
    }],
    recentlyAlerted: [{ state: 'CA', alert_tier: 'at_risk' }],
  });
  const mockFetch = buildMockFetch();
  const res = await handle(buildPostReq(), {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: MOCK_SLACK_URL,
  });
  assertEquals(res.status, 200);
  assertEquals(mockFetch.calls.length, 0, 'no Slack alerts fired (gated by 23h log)');
  const body = await res.json();
  assertEquals(body.alerts_fired, 0);
  assertEquals(body.alerts_skipped, 1);
});

Deno.test('8. POST / records nexus_alert_log row after firing Slack alert', async () => {
  const mock = buildMockClient({
    proximityRows: [{
      state: 'CA',
      state_name: 'California',
      threshold_amount_cents: 50000000000,
      revenue_cents: 40500000000,
      proximity_percent: 81.0,
    }],
  });
  const mockFetch = buildMockFetch();
  const res = await handle(buildPostReq(), {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: MOCK_SLACK_URL,
  });
  assertEquals(res.status, 200);
  assertEquals(mock.inserted_rows.length, 1);
  const row = mock.inserted_rows[0];
  assertEquals(row.state, 'CA');
  assertEquals(row.alert_tier, 'at_risk');
  assertEquals(row.revenue_cents, 40500000000);
  assertEquals(row.threshold_amount_cents, 50000000000);
  assertEquals(Number(row.proximity_percent), 81.0);
});

Deno.test('9. POST / returns refreshed/alerts_fired/alerts_skipped/states_checked', async () => {
  const res = await handle(buildPostReq(), buildDeps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.refreshed, true);
  assertEquals(typeof body.alerts_fired, 'number');
  assertEquals(typeof body.alerts_skipped, 'number');
  assertEquals(typeof body.states_checked, 'number');
});

Deno.test('10. Slack failure: still records alert_log row (23h gate works)', async () => {
  const mock = buildMockClient({
    proximityRows: [{
      state: 'CA',
      state_name: 'California',
      threshold_amount_cents: 50000000000,
      revenue_cents: 40500000000,
      proximity_percent: 81.0,
    }],
  });
  const mockFetch = buildMockFetch({ slackFails: true });
  const res = await handle(buildPostReq(), {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: MOCK_SLACK_URL,
  });
  assertEquals(res.status, 200);
  // alert_log row WAS written even though Slack 5xx'd (so 23h gate works on retry).
  assertEquals(mock.inserted_rows.length, 1);
});

Deno.test('11. POST / with SLACK_GUARDRAIL_WEBHOOK_URL unset → 503 early-exit', async () => {
  const mock = buildMockClient();
  const mockFetch = buildMockFetch();
  const res = await handle(buildPostReq(), {
    fetchImpl: mockFetch.fetchImpl,
    // deno-lint-ignore no-explicit-any
    supabaseServiceClient: mock.client as any,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    slackWebhookUrl: '',
  });
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error, 'slack_webhook_unset');
  // refresh_nexus_revenue MUST NOT have been called (early-exit)
  assertEquals(mock.rpc_calls.length, 0);
});
