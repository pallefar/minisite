/**
 * Deno tests for `lifecycle-welcome-series` Edge Function — Phase 22 plan 22-02 (ON-02).
 *
 * Test plan:
 *   T1 health-check returns ok:false → 200 + {skipped:true}, no Resend HTTP call
 *   T2 health-check ok + no recipients → 200 + {sent:0}
 *   T3 bucketForAge invariant — 0/1/3/7 day cadence windows
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';

// IMPORTANT: env stubs MUST be set before importing the subject module
// because supabase-js validates the URL string at createClient time.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('SITE_URL', 'https://app.leanshot.app');

const { __internal } = await import('./index.ts');

function emptyFakeAdmin(): unknown {
  return {
    // Health check probes supabase.rpc — return a no-op.
    rpc: () => Promise.resolve({ data: null, error: null }),
    // Lifecycle fn probes from('auth.users').select(...).gt(...).not(...)
    from: (_table: string) => ({
      select: () => ({
        gt: () => ({
          not: () => Promise.resolve({ data: [], error: null }),
        }),
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
    auth: {
      admin: {
        getUserById: () => Promise.resolve({ data: { user: null }, error: null }),
      },
    },
  };
}

function withTestStubs(adminFake: unknown, run: () => Promise<void>): Promise<void> {
  Deno.env.set('RESEND_API_KEY', 'test-stub'); // ensures health passes + sends short-circuit
  __internal.setAdminForTest(adminFake);
  return run().finally(() => {
    __internal.resetAdminForTest();
    Deno.env.delete('RESEND_API_KEY');
  });
}

Deno.test('T1 — health-check fails (no api key) → 200 + skipped:true', async () => {
  // Force "no_api_key" path by NOT setting RESEND_API_KEY for this run.
  Deno.env.delete('RESEND_API_KEY');
  __internal.setAdminForTest(emptyFakeAdmin());
  try {
    const req = new Request('http://localhost/lifecycle-welcome-series', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key' },
    });
    const res = await __internal.handleRun(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.skipped, true);
    assertEquals(body.status, 'no_api_key');
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T2 — health-check ok + no recipients → 200 + sent:0', async () => {
  await withTestStubs(emptyFakeAdmin(), async () => {
    const req = new Request('http://localhost/lifecycle-welcome-series', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key' },
    });
    const res = await __internal.handleRun(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.sent, 0);
    assertEquals(body.processed, 0);
  });
});

Deno.test('T3 — bucketForAge picks correct template by age window', () => {
  const buckets = [
    { ageHours: 2, expected: 'welcome_immediately' },
    { ageHours: 24, expected: 'getting_started_day1' },
    { ageHours: 72, expected: 'first_injection_reminder' },
    { ageHours: 168, expected: 'week_1_check_in' },
    { ageHours: 10, expected: undefined }, // between buckets
    { ageHours: 200, expected: undefined }, // past last bucket
  ];
  for (const b of buckets) {
    const bucket = __internal.bucketForAge(b.ageHours);
    if (b.expected === undefined) {
      assertEquals(bucket, undefined, `ageHours=${b.ageHours} should be undefined`);
    } else {
      assert(bucket !== undefined, `ageHours=${b.ageHours} should resolve to a bucket`);
      assertEquals(bucket?.template, b.expected);
    }
  }
});
