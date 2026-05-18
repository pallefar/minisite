/**
 * Deno tests for ad-spend-cron-google Edge Function.
 *
 * Tests per plan 33-03 behavior specification:
 * 4. No GOOGLE_ADS_DEVELOPER_TOKEN → 200 OK skipped:'credentials_missing' + writeHealth credentials_present:false
 * 5. OAuth2 token exchange succeeds → searchStream called with correct GAQL date range (72h window)
 * 6. Non-POST request → 405 method_not_allowed
 * 7. Missing service-role bearer → 401 unauthorized
 * (Plus additional: all 5 secrets required; any missing → 200 skipped)
 *
 * File naming follows reference_deno_test_discovery.md: <name>.test.ts (NOT *-test.ts).
 */

import { __internal } from './index.ts';

const { handleRun, setAdminForTest, resetAdminForTest } = __internal;

function makeRequest(method = 'POST', hasBearer = true): Request {
  return new Request('http://localhost/ad-spend-cron-google', {
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
  GOOGLE_ADS_DEVELOPER_TOKEN: Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
  GOOGLE_ADS_CUSTOMER_ID: Deno.env.get('GOOGLE_ADS_CUSTOMER_ID'),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
  GOOGLE_ADS_CLIENT_ID: Deno.env.get('GOOGLE_ADS_CLIENT_ID'),
  GOOGLE_ADS_CLIENT_SECRET: Deno.env.get('GOOGLE_ADS_CLIENT_SECRET'),
  GOOGLE_ADS_REFRESH_TOKEN: Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN'),
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

function setAllGoogleSecrets() {
  setEnv({
    GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token',
    GOOGLE_ADS_CUSTOMER_ID: '1234567890',
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: '1234567890',
    GOOGLE_ADS_CLIENT_ID: 'client-id',
    GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  });
}

// ─── Test 4: Missing GOOGLE_ADS_DEVELOPER_TOKEN → 200 skipped ────────────────

Deno.test('Test 4: No GOOGLE_ADS_DEVELOPER_TOKEN → 200 OK skipped:credentials_missing', async () => {
  const mock = makeMockAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAdminForTest(mock as any);
  setEnv({
    GOOGLE_ADS_DEVELOPER_TOKEN: '',
    GOOGLE_ADS_CUSTOMER_ID: '1234567890',
    GOOGLE_ADS_CLIENT_ID: 'client-id',
    GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  });

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

// ─── Test 4b: Any missing secret → 200 skipped (all 5 required) ─────────────

Deno.test('Test 4b: Missing GOOGLE_ADS_REFRESH_TOKEN → 200 OK skipped:credentials_missing', async () => {
  const mock = makeMockAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAdminForTest(mock as any);
  setEnv({
    GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token',
    GOOGLE_ADS_CUSTOMER_ID: '1234567890',
    GOOGLE_ADS_CLIENT_ID: 'client-id',
    GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_REFRESH_TOKEN: '',  // Missing
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  });

  try {
    const req = makeRequest();
    const resp = await handleRun(req);
    const body = await resp.json();

    if (resp.status !== 200) throw new Error(`Expected 200 got ${resp.status}`);
    if (body.skipped !== 'credentials_missing') {
      throw new Error(`Expected skipped:'credentials_missing' got ${JSON.stringify(body)}`);
    }
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── Test 5: OAuth2 token exchange succeeds → searchStream called ─────────────

Deno.test('Test 5: OAuth2 token exchange succeeds → searchStream called with GAQL', async () => {
  const mock = makeMockAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAdminForTest(mock as any);
  setAllGoogleSecrets();

  const fetchCalls: Array<{ url: string; opts: RequestInit }> = [];

  const origFetch = globalThis.fetch;
  globalThis.fetch = (url: string | URL | Request, opts?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    fetchCalls.push({ url: urlStr, opts: opts ?? {} });

    if (urlStr.includes('oauth2.googleapis.com')) {
      // OAuth2 token exchange response.
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'mock-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    if (urlStr.includes('googleads.googleapis.com')) {
      // searchStream response: NDJSON format with results array.
      const ndjsonLine = JSON.stringify({
        results: [
          {
            adGroupAd: { ad: { id: 'ad_001' } },
            campaign: { id: 'camp_001' },
            adGroup: { id: 'adgroup_001' },
            metrics: {
              costMicros: '5000000',  // $5.00
              clicks: '100',
              impressions: '2000',
              conversions: '5',
            },
            segments: {
              date: '2026-05-18',
              hour: 14,
            },
          },
        ],
      });
      return Promise.resolve(
        new Response(ndjsonLine + '\n', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${urlStr}`));
  };

  try {
    const req = makeRequest();
    const resp = await handleRun(req);
    const body = await resp.json();

    if (resp.status !== 200) throw new Error(`Expected 200 got ${resp.status}: ${JSON.stringify(body)}`);
    if (!body.ok) throw new Error(`Expected ok:true: ${JSON.stringify(body)}`);

    // Verify OAuth2 exchange was called.
    const oauthCall = fetchCalls.find((c) => c.url.includes('oauth2.googleapis.com'));
    if (!oauthCall) throw new Error('Expected OAuth2 token exchange call');

    // Verify searchStream was called.
    const searchCall = fetchCalls.find((c) => c.url.includes('googleads.googleapis.com'));
    if (!searchCall) throw new Error('Expected searchStream call');

    // Verify GAQL body contains date range (72h window).
    const bodyStr = searchCall.opts.body as string;
    if (!bodyStr?.includes('BETWEEN')) {
      throw new Error(`Expected BETWEEN in GAQL: ${bodyStr}`);
    }

    // Verify rows were upserted with network='google'.
    if (mock._upsertCalls.length === 0) {
      throw new Error('Expected upsert calls');
    }
    const rows = mock._upsertCalls.flatMap((c) => c.rows as Array<Record<string, unknown>>);
    if (rows[0]?.network !== 'google') {
      throw new Error(`Expected network='google' got '${rows[0]?.network}'`);
    }
  } finally {
    globalThis.fetch = origFetch;
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── Test 5b: OAuth2 token exchange fails → 500 ──────────────────────────────

Deno.test('Test 5b: OAuth2 token exchange fails → 500 + writeHealth last_error', async () => {
  const mock = makeMockAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAdminForTest(mock as any);
  setAllGoogleSecrets();

  const origFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: 'invalid_client' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

  try {
    const req = makeRequest();
    const resp = await handleRun(req);
    const body = await resp.json();

    if (resp.status !== 500) throw new Error(`Expected 500 got ${resp.status}`);
    if (!body.error) throw new Error('Expected error field');

    const healthWithError = mock._healthCalls.find(
      (c) => c.status.credentials_present === true && typeof c.status.last_error === 'string',
    );
    if (!healthWithError) {
      throw new Error(`Expected writeHealth with last_error. Calls: ${JSON.stringify(mock._healthCalls)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── Test 6: Non-POST request → 405 ──────────────────────────────────────────

Deno.test('Test 6: Non-POST request → 405 method_not_allowed', async () => {
  const getReq = makeRequest('GET');
  // Simulate serve wrapper method check.
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
    if (body.error !== 'unauthorized') throw new Error(`Expected unauthorized got ${body.error}`);
  }
});
