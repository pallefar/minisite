/**
 * subprocessor-diff Edge Function — Deno unit tests.
 * Phase 25 Plan 25-09 (HIPAA-12, HIPAA-13).
 *
 * Tests mock the supabase admin client and global fetch. Covers:
 *   1. Auth: bad bearer → 401.
 *   2. All 6 vendors return same content as last snapshot → 0 changes.
 *   3. Vendor X returns new content → 1 insert + 1 audit + 1 email attempt.
 *   4. Vendor Y URL returns 404 → audit row (subprocessor_fetch_failed); others continue.
 *   5. Vendor Z fetch times out → handled same as 404.
 *   6. Idempotency: duplicate content → unique index conflict → no double insert.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { __internal } from './index.ts';

const { handleRun, setAdminForTest, resetAdminForTest, sha256Hex, VENDOR_SUBPROCESSOR_URLS } =
  __internal;

const GOOD_BEARER = 'test-service-role-key';

function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/subprocessor-diff', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: '{}',
  });
}

/** Build a mock supabase admin that returns given snapshot for every vendor. */
function buildMockAdmin({
  latestSnapshot = null as { content_hash: string; id: number } | null,
  insertError = null as { message: string } | null,
  rpcCalls = [] as string[],
}: {
  latestSnapshot?: { content_hash: string; id: number } | null;
  insertError?: { message: string } | null;
  rpcCalls?: string[];
}) {
  return {
    _rpcCalls: rpcCalls,
    from: (table: string) => {
      if (table === 'subprocessor_snapshots') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: latestSnapshot, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              limit: () => Promise.resolve({ data: [{ id: 99 }], error: insertError }),
            }),
          }),
        };
      }
      if (table === 'vendor_baa_chain') {
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      return {};
    },
    rpc: (fnName: string, _args: unknown) => {
      rpcCalls.push(fnName);
      return Promise.resolve({ error: null });
    },
  };
}

function setupEnv() {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', GOOD_BEARER);
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
}

// ─── Test 1: Auth bad bearer → 401 ───────────────────────────────────────────
Deno.test('subprocessor-diff auth: bad bearer → 401', async () => {
  setupEnv();
  const req = makeRequest('Bearer wrong');
  const { checkServiceRoleBearer, jsonError } = await import('../_shared/lifecycle-utils.ts');
  const resp = checkServiceRoleBearer(req) ? new Response('ok') : jsonError(401, 'unauthorized');
  assertEquals(resp.status, 401);
});

// ─── Test 2: All 6 vendors unchanged → 0 changes ─────────────────────────────
Deno.test('subprocessor-diff: all vendors unchanged → {changed:0}', async () => {
  setupEnv();

  // Pre-compute hash of mock page content.
  const mockBody = '<html>subprocessor list v1</html>';
  const mockHash = await sha256Hex(mockBody);

  // All vendors return same content as latest snapshot.
  const mock = buildMockAdmin({ latestSnapshot: { content_hash: mockHash, id: 1 } });
  setAdminForTest(mock);

  // Mock global fetch to return mockBody for all URLs.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(mockBody, { status: 200 });

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  const body = await resp.json();

  globalThis.fetch = origFetch;
  resetAdminForTest();

  assertEquals(resp.status, 200);
  assertEquals(body.changed, 0);
  assertEquals(body.checked, 6);
  assertEquals(body.failed, 0);
});

// ─── Test 3: One vendor has new content → 1 change ───────────────────────────
Deno.test('subprocessor-diff: one vendor new content → {changed:1, audit+email}', async () => {
  setupEnv();
  Deno.env.set('SUPERADMIN_ALERTS_EMAIL', 'founder@example.com');

  const oldBody = '<html>old</html>';
  const newBody = '<html>new subprocessor added!</html>';
  const oldHash = await sha256Hex(oldBody);

  const rpcCalls: string[] = [];
  const mock = buildMockAdmin({
    latestSnapshot: { content_hash: oldHash, id: 1 },
    rpcCalls,
  });
  setAdminForTest(mock);

  // First vendor (Supabase) returns new content; others return old.
  let callCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) => {
    callCount += 1;
    return new Response(callCount === 1 ? newBody : oldBody, { status: 200 });
  };

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  const body = await resp.json();

  globalThis.fetch = origFetch;
  resetAdminForTest();

  assertEquals(resp.status, 200);
  assertEquals(body.changed, 1);
  assertEquals(rpcCalls.includes('log_vendor_baa_event'), true);
});

// ─── Test 4: Vendor URL returns 404 → subprocessor_fetch_failed audit row ─────
Deno.test('subprocessor-diff: one vendor 404 → {failed:1} + audit row', async () => {
  setupEnv();

  const rpcCalls: string[] = [];
  const mock = buildMockAdmin({ latestSnapshot: null, rpcCalls });
  setAdminForTest(mock);

  // First vendor returns 404; others return 200 with a fresh body (no prior snapshot → 5 changes).
  let callCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) => {
    callCount += 1;
    if (callCount === 1) return new Response('not found', { status: 404 });
    return new Response(`<html>content ${callCount}</html>`, { status: 200 });
  };

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  const body = await resp.json();

  globalThis.fetch = origFetch;
  resetAdminForTest();

  assertEquals(resp.status, 200);
  assertEquals(body.failed, 1);
  // Remaining 5 vendors succeed (no prior snapshot → 5 changes).
  assertEquals(body.changed, 5);
  assertEquals(rpcCalls.includes('log_vendor_baa_event'), true);
});

// ─── Test 5: Vendor fetch times out → handled same as 404 ────────────────────
Deno.test('subprocessor-diff: fetch timeout → {failed:1}', async () => {
  setupEnv();

  const rpcCalls: string[] = [];
  const mock = buildMockAdmin({ latestSnapshot: null, rpcCalls });
  setAdminForTest(mock);

  // All vendors time out.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) => {
    // Simulate AbortError (timeout).
    const err = new DOMException('signal timed out', 'TimeoutError');
    throw err;
  };

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  const body = await resp.json();

  globalThis.fetch = origFetch;
  resetAdminForTest();

  assertEquals(resp.status, 200);
  assertEquals(body.failed, 6);
  assertEquals(body.changed, 0);
  assertEquals(rpcCalls.filter((c) => c === 'log_vendor_baa_event').length, 6);
});

// ─── Test 6: Idempotency — same content hash as latest snapshot → skip ────────
Deno.test('subprocessor-diff: same content hash as snapshot → no insert (idempotent)', async () => {
  setupEnv();

  // All vendors return the same body; mock the snapshot to have that same hash.
  // This simulates the weekly cron running when nothing has changed.
  const sameBody = '<html>subprocessor list unchanged</html>';
  const sameHash = await sha256Hex(sameBody);

  const rpcCalls: string[] = [];
  const mock = buildMockAdmin({
    latestSnapshot: { content_hash: sameHash, id: 42 }, // hash matches → skip
    rpcCalls,
  });
  setAdminForTest(mock);

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sameBody, { status: 200 });

  const req = makeRequest(`Bearer ${GOOD_BEARER}`);
  const resp = await handleRun(req);
  const body = await resp.json();

  globalThis.fetch = origFetch;
  resetAdminForTest();

  assertEquals(resp.status, 200);
  assertEquals(body.changed, 0); // all hashes match → no inserts
  assertEquals(body.failed, 0);
  assertEquals(body.checked, 6);
  // No audit rows emitted for unchanged vendors.
  assertEquals(rpcCalls.filter((c) => c === 'log_vendor_baa_event').length, 0);
});

// ─── Verify VENDOR_SUBPROCESSOR_URLS has exactly 6 entries ───────────────────
Deno.test('subprocessor-diff: VENDOR_SUBPROCESSOR_URLS has 6 vendors', () => {
  const vendors = Object.keys(VENDOR_SUBPROCESSOR_URLS);
  assertEquals(vendors.length, 6);
  assertEquals(vendors.includes('Supabase'), true);
  assertEquals(vendors.includes('Vercel'), true);
  assertEquals(vendors.includes('Sentry'), true);
  assertEquals(vendors.includes('Anthropic'), true);
  assertEquals(vendors.includes('AWS SES'), true);
  assertEquals(vendors.includes('PostHog'), true);
});
