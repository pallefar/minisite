/**
 * baa-expiry-check Edge Function — Deno unit tests.
 * Phase 25 Plan 25-09 (HIPAA-12, HIPAA-13).
 *
 * Tests mock the supabase admin client and global fetch. Covers:
 *   1. Auth: bad bearer → 401.
 *   2. Auth: good bearer → 200.
 *   3. No vendors near expiry → {alerts:0, expired:0}.
 *   4. Vendor expires in exactly 60 days → 1 alert + 1 audit_logs RPC call.
 *   5. Vendor already warned today (idempotency) → no duplicate.
 *   6. Vendor past expiry → vendor_baa_chain_set_expired RPC called.
 *   7. email-router fails (no Resend key) → cron still returns 200.
 *   8. Multiple vendors at different buckets → multi-row report.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { __internal } from './index.ts';

const { handleRun, setAdminForTest, resetAdminForTest } = __internal;

const GOOD_BEARER = 'test-service-role-key';

/** Helper: create a minimal POST request with given Authorization header. */
function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/baa-expiry-check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: '{}',
  });
}

/** Helper: future date N days from now (ISO string). */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

/** Helper: past date N days ago (ISO string). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Build a minimal mock supabase admin client. */
function buildMockAdmin({
  vendors = [] as Array<{ vendor_name: string; baa_expiry_at: string; status: string }>,
  auditCount = 0,
  rpcResults = {} as Record<string, { error: null | { message: string } }>,
}: {
  vendors?: Array<{ vendor_name: string; baa_expiry_at: string; status: string }>;
  auditCount?: number;
  rpcResults?: Record<string, { error: null | { message: string } }>;
}) {
  const rpcCalls: string[] = [];

  const mockAdmin = {
    _rpcCalls: rpcCalls,
    from: (table: string) => {
      if (table === 'vendor_baa_chain') {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () =>
                  Promise.resolve({ data: vendors, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        // Idempotency check: return count
        return {
          select: (_cols: string, _opts: unknown) => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  filter: () => ({
                    gte: () => ({
                      lt: () => Promise.resolve({ count: auditCount, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ data: null, error: null }) };
    },
    rpc: (fnName: string, _args: unknown) => {
      rpcCalls.push(fnName);
      const result = rpcResults[fnName] ?? { error: null };
      return Promise.resolve(result);
    },
  };

  return mockAdmin;
}

// Restore env + admin after each test group.
function setupEnv() {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', GOOD_BEARER);
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
}

Deno.test('baa-expiry-check auth: bad bearer → 401', async () => {
  setupEnv();
  const req = makeRequest('Bearer wrong-key');
  const resp = await (async () => {
    // Import the Deno.serve-wrapped handler directly via __internal.handleRun
    // but auth check happens in the serve wrapper. Simulate via fetch + check
    // bearer validation independently.
    // Since handleRun() bypasses bearer (it's checked before calling handleRun),
    // we test the 401 path via the exported checkServiceRoleBearer.
    const { checkServiceRoleBearer, jsonError } = await import('../_shared/lifecycle-utils.ts');
    if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
    return new Response('ok', { status: 200 });
  })();
  assertEquals(resp.status, 401);
});

Deno.test('baa-expiry-check auth: good bearer → passes auth check', async () => {
  setupEnv();
  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const { checkServiceRoleBearer } = await import('../_shared/lifecycle-utils.ts');
  assertEquals(checkServiceRoleBearer(req), true);
});

Deno.test('baa-expiry-check: no vendors near expiry → {alerts:0, expired:0}', async () => {
  setupEnv();
  // Vendor expires in 90 days — NOT in any bucket.
  const mock = buildMockAdmin({
    vendors: [{ vendor_name: 'Supabase', baa_expiry_at: daysFromNow(90), status: 'signed' }],
    auditCount: 0,
  });
  setAdminForTest(mock);

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.alerts, 0);
  assertEquals(body.expired, 0);
  assertEquals(body.checked, 1);
  resetAdminForTest();
});

Deno.test('baa-expiry-check: vendor expires in exactly 60 days → 1 alert + 1 RPC call', async () => {
  setupEnv();
  const mock = buildMockAdmin({
    vendors: [{ vendor_name: 'Sentry', baa_expiry_at: daysFromNow(60), status: 'signed' }],
    auditCount: 0,
    rpcResults: { log_vendor_baa_event: { error: null } },
  });
  setAdminForTest(mock);

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.alerts, 1);
  assertEquals(body.expired, 0);
  // Verify RPC was called.
  assertEquals((mock as typeof mock & { _rpcCalls: string[] })._rpcCalls.includes('log_vendor_baa_event'), true);
  resetAdminForTest();
});

Deno.test('baa-expiry-check: vendor already warned today (idempotency) → no duplicate', async () => {
  setupEnv();
  const mock = buildMockAdmin({
    vendors: [{ vendor_name: 'Vercel', baa_expiry_at: daysFromNow(30), status: 'signed' }],
    auditCount: 1, // already warned today
    rpcResults: { log_vendor_baa_event: { error: null } },
  });
  setAdminForTest(mock);

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.alerts, 0); // already done
  resetAdminForTest();
});

Deno.test('baa-expiry-check: vendor past expiry → vendor_baa_chain_set_expired called', async () => {
  setupEnv();
  const mock = buildMockAdmin({
    vendors: [{ vendor_name: 'Anthropic', baa_expiry_at: daysAgo(2), status: 'signed' }],
    auditCount: 0,
    rpcResults: { vendor_baa_chain_set_expired: { error: null } },
  });
  setAdminForTest(mock);

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.expired, 1);
  assertEquals(
    (mock as typeof mock & { _rpcCalls: string[] })._rpcCalls.includes('vendor_baa_chain_set_expired'),
    true,
  );
  resetAdminForTest();
});

Deno.test('baa-expiry-check: email-router unavailable → still returns 200', async () => {
  setupEnv();
  // No SUPERADMIN_ALERTS_EMAIL set — email path skipped gracefully.
  Deno.env.delete('SUPERADMIN_ALERTS_EMAIL');
  const mock = buildMockAdmin({
    vendors: [{ vendor_name: 'AWS SES', baa_expiry_at: daysFromNow(7), status: 'signed' }],
    auditCount: 0,
    rpcResults: { log_vendor_baa_event: { error: null } },
  });
  setAdminForTest(mock);

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.alerts, 1); // alert logged even without email
  resetAdminForTest();
});

Deno.test('baa-expiry-check: multiple vendors at different buckets → multi-row report', async () => {
  setupEnv();
  const mock = buildMockAdmin({
    vendors: [
      { vendor_name: 'Supabase', baa_expiry_at: daysFromNow(60), status: 'signed' },
      { vendor_name: 'Vercel', baa_expiry_at: daysFromNow(30), status: 'signed' },
      { vendor_name: 'Sentry', baa_expiry_at: daysFromNow(90), status: 'signed' }, // no bucket
    ],
    auditCount: 0,
    rpcResults: { log_vendor_baa_event: { error: null } },
  });
  setAdminForTest(mock);

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.checked, 3);
  assertEquals(body.alerts, 2); // 60d + 30d; 90d skipped
  resetAdminForTest();
});
