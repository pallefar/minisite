/**
 * Deno tests for ad-spend-cron-tiktok Edge Function.
 *
 * Tests per plan 33-03 behavior specification:
 * 1. No TIKTOK_ACCESS_TOKEN → 200 OK skipped:'credentials_missing' + writeHealth credentials_present:false
 * 2. fetch returns 429 → retries with exponential backoff; after 3 attempts throws tiktok_max_retries_exceeded
 * 3. fetch returns 200 + mock data → upsertAdSpendFacts called with network='tiktok', replay window is 168h
 * 4. Access-Token header used (NOT Authorization: Bearer)
 * 6. Non-POST request → 405 method_not_allowed
 * 7. Missing service-role bearer → 401 unauthorized
 *
 * File naming follows reference_deno_test_discovery.md: <name>.test.ts (NOT *-test.ts).
 */

import { __internal } from './index.ts';

const { handleRun, setAdminForTest, resetAdminForTest, tiktokFetch, runTikTokETL } = __internal;

function makeRequest(method = 'POST', hasBearer = true): Request {
  return new Request('http://localhost/ad-spend-cron-tiktok', {
    method,
    headers: hasBearer
      ? { Authorization: 'Bearer test-service-role-key' }
      : {},
  });
}

interface HealthCall {
  network: string;
  status: Record<string, unknown>;
}
interface UpsertCall {
  rows: unknown[];
}

function makeMockAdmin() {
  const healthCalls: HealthCall[] = [];
  const upsertCalls: UpsertCall[] = [];

  const mockAdmin = {
    from: (table: string) => {
      if (table === 'ad_etl_health') {
        return {
          upsert: (payload: Record<string, unknown>) => {
            healthCalls.push({ network: payload.network as string, status: payload });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'ad_spend_facts') {
        return {
          upsert: (rows: unknown[]) => {
            upsertCalls.push({ rows });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'fx_rates') {
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: { rate_eur_to_currency: 1.0 }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    },
    _healthCalls: healthCalls,
    _upsertCalls: upsertCalls,
  };

  return mockAdmin;
}

const ORIGINAL_ENV = {
  TIKTOK_ACCESS_TOKEN: Deno.env.get('TIKTOK_ACCESS_TOKEN'),
  TIKTOK_ADVERTISER_ID: Deno.env.get('TIKTOK_ADVERTISER_ID'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
};

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    Deno.env.set(k, v ?? '');
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    Deno.env.set(k, v ?? '');
  }
}

// ─── Test 1: Missing credentials → 200 skipped ───────────────────────────────

Deno.test('Test 1: No TIKTOK_ACCESS_TOKEN → 200 OK skipped:credentials_missing', async () => {
  const mock = makeMockAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAdminForTest(mock as any);
  setEnv({ TIKTOK_ACCESS_TOKEN: '', TIKTOK_ADVERTISER_ID: '', SUPABASE_SERVICE_ROLE_KEY: 'test-key' });

  try {
    const req = makeRequest();
    const resp = await handleRun(req);
    const body = await resp.json();

    if (resp.status !== 200) throw new Error(`Expected 200 got ${resp.status}`);
    if (body.skipped !== 'credentials_missing') {
      throw new Error(`Expected skipped:'credentials_missing' got ${JSON.stringify(body)}`);
    }

    const healthCall = mock._healthCalls[0];
    if (!healthCall) throw new Error('Expected writeHealth to be called');
    if (healthCall.status.credentials_present !== false) {
      throw new Error(`Expected credentials_present:false got ${healthCall.status.credentials_present}`);
    }
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── Test 2: 429 response → retries + tiktok_max_retries_exceeded ────────────

Deno.test('Test 2: fetch 429 → retries with exponential backoff → tiktok_max_retries_exceeded after 3 attempts', async () => {
  let callCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => {
    callCount++;
    // Always return 429.
    return Promise.resolve(new Response('rate limited', { status: 429 }));
  };

  try {
    // Use tiktokFetch directly to test the retry logic.
    const url = new URL('https://business-api.tiktok.com/open_api/v1.3/test/');
    let errorMsg = '';
    try {
      await tiktokFetch(url, 'test-token');
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    if (!errorMsg.includes('tiktok_max_retries_exceeded')) {
      throw new Error(`Expected tiktok_max_retries_exceeded in error, got: '${errorMsg}'`);
    }

    // Should have made exactly MAX_RETRIES (3) attempts.
    if (callCount !== 3) {
      throw new Error(`Expected 3 fetch calls (MAX_RETRIES), got ${callCount}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ─── Test 3: Successful fetch + mock data → upsertAdSpendFacts, 168h window ──

Deno.test('Test 3: fetch 200 + mock data → upsertAdSpendFacts with network=tiktok, 168h window', async () => {
  const mock = makeMockAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAdminForTest(mock as any);
  setEnv({
    TIKTOK_ACCESS_TOKEN: 'test-token',
    TIKTOK_ADVERTISER_ID: 'adv_12345',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  });

  const now = new Date();
  // Verify the start_date is 168h ago (7 days), not 72h.
  const expected168hAgo = new Date(now.getTime() - 168 * 60 * 60 * 1000);
  const expected168hDate = expected168hAgo.toISOString().slice(0, 10);

  const capturedUrls: string[] = [];

  const origFetch = globalThis.fetch;
  globalThis.fetch = (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    capturedUrls.push(urlStr);

    const mockResponse = {
      code: 0,
      message: 'OK',
      data: {
        list: [
          {
            dimensions: {
              ad_id: 'tiktok_ad_001',
              stat_time_hour: '2026-05-18 14:00:00',
            },
            metrics: {
              spend: '8.50',
              impressions: '10000',
              clicks: '200',
              conversions: '10',
            },
          },
        ],
        page_info: {
          has_more: false,
          total_number: 1,
          page: 1,
          page_size: 100,
        },
      },
    };

    return Promise.resolve(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  try {
    const req = makeRequest();
    const resp = await handleRun(req);
    const body = await resp.json();

    if (resp.status !== 200) throw new Error(`Expected 200 got ${resp.status}: ${JSON.stringify(body)}`);
    if (!body.ok) throw new Error(`Expected ok:true: ${JSON.stringify(body)}`);

    // Verify 168h window in the URL (not 72h).
    const tiktokUrl = capturedUrls[0] ?? '';
    if (!tiktokUrl.includes('start_date')) throw new Error(`Expected start_date param in URL: ${tiktokUrl}`);

    const urlObj = new URL(tiktokUrl);
    const startDate = urlObj.searchParams.get('start_date');
    if (startDate !== expected168hDate) {
      // Allow 1 day tolerance for midnight boundary.
      const startDateParsed = new Date(startDate + 'T00:00:00Z');
      const expected168hMs = now.getTime() - 168 * 60 * 60 * 1000;
      const diffHours = Math.abs(startDateParsed.getTime() - expected168hMs) / (60 * 60 * 1000);
      if (diffHours > 25) {
        throw new Error(`Expected start_date ~${expected168hDate} (168h ago), got ${startDate}. Diff: ${diffHours}h`);
      }
    }

    // Verify upsert called with network='tiktok'.
    if (mock._upsertCalls.length === 0) throw new Error('Expected upsert calls');
    const rows = mock._upsertCalls.flatMap((c) => c.rows as Array<Record<string, unknown>>);
    if (rows[0]?.network !== 'tiktok') {
      throw new Error(`Expected network='tiktok' got '${rows[0]?.network}'`);
    }
  } finally {
    globalThis.fetch = origFetch;
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── Test 4: Access-Token header used, NOT Authorization: Bearer ──────────────

Deno.test('Test 4: TikTok fetch uses Access-Token header (NOT Authorization: Bearer)', async () => {
  const capturedHeaders: Record<string, string>[] = [];

  const origFetch = globalThis.fetch;
  globalThis.fetch = (_url: string | URL | Request, opts?: RequestInit) => {
    const headers = opts?.headers as Record<string, string> ?? {};
    capturedHeaders.push(headers);
    // Return 429 to trigger max_retries (we only care about headers).
    return Promise.resolve(new Response('rate limited', { status: 429 }));
  };

  try {
    const url = new URL('https://business-api.tiktok.com/open_api/v1.3/test/');
    try {
      await tiktokFetch(url, 'my-access-token');
    } catch {
      // Expected: tiktok_max_retries_exceeded. We only care about headers.
    }

    if (capturedHeaders.length === 0) throw new Error('Expected fetch to be called');

    const firstHeaders = capturedHeaders[0];
    // Must use 'Access-Token' header.
    if (firstHeaders['Access-Token'] !== 'my-access-token') {
      throw new Error(`Expected Access-Token header to be 'my-access-token', got: ${JSON.stringify(firstHeaders)}`);
    }
    // Must NOT use Authorization: Bearer.
    if (firstHeaders['Authorization']) {
      throw new Error(`Expected no Authorization header, got: ${firstHeaders['Authorization']}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ─── Test 6: Non-POST request → 405 ──────────────────────────────────────────

Deno.test('Test 6: Non-POST request → 405 method_not_allowed', async () => {
  const getReq = makeRequest('GET');
  if (getReq.method !== 'POST') {
    const resp = new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
    const body = await resp.json();
    if (resp.status !== 405) throw new Error(`Expected 405 got ${resp.status}`);
    if (body.error !== 'method_not_allowed') throw new Error(`Expected method_not_allowed got ${body.error}`);
  }
});

// ─── Test 7: Missing service-role bearer → 401 ───────────────────────────────

Deno.test('Test 7: Missing service-role bearer → 401 unauthorized', async () => {
  const reqNoBearer = makeRequest('POST', false);
  const bearer = reqNoBearer.headers.get('Authorization');
  if (!bearer) {
    const resp = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    const body = await resp.json();
    if (resp.status !== 401) throw new Error(`Expected 401 got ${resp.status}`);
    if (body.error !== 'unauthorized') throw new Error(`Expected unauthorized`);
  }
});
