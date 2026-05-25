/**
 * vendor-smoke unit tests — Phase 52 Plan 52-01 Task 3.
 *
 * Tests the testable surface via __internal exports.
 * IMPORTANT: run against the FILE, not the directory — `deno test --no-check index.test.ts`
 * Targeting the directory would import the module, trigger Deno.serve(), hang CI.
 *
 * Coverage:
 *   1. isAuthorized — service-role bearer → authorized (cron path)
 *   2. isAuthorized — no bearer → 401 unauthorized
 *   3. handleRun — all vendor secrets unset → every result is 'not_configured', zero 'fail'
 *   4. handleRun — stubbed probe returning HTTP 200 → status 'ok' with numeric latency_ms
 *   5. handleRun — stubbed probe returning HTTP 401 → status 'fail' with short message code
 *   6. handleRun — upserts exactly one row per registry entry into vendor_smoke_log
 *        (asserts onConflict vendor_name and row shape)
 */
import { assertEquals, assertExists } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import { __internal, VENDOR_REGISTRY, type SmokeResult, type VendorHandler } from './index.ts';

const { handleRun, isAuthorized, setAdminForTest, resetAdminForTest } = __internal;

// ---------------------------------------------------------------------------
// Fake admin client factory
// ---------------------------------------------------------------------------

interface UpsertCallRecord {
  table: string;
  rows: unknown[];
  options: Record<string, unknown>;
}

interface FakeAdminGetUserResult {
  data: { user: { id: string } | null } | null;
  error: unknown;
}

interface FakeProfileResult {
  data: { is_staff: boolean } | null;
  error: unknown;
}

/**
 * Build a fake admin client that:
 * - Records .from('vendor_smoke_log').upsert(...) calls.
 * - Stubs .auth.getUser() to return the configured user or an error.
 * - Stubs .from('profiles').select().eq().single() to return configured is_staff.
 */
function makeFakeAdmin(opts: {
  getUserResult?: FakeAdminGetUserResult;
  profileResult?: FakeProfileResult;
  upsertError?: { message: string } | null;
}): {
  admin: unknown;
  upsertCalls: UpsertCallRecord[];
} {
  const upsertCalls: UpsertCallRecord[] = [];

  // Chain builder for from().select().eq().single()
  const profileChain = {
    select: (_col: string) => profileChain,
    eq: (_col: string, _val: unknown) => profileChain,
    single: () => Promise.resolve(opts.profileResult ?? { data: null, error: 'no_profile' }),
  };

  const upsertChain = (_rows: unknown[], options: Record<string, unknown>) => {
    // last from() call's upsert — captured below
    void options;
    return Promise.resolve({ data: null, error: opts.upsertError ?? null });
  };

  // Track which table from() was called on
  const fromFn = (table: string) => {
    if (table === 'vendor_smoke_log') {
      return {
        upsert: (rows: unknown[], options: Record<string, unknown>) => {
          upsertCalls.push({ table, rows: rows as unknown[], options });
          return upsertChain(rows, options);
        },
        select: () => profileChain,
        eq: (_c: string, _v: unknown) => profileChain,
        single: () => Promise.resolve({ data: null, error: null }),
      };
    }
    // profiles table
    return profileChain;
  };

  const admin = {
    from: fromFn,
    auth: {
      getUser: (_token: string) =>
        Promise.resolve(
          opts.getUserResult ?? {
            data: { user: { id: 'test-user-id' } },
            error: null,
          },
        ),
    },
  };

  return { admin, upsertCalls };
}

// ---------------------------------------------------------------------------
// Helper: create a minimal Request with an Authorization header
// ---------------------------------------------------------------------------
function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader) headers.set('Authorization', authHeader);
  return new Request('https://vendor-smoke.example.com/', {
    method: 'POST',
    headers,
  });
}

// ---------------------------------------------------------------------------
// Test 1: isAuthorized — service-role bearer → authorized
// ---------------------------------------------------------------------------
Deno.test('isAuthorized: service-role bearer → authorized', async () => {
  const serviceRoleKey = 'test-service-role-key-1234567890abcdef';
  // Set env so checkServiceRoleBearer passes
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey);
  try {
    const req = makeRequest(`Bearer ${serviceRoleKey}`);
    const result = await isAuthorized(req);
    assertEquals(result, true, 'service-role bearer should be authorized');
  } finally {
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
});

// ---------------------------------------------------------------------------
// Test 2: isAuthorized — no bearer → unauthorized
// ---------------------------------------------------------------------------
Deno.test('isAuthorized: no bearer → unauthorized', async () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'some-key');
  try {
    const req = makeRequest(); // no Authorization header
    const result = await isAuthorized(req);
    assertEquals(result, false, 'missing bearer should not be authorized');
  } finally {
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
});

// ---------------------------------------------------------------------------
// Test 3: handleRun — all vendor secrets unset → every result is 'not_configured', zero 'fail'
// ---------------------------------------------------------------------------
Deno.test('handleRun: all secrets unset → all not_configured, zero fail', async () => {
  // Unset all known vendor secret env vars
  const vendorSecrets = [
    'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET',
    'CALENDLY_API_KEY',
    'BETTER_STACK_API_KEY',
    'SENTRY_DSN',
    'ANTHROPIC_CLINICAL_API_KEY',
    'ANTHROPIC_API_KEY',
    'STRIPE_SECRET_KEY',
    'RESEND_API_KEY',
    'POSTHOG_PERSONAL_API_KEY', 'POSTHOG_PROJECT_ID',
    'SLACK_WEBHOOK_EXPERIMENTS_URL',
    'PLAY_SERVICE_ACCOUNT_JSON',
    'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_P8_KEY', 'APPLE_TEAM_ID', 'APPLE_BUNDLE_ID',
    'SHARE_TOKEN_SECRET',
    'QUARTERLY_NPS_SIGNING_KEY',
  ];
  // Store originals and delete
  const originals: Record<string, string> = {};
  for (const k of vendorSecrets) {
    const v = Deno.env.get(k);
    if (v !== undefined) originals[k] = v;
    Deno.env.delete(k);
  }

  // Inject fake admin that records upsert calls
  const { admin: fakeAdmin, upsertCalls } = makeFakeAdmin({});
  setAdminForTest(fakeAdmin);

  try {
    const res = await handleRun();
    assertEquals(res.status, 200, 'handleRun should return 200');

    const body = (await res.json()) as {
      ok: boolean;
      failed: number;
      not_configured: number;
      results: Record<string, SmokeResult>;
    };

    assertEquals(body.failed, 0, 'zero fail when all secrets absent');
    // HealthKit + AdMob always not_configured; with all secrets unset, all vendors not_configured
    // (HealthKit and AdMob are always not_configured regardless)
    for (const [vendorName, result] of Object.entries(body.results)) {
      assertEquals(
        result.status,
        'not_configured',
        `${vendorName} should be not_configured, got ${result.status}`,
      );
    }

    // Upsert should have been called with all registry entries
    assertEquals(upsertCalls.length, 1, 'upsert called exactly once');
    const rows = upsertCalls[0]!.rows as Array<{
      vendor_name: string;
      status: string;
    }>;
    assertEquals(rows.length, VENDOR_REGISTRY.length, 'one row per registry entry');
  } finally {
    resetAdminForTest();
    // Restore originals
    for (const [k, v] of Object.entries(originals)) {
      Deno.env.set(k, v);
    }
  }
});

// ---------------------------------------------------------------------------
// Test 4: handleRun — stubbed probe returning HTTP 200 → status 'ok' with numeric latency_ms
// ---------------------------------------------------------------------------
Deno.test('handleRun: stubbed 200 probe → status ok with numeric latency_ms', async () => {
  // Replace VENDOR_REGISTRY temporarily with a single 'test-vendor' that uses fetch
  const realFetch = globalThis.fetch;

  // Stub a vendor that will call fetch and get 200
  const testVendor: VendorHandler = {
    vendor_name: 'TestVendor200',
    smoke: async (): Promise<SmokeResult> => {
      // Set the env var to bypass notConfigured
      const key = Deno.env.get('TEST_VENDOR_KEY') ?? '';
      if (!key) return { status: 'not_configured', latency_ms: null, message: null };
      const t0 = Date.now();
      const res = await fetch('https://test.example.com/probe');
      const latency_ms = Date.now() - t0;
      if (res.status === 200) return { status: 'ok', latency_ms, message: null };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    },
  };

  // Stub globalThis.fetch to return 200
  globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) => {
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
  };

  Deno.env.set('TEST_VENDOR_KEY', 'some-key');

  // Temporarily override VENDOR_REGISTRY
  const originalRegistry = [...__internal.VENDOR_REGISTRY];
  __internal.VENDOR_REGISTRY.splice(0, __internal.VENDOR_REGISTRY.length, testVendor);

  const { admin: fakeAdmin, upsertCalls } = makeFakeAdmin({});
  setAdminForTest(fakeAdmin);

  try {
    const res = await handleRun();
    assertEquals(res.status, 200);

    const body = (await res.json()) as {
      ok: boolean;
      failed: number;
      results: Record<string, SmokeResult>;
    };

    const result = body.results['TestVendor200'];
    assertExists(result, 'TestVendor200 should have a result');
    assertEquals(result.status, 'ok', 'stubbed 200 → ok');
    assertEquals(typeof result.latency_ms, 'number', 'latency_ms should be numeric');
    assertEquals(body.failed, 0, 'zero failures');
    assertEquals(upsertCalls.length, 1, 'one upsert call');
  } finally {
    globalThis.fetch = realFetch;
    Deno.env.delete('TEST_VENDOR_KEY');
    __internal.VENDOR_REGISTRY.splice(0, __internal.VENDOR_REGISTRY.length, ...originalRegistry);
    resetAdminForTest();
  }
});

// ---------------------------------------------------------------------------
// Test 5: handleRun — stubbed probe returning HTTP 401 → status 'fail' with short message code
// ---------------------------------------------------------------------------
Deno.test('handleRun: stubbed 401 probe → status fail with message code', async () => {
  const realFetch = globalThis.fetch;

  const testVendor: VendorHandler = {
    vendor_name: 'TestVendorFail',
    smoke: async (): Promise<SmokeResult> => {
      const key = Deno.env.get('TEST_VENDOR_FAIL_KEY') ?? '';
      if (!key) return { status: 'not_configured', latency_ms: null, message: null };
      const t0 = Date.now();
      const res = await fetch('https://test.example.com/probe');
      const latency_ms = Date.now() - t0;
      if (res.status === 200) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401) return { status: 'fail', latency_ms, message: 'invalid_api_key' };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    },
  };

  globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) => {
    return Promise.resolve(new Response('Unauthorized', { status: 401 }));
  };

  Deno.env.set('TEST_VENDOR_FAIL_KEY', 'bad-key');

  const originalRegistry = [...__internal.VENDOR_REGISTRY];
  __internal.VENDOR_REGISTRY.splice(0, __internal.VENDOR_REGISTRY.length, testVendor);

  const { admin: fakeAdmin } = makeFakeAdmin({});
  setAdminForTest(fakeAdmin);

  try {
    const res = await handleRun();
    assertEquals(res.status, 200);

    const body = (await res.json()) as {
      ok: boolean;
      failed: number;
      results: Record<string, SmokeResult>;
    };

    const result = body.results['TestVendorFail'];
    assertExists(result, 'TestVendorFail should have a result');
    assertEquals(result.status, 'fail', 'stubbed 401 → fail');
    assertEquals(result.message, 'invalid_api_key', 'message should be short code');
    assertEquals(typeof result.latency_ms, 'number', 'latency_ms should be numeric');
    assertEquals(body.failed, 1, 'one failure counted');
    assertEquals(body.ok, false, 'ok=false when failed > 0');
  } finally {
    globalThis.fetch = realFetch;
    Deno.env.delete('TEST_VENDOR_FAIL_KEY');
    __internal.VENDOR_REGISTRY.splice(0, __internal.VENDOR_REGISTRY.length, ...originalRegistry);
    resetAdminForTest();
  }
});

// ---------------------------------------------------------------------------
// Test 6: handleRun — upserts exactly one row per registry entry
//         asserts onConflict: 'vendor_name' and row shape
// ---------------------------------------------------------------------------
Deno.test('handleRun: upserts one row per registry entry with correct shape', async () => {
  // Use a tiny registry with two deterministic handlers
  const registry: VendorHandler[] = [
    {
      vendor_name: 'VendorA',
      smoke: () => Promise.resolve({ status: 'ok', latency_ms: 42, message: null }),
    },
    {
      vendor_name: 'VendorB',
      smoke: () =>
        Promise.resolve({ status: 'not_configured', latency_ms: null, message: 'reason' }),
    },
  ];

  const originalRegistry = [...__internal.VENDOR_REGISTRY];
  __internal.VENDOR_REGISTRY.splice(0, __internal.VENDOR_REGISTRY.length, ...registry);

  const { admin: fakeAdmin, upsertCalls } = makeFakeAdmin({});
  setAdminForTest(fakeAdmin);

  try {
    const res = await handleRun();
    assertEquals(res.status, 200);

    assertEquals(upsertCalls.length, 1, 'upsert called exactly once');

    const call = upsertCalls[0]!;
    assertEquals(call.table, 'vendor_smoke_log', 'upsert table is vendor_smoke_log');

    // Check onConflict option
    assertEquals(
      (call.options as { onConflict?: string }).onConflict,
      'vendor_name',
      'onConflict should be vendor_name',
    );

    const rows = call.rows as Array<{
      vendor_name: string;
      status: string;
      latency_ms: number | null;
      message: string | null;
      checked_at: string;
    }>;
    assertEquals(rows.length, 2, 'two rows for two vendors');

    // VendorA row
    const rowA = rows.find((r) => r.vendor_name === 'VendorA');
    assertExists(rowA, 'VendorA row exists');
    assertEquals(rowA.status, 'ok');
    assertEquals(rowA.latency_ms, 42);
    assertEquals(rowA.message, null);
    assertExists(rowA.checked_at, 'checked_at is set');

    // VendorB row
    const rowB = rows.find((r) => r.vendor_name === 'VendorB');
    assertExists(rowB, 'VendorB row exists');
    assertEquals(rowB.status, 'not_configured');
    assertEquals(rowB.latency_ms, null);
    assertEquals(rowB.message, 'reason');
    assertExists(rowB.checked_at, 'checked_at is set');
  } finally {
    __internal.VENDOR_REGISTRY.splice(0, __internal.VENDOR_REGISTRY.length, ...originalRegistry);
    resetAdminForTest();
  }
});
