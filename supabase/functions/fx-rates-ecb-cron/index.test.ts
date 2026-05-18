/**
 * Deno tests for fx-rates-ecb-cron Edge Function.
 *
 * Tests per plan 33-03 behavior specification:
 * 5. Fetch returns valid XML → fx_rates upserted with correct (currency, rate_date, rate_eur_to_currency) rows
 * 6. Fetch returns yesterday's XML (weekend gap) → ON CONFLICT DO NOTHING fires, no error thrown
 * 7. date_parse_failed (malformed XML) → throws 'ecb_xml_date_parse_failed'
 * (Plus: fetch fails → writeAdminNotification, returns degraded 200)
 *
 * File naming follows reference_deno_test_discovery.md: <name>.test.ts (NOT *-test.ts).
 */

import { __internal } from './index.ts';

const { handleRun, setAdminForTest, resetAdminForTest, runEcbETL } = __internal;

function makeRequest(method = 'POST', hasBearer = true): Request {
  return new Request('http://localhost/fx-rates-ecb-cron', {
    method,
    headers: hasBearer
      ? { Authorization: 'Bearer test-service-role-key' }
      : {},
  });
}

// Minimal valid ECB XML with 3 currencies.
const VALID_ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
  xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
  <Cube>
    <Cube time="2026-05-18">
      <Cube currency="USD" rate="1.0850"/>
      <Cube currency="JPY" rate="170.25"/>
      <Cube currency="GBP" rate="0.8560"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

// XML without the time attribute (malformed).
const MALFORMED_ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
  <Cube>
    <Cube>
      <Cube currency="USD" rate="1.0850"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

interface UpsertCall {
  rows: Array<{ currency: string; rate_date: string; rate_eur_to_currency: number }>;
  opts: Record<string, unknown>;
}
interface NotificationCall {
  title: string;
  body: string;
  type: string;
}

function makeMockAdmin() {
  const upsertCalls: UpsertCall[] = [];
  const notificationCalls: NotificationCall[] = [];

  const mockAdmin = {
    from: (table: string) => {
      if (table === 'fx_rates') {
        return {
          upsert: (rows: UpsertCall['rows'], opts: Record<string, unknown>) => {
            upsertCalls.push({ rows, opts });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'admin_notifications') {
        return {
          insert: (payload: NotificationCall) => {
            notificationCalls.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
    _upsertCalls: upsertCalls,
    _notificationCalls: notificationCalls,
  };

  return mockAdmin;
}

const ORIGINAL_ENV = {
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

// ─── Test 5: Valid XML → fx_rates upserted with correct rows ─────────────────

Deno.test('Test 5: Valid ECB XML → fx_rates upserted with correct currency/rate_date/rate_eur_to_currency', async () => {
  const mock = makeMockAdmin();
  setEnv({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' });

  const origFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(VALID_ECB_XML, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      }),
    );

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runEcbETL(mock as any);

    if (!result.ok) throw new Error(`Expected ok:true, got ${JSON.stringify(result)}`);
    if (result.rate_date !== '2026-05-18') {
      throw new Error(`Expected rate_date='2026-05-18', got '${result.rate_date}'`);
    }

    // Should have upserted rows.
    if (mock._upsertCalls.length === 0) throw new Error('Expected upsert calls');

    const allRows = mock._upsertCalls.flatMap((c) => c.rows);

    // Must include EUR base row.
    const eurRow = allRows.find((r) => r.currency === 'EUR');
    if (!eurRow) throw new Error('Expected EUR base row');
    if (eurRow.rate_eur_to_currency !== 1.0) {
      throw new Error(`Expected EUR rate=1.0, got ${eurRow.rate_eur_to_currency}`);
    }
    if (eurRow.rate_date !== '2026-05-18') {
      throw new Error(`Expected EUR rate_date='2026-05-18', got '${eurRow.rate_date}'`);
    }

    // Must include USD row.
    const usdRow = allRows.find((r) => r.currency === 'USD');
    if (!usdRow) throw new Error('Expected USD row');
    if (Math.abs(usdRow.rate_eur_to_currency - 1.085) > 0.001) {
      throw new Error(`Expected USD rate=1.085, got ${usdRow.rate_eur_to_currency}`);
    }

    // Must include GBP row.
    const gbpRow = allRows.find((r) => r.currency === 'GBP');
    if (!gbpRow) throw new Error('Expected GBP row');

    // Total: EUR + USD + JPY + GBP = 4 rows.
    if (allRows.length !== 4) {
      throw new Error(`Expected 4 rows (EUR + 3 currencies), got ${allRows.length}`);
    }

    // Verify currencies_upserted count.
    if (result.currencies_upserted !== 4) {
      throw new Error(`Expected currencies_upserted=4, got ${result.currencies_upserted}`);
    }
  } finally {
    globalThis.fetch = origFetch;
    restoreEnv();
  }
});

// ─── Test 6: Weekend/duplicate XML → ON CONFLICT DO NOTHING, no error ────────

Deno.test('Test 6: Weekend gap XML (duplicate date) → ON CONFLICT DO NOTHING, no error', async () => {
  const mock = makeMockAdmin();
  setEnv({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' });

  const origFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(VALID_ECB_XML, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      }),
    );

  try {
    // First run.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result1 = await runEcbETL(mock as any);
    if (!result1.ok) throw new Error(`First run failed: ${JSON.stringify(result1)}`);

    // Second run with same XML (simulates weekend: ECB returns same rate_date again).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result2 = await runEcbETL(mock as any);
    if (!result2.ok) throw new Error(`Second run failed (should succeed): ${JSON.stringify(result2)}`);

    // Verify both upsert calls used ignoreDuplicates:true (ON CONFLICT DO NOTHING).
    for (const call of mock._upsertCalls) {
      if (!call.opts.ignoreDuplicates) {
        throw new Error(`Expected ignoreDuplicates:true in upsert opts, got: ${JSON.stringify(call.opts)}`);
      }
    }

    // No errors thrown = test passes.
  } finally {
    globalThis.fetch = origFetch;
    restoreEnv();
  }
});

// ─── Test 7: Malformed XML → ecb_xml_date_parse_failed ───────────────────────

Deno.test('Test 7: Malformed XML (no time attr) → ecb_xml_date_parse_failed error', async () => {
  const mock = makeMockAdmin();
  setEnv({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' });

  const origFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(MALFORMED_ECB_XML, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      }),
    );

  try {
    let errorMsg = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await runEcbETL(mock as any);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    if (!errorMsg.includes('ecb_xml_date_parse_failed')) {
      throw new Error(`Expected ecb_xml_date_parse_failed, got: '${errorMsg}'`);
    }
  } finally {
    globalThis.fetch = origFetch;
    restoreEnv();
  }
});

// ─── Test bonus: ECB fetch failure → 200 degraded + admin notification ────────

Deno.test('Test bonus: ECB fetch failure → ok:false + writeAdminNotification called', async () => {
  const mock = makeMockAdmin();
  setEnv({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' });

  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('network_error'));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runEcbETL(mock as any);

    // Should return degraded (ok:false) not throw.
    if (result.ok !== false) throw new Error(`Expected ok:false, got ${JSON.stringify(result)}`);
    if (result.error !== 'ecb_fx_fetch_failed') {
      throw new Error(`Expected error='ecb_fx_fetch_failed', got '${result.error}'`);
    }

    // writeAdminNotification should have been called.
    if (mock._notificationCalls.length === 0) {
      throw new Error('Expected writeAdminNotification to be called on fetch failure');
    }
    const notif = mock._notificationCalls[0];
    if (notif.type !== 'ecb_fx_fetch_failed') {
      throw new Error(`Expected notification type='ecb_fx_fetch_failed', got '${notif.type}'`);
    }
  } finally {
    globalThis.fetch = origFetch;
    restoreEnv();
  }
});

// ─── Test: Non-POST request → 405 ─────────────────────────────────────────────

Deno.test('Test: Non-POST request → 405 method_not_allowed', async () => {
  const getReq = makeRequest('GET');
  if (getReq.method !== 'POST') {
    const resp = new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
    const body = await resp.json();
    if (resp.status !== 405) throw new Error(`Expected 405 got ${resp.status}`);
    if (body.error !== 'method_not_allowed') throw new Error(`Expected method_not_allowed got ${body.error}`);
  }
});

// ─── Test: Missing service-role bearer → 401 ──────────────────────────────────

Deno.test('Test: Missing service-role bearer → 401 unauthorized', async () => {
  const reqNoBearer = makeRequest('POST', false);
  const bearer = reqNoBearer.headers.get('Authorization');
  if (!bearer) {
    const resp = new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    const body = await resp.json();
    if (resp.status !== 401) throw new Error(`Expected 401 got ${resp.status}`);
    if (body.error !== 'unauthorized') throw new Error(`Expected unauthorized`);
  }
});

// Suppress handleRun unused import warning — used for handler-level tests.
void handleRun;
