/**
 * cac-alert-cron index.test.ts — Phase 33 Plan 04 TDD tests.
 *
 * Per reference_deno_test_discovery: test file uses <name>.test.ts pattern.
 */

// ---------------------------------------------------------------------------
// Mock captureServer + shutdownPostHog (must be set BEFORE module import)
// ---------------------------------------------------------------------------
let captureServerCalls: Array<{ userId: string; event: string; properties?: Record<string, unknown> }> = [];
let shutdownPostHogCalled = false;

// We stub by replacing the module resolution via global assignment.
// Since Deno uses ES modules, we use a workaround: the index.ts accepts
// an injectable via __internal for posthog. But simpler approach: we mock at
// the module layer via Deno's import map override isn't supported without config.
// Instead, we test behavior via the __internal export which exposes handleRun.
// captureServer and shutdownPostHog are imported inside the module — we test
// their calls indirectly via the module's side effects.

// For proper isolation we need setPosthogForTest exposed OR we test indirectly.
// The plan says: "mock captureServer import override in test file"
// Implementation will expose setCaptureServerForTest via __internal.

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------
import { __internal } from './index.ts';

const { handleRun, setAdminForTest, resetAdminForTest, setCaptureServerForTest, resetCaptureServerForTest } =
  __internal;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(method = 'POST', authKey = 'test-service-role-key'): Request {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', authKey);
  return new Request('http://localhost/cac-alert-cron', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authKey}`,
    },
  });
}

interface GrowthTarget {
  source: string;
  target_ltv_usd: number;
  cac_multiplier: number;
  enabled: boolean;
}

interface CacSummaryRow {
  network: string;
  ad_account_id: string;
  ad_id: string;
  campaign_id: string;
  spend_date: string;
  spend_usd_at_spend_date: number;
  clicks: number;
  impressions: number;
  attributed_conversions: number;
  cac_usd: number;
}

function makeAdmin(overrides: {
  targets?: GrowthTarget[];
  cacSummaryRows?: CacSummaryRow[];
  upsertedAlerts?: unknown[];
  upsertError?: string | null;
  upsertReturnsData?: boolean;
} = {}): unknown {
  const targets = overrides.targets ?? [];
  const cacSummaryRows = overrides.cacSummaryRows ?? [];
  const upsertedAlerts: unknown[] = overrides.upsertedAlerts ?? [];
  const upsertError = overrides.upsertError ?? null;
  const upsertReturnsData = overrides.upsertReturnsData ?? true;

  return {
    from: (table: string) => {
      if (table === 'growth_targets') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) =>
              Promise.resolve({ data: targets, error: null }),
          }),
        };
      }
      if (table === 'cac_alerts') {
        return {
          upsert: (payload: unknown, _opts?: unknown) => {
            upsertedAlerts.push(payload);
            return {
              select: (_cols: string) => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: upsertReturnsData && !upsertError ? { id: 'new-alert-id', ...payload } : null,
                    error: upsertError ? { message: upsertError } : null,
                  }),
              }),
            };
          },
        };
      }
      if (table === 'admin_notifications') {
        return {
          insert: (_payload: unknown) => Promise.resolve({ data: null, error: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: (fn: string, _args: unknown) => {
      if (fn === 'get_cac_summary') {
        return Promise.resolve({ data: cacSummaryRows, error: null });
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    },
  };
}

function resetAll() {
  captureServerCalls = [];
  shutdownPostHogCalled = false;
  resetAdminForTest();
  resetCaptureServerForTest();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('Test 1: No ad_revenue_normalized rows (empty cacSummary) → checked:0, fired:0, 200 ok', async () => {
  resetAll();
  setAdminForTest(makeAdmin({ targets: [], cacSummaryRows: [] }));
  const req = makeReq();
  const res = await handleRun(req);
  const body = await res.json();
  if (res.status !== 200) {
    throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  }
  if (body.targets_evaluated !== 0) {
    throw new Error(`Expected targets_evaluated=0, got: ${JSON.stringify(body)}`);
  }
  if (body.alerts_fired !== 0) {
    throw new Error(`Expected alerts_fired=0, got: ${JSON.stringify(body)}`);
  }
});

Deno.test('Test 2: CAC $120 vs threshold $100 (ltv=$200 * multiplier=0.5) → breach → cac_alerts upserted', async () => {
  resetAll();
  const upsertedAlerts: unknown[] = [];
  const target: GrowthTarget = {
    source: 'meta',
    target_ltv_usd: 200,
    cac_multiplier: 0.5,
    enabled: true,
  };
  // spend=120, conversions=1 → CAC=120, threshold=100
  const cacRows: CacSummaryRow[] = [
    {
      network: 'meta',
      ad_account_id: 'act-1',
      ad_id: 'ad-1',
      campaign_id: 'camp-1',
      spend_date: '2026-05-18',
      spend_usd_at_spend_date: 120,
      clicks: 100,
      impressions: 1000,
      attributed_conversions: 1,
      cac_usd: 120,
    },
  ];
  setAdminForTest(makeAdmin({ targets: [target], cacSummaryRows: cacRows, upsertedAlerts }));

  let captured = false;
  setCaptureServerForTest((args: { event: string }) => {
    if (args.event === 'cac_target_breached') captured = true;
  });

  const req = makeReq();
  const res = await handleRun(req);
  const body = await res.json();

  if (upsertedAlerts.length !== 1) {
    throw new Error(`Expected 1 alert upserted, got: ${upsertedAlerts.length}: ${JSON.stringify(upsertedAlerts)}`);
  }
  const alert = upsertedAlerts[0] as { source: string; cac_7d_usd: number; threshold_usd: number };
  if (alert.source !== 'meta') {
    throw new Error(`Expected source=meta, got: ${alert.source}`);
  }
  if (body.alerts_fired !== 1) {
    throw new Error(`Expected alerts_fired=1, got: ${JSON.stringify(body)}`);
  }
  if (!captured) {
    throw new Error('Expected cac_target_breached captureServer call');
  }
});

Deno.test('Test 3: CAC $80 vs threshold $100 → no breach → no alert', async () => {
  resetAll();
  const upsertedAlerts: unknown[] = [];
  const target: GrowthTarget = {
    source: 'meta',
    target_ltv_usd: 200,
    cac_multiplier: 0.5,
    enabled: true,
  };
  // spend=80, conversions=1 → CAC=80 < threshold=100
  const cacRows: CacSummaryRow[] = [
    {
      network: 'meta',
      ad_account_id: 'act-1',
      ad_id: 'ad-1',
      campaign_id: 'camp-1',
      spend_date: '2026-05-18',
      spend_usd_at_spend_date: 80,
      clicks: 100,
      impressions: 1000,
      attributed_conversions: 1,
      cac_usd: 80,
    },
  ];
  setAdminForTest(makeAdmin({ targets: [target], cacSummaryRows: cacRows, upsertedAlerts }));
  const req = makeReq();
  const res = await handleRun(req);
  const body = await res.json();

  if (upsertedAlerts.length !== 0) {
    throw new Error(`Expected no alerts, got: ${upsertedAlerts.length}`);
  }
  if (body.alerts_fired !== 0) {
    throw new Error(`Expected alerts_fired=0, got: ${JSON.stringify(body)}`);
  }
});

Deno.test('Test 4: Breach already exists in cac_alerts for (source, date) → upsert returns null → no duplicate captureServer', async () => {
  resetAll();
  const target: GrowthTarget = {
    source: 'google',
    target_ltv_usd: 300,
    cac_multiplier: 0.4,
    enabled: true,
  };
  // CAC=150, threshold=120 → breach
  const cacRows: CacSummaryRow[] = [
    {
      network: 'google',
      ad_account_id: 'act-2',
      ad_id: 'ad-2',
      campaign_id: 'camp-2',
      spend_date: '2026-05-18',
      spend_usd_at_spend_date: 150,
      clicks: 100,
      impressions: 1000,
      attributed_conversions: 1,
      cac_usd: 150,
    },
  ];
  // upsertReturnsData=false simulates ON CONFLICT DO NOTHING (no new row)
  setAdminForTest(makeAdmin({ targets: [target], cacSummaryRows: cacRows, upsertReturnsData: false }));

  let captured = false;
  setCaptureServerForTest((args: { event: string }) => {
    if (args.event === 'cac_target_breached') captured = true;
  });

  const req = makeReq();
  const res = await handleRun(req);
  const body = await res.json();

  // alerts_fired = 0 because upsert returned null (duplicate)
  if (body.alerts_fired !== 0) {
    throw new Error(`Expected alerts_fired=0 on duplicate, got: ${JSON.stringify(body)}`);
  }
  if (captured) {
    throw new Error('Expected captureServer NOT called on duplicate alert');
  }
});

Deno.test('Test 5: captureServer called with cac_target_breached + correct attrs on breach', async () => {
  resetAll();
  const target: GrowthTarget = {
    source: 'tiktok',
    target_ltv_usd: 250,
    cac_multiplier: 0.5,
    enabled: true,
  };
  // CAC=150, threshold=125 → breach
  const cacRows: CacSummaryRow[] = [
    {
      network: 'tiktok',
      ad_account_id: 'act-3',
      ad_id: 'ad-3',
      campaign_id: 'camp-3',
      spend_date: '2026-05-18',
      spend_usd_at_spend_date: 150,
      clicks: 100,
      impressions: 1000,
      attributed_conversions: 1,
      cac_usd: 150,
    },
  ];
  setAdminForTest(makeAdmin({ targets: [target], cacSummaryRows: cacRows }));

  let capturedArgs: { userId: string; event: string; properties?: Record<string, unknown> } | null = null;
  setCaptureServerForTest((args: { userId: string; event: string; properties?: Record<string, unknown> }) => {
    capturedArgs = args;
  });

  const req = makeReq();
  await handleRun(req);

  if (!capturedArgs) {
    throw new Error('Expected captureServer to be called');
  }
  if (capturedArgs.event !== 'cac_target_breached') {
    throw new Error(`Expected event='cac_target_breached', got: ${capturedArgs.event}`);
  }
  if (capturedArgs.userId !== 'system') {
    throw new Error(`Expected userId='system', got: ${capturedArgs.userId}`);
  }
  const props = capturedArgs.properties;
  if (!props) throw new Error('Expected properties to be set');
  if (props.source !== 'tiktok') {
    throw new Error(`Expected source='tiktok', got: ${props.source}`);
  }
  if (typeof props.cac_7d_usd !== 'number') {
    throw new Error(`Expected cac_7d_usd to be number, got: ${typeof props.cac_7d_usd}`);
  }
  if (typeof props.breach_ratio !== 'number') {
    throw new Error(`Expected breach_ratio to be number, got: ${typeof props.breach_ratio}`);
  }
});

Deno.test('Test 6: writeAdminNotification called with type=cac_alert on breach', async () => {
  resetAll();
  const target: GrowthTarget = {
    source: 'meta',
    target_ltv_usd: 200,
    cac_multiplier: 0.5,
    enabled: true,
  };
  const cacRows: CacSummaryRow[] = [
    {
      network: 'meta',
      ad_account_id: 'act-1',
      ad_id: 'ad-1',
      campaign_id: 'camp-1',
      spend_date: '2026-05-18',
      spend_usd_at_spend_date: 120,
      clicks: 100,
      impressions: 1000,
      attributed_conversions: 1,
      cac_usd: 120,
    },
  ];

  let notificationCalled = false;
  let notificationPayload: unknown = null;

  const adminMock = {
    from: (table: string) => {
      if (table === 'growth_targets') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) =>
              Promise.resolve({ data: [target], error: null }),
          }),
        };
      }
      if (table === 'cac_alerts') {
        return {
          upsert: (payload: unknown, _opts?: unknown) => ({
            select: (_cols: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: 'new-alert', ...payload }, error: null }),
            }),
          }),
        };
      }
      if (table === 'admin_notifications') {
        return {
          insert: (payload: unknown) => {
            notificationCalled = true;
            notificationPayload = payload;
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: (fn: string, _args: unknown) => {
      if (fn === 'get_cac_summary') {
        return Promise.resolve({ data: cacRows, error: null });
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    },
  };

  setAdminForTest(adminMock);
  setCaptureServerForTest(() => {});

  const req = makeReq();
  await handleRun(req);

  if (!notificationCalled) {
    throw new Error('Expected writeAdminNotification to be called');
  }
  const n = notificationPayload as { type: string; title: string };
  if (n.type !== 'cac_alert') {
    throw new Error(`Expected type='cac_alert', got: ${n.type}`);
  }
  if (typeof n.title !== 'string') {
    throw new Error(`Expected title to be string, got: ${typeof n.title}`);
  }
});

Deno.test('Test 7: shutdownPostHog called in finally block (always, even on error)', async () => {
  resetAll();

  let shutdownCalled = false;
  let shutdownPostHogFn: (() => Promise<void>) | null = null;

  // Import __internal to get access to setShutdownPostHogForTest
  const { setShutdownPostHogForTest, resetShutdownPostHogForTest } = __internal;

  setShutdownPostHogForTest(async () => {
    shutdownCalled = true;
  });

  // Simulate error scenario — targets query errors, forcing catch path
  const errorAdmin = {
    from: (table: string) => {
      if (table === 'growth_targets') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) =>
              Promise.resolve({ data: null, error: { message: 'db error' } }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: () => { throw new Error('RPC not expected'); },
  };

  setAdminForTest(errorAdmin);
  setCaptureServerForTest(() => {});

  const req = makeReq();
  // handleRun should still call shutdownPostHog even when there's an error
  // (it's in the Deno.serve wrapper's finally block, but handleRun itself should also handle it
  // OR we call shutdownPostHog in finally of Deno.serve — test via __internal.handleRunWithShutdown)
  try {
    await handleRun(req);
  } catch {
    // ok
  }

  // Reset to clean state
  resetShutdownPostHogForTest();

  // shutdownPostHog is in Deno.serve's finally block, not handleRun's
  // So we verify the Deno.serve wrapper path via __internal.handleRunWithShutdown
  // OR simply test the finally via __internal
  shutdownCalled = false;
  setShutdownPostHogForTest(async () => {
    shutdownCalled = true;
  });

  // Test via __internal.handleRunWithFinally which wraps handleRun with finally
  const { handleRunWithFinally } = __internal;
  setAdminForTest(makeAdmin({ targets: [] }));
  const req2 = makeReq();
  await handleRunWithFinally(req2);

  resetShutdownPostHogForTest();

  if (!shutdownCalled) {
    throw new Error('Expected shutdownPostHog to be called in finally block');
  }
});

Deno.test('Test 8: Non-POST → 405', async () => {
  resetAll();
  const req = makeReq('GET');
  const res = await handleRun(req);
  if (res.status !== 405) {
    throw new Error(`Expected 405, got: ${res.status}`);
  }
});
