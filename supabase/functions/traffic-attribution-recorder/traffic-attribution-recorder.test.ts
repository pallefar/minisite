/**
 * Phase 51 Plan 51-02 Task 2 — traffic-attribution-recorder Deno unit tests.
 *
 * 4 cases:
 *   1. rejects non-allowlist origin   → 403 origin_denied            [T-51-09]
 *   2. clamps utm fields > 2048 bytes → 200 + recordTouch arg <=2048 [T-51-11]
 *   3. redacts PHI landing paths      → 200 + landingPath '/[redacted]' [T-51-10]
 *   4. returns 200 + body.ok=false on RPC failure                     [T-51-14]
 *
 * Tests use the `setRecordTouchForTest` seam exported by the handler module
 * so we can capture the `RecordTouchArgs` passed to the helper and inject
 * synthetic failures. The actual RPC layer is NOT exercised — that's the
 * job of Plan 51-10's live RLS deny test.
 *
 * Per project memory `reference_deno_test_top_level_serve_trap`, this file
 * MUST be run with `--no-check` because the recorder/index.ts module's top-
 * level `Deno.serve()` guard imports + executes. The guard is conditioned
 * on `denoGlobal?.serve` so it WILL execute under deno test; we set the
 * env var SUPABASE_URL=test BEFORE importing to keep getAdmin() from
 * warning to stderr (the warning is harmless but adds noise).
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Pre-set env BEFORE the module is imported to suppress the
// '[traffic-attribution] SUPABASE_URL ... missing' warning. The recordTouch
// implementation is fully overridden via setRecordTouchForTest below so the
// actual values don't matter (we never hit Supabase).
Deno.env.set('SUPABASE_URL', 'http://test.local');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');

const mod = await import('./index.ts');

const {
  handleTrafficAttributionRecorder,
  setRecordTouchForTest,
  clamp,
  redactPath,
  isAllowedOrigin,
} = mod;

// ============================================================================
// Test 1: rejects non-allowlist origin
// ============================================================================

Deno.test('Test 1: rejects non-allowlist origin with 403 origin_denied', async () => {
  setRecordTouchForTest(null); // not invoked
  const req = new Request('https://app.leanshot.app/functions/v1/traffic-attribution-recorder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example.com',
    },
    body: JSON.stringify({ anonId: 'abc-123', audience: 'consumer' }),
  });
  const res = await handleTrafficAttributionRecorder(req);
  assertEquals(res.status, 403);
  const body = (await res.json()) as { error?: string };
  assertEquals(body.error, 'origin_denied');
});

// ============================================================================
// Test 2: clamps utm fields > 2048 bytes
// ============================================================================

Deno.test('Test 2: clamps utm fields > 2048 bytes before calling recordTouch', async () => {
  let capturedArgs: { utm: { source?: string } } | null = null;
  setRecordTouchForTest(async (args) => {
    capturedArgs = args as typeof capturedArgs;
    return { ok: true, channelGroup: 'Paid Search' };
  });

  const giantSource = 'x'.repeat(3000);
  const req = new Request('https://app.leanshot.app/functions/v1/traffic-attribution-recorder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.leanshot.app',
    },
    body: JSON.stringify({
      anonId: 'abc-123',
      utm: { source: giantSource },
      audience: 'consumer',
    }),
  });
  const res = await handleTrafficAttributionRecorder(req);
  assertEquals(res.status, 200);

  assert(capturedArgs !== null, 'recordTouch should have been invoked');
  assertEquals(
    (capturedArgs as { utm: { source?: string } }).utm.source?.length,
    2048,
    'utm.source must be clamped to 2048 bytes',
  );

  setRecordTouchForTest(null);
});

// ============================================================================
// Test 3: redacts PHI landing paths
// ============================================================================

Deno.test('Test 3: redacts PHI landing paths to /[redacted] before recordTouch', async () => {
  let capturedArgs: { landingPath: string } | null = null;
  setRecordTouchForTest(async (args) => {
    capturedArgs = args as typeof capturedArgs;
    return { ok: true, channelGroup: 'Direct' };
  });

  // Scenario A: /clinic/<x>/patient/<y>
  const reqA = new Request('https://app.leanshot.app/functions/v1/traffic-attribution-recorder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.leanshot.app',
    },
    body: JSON.stringify({
      anonId: 'abc-phi-a',
      landingPath: '/clinic/abc-clinic/patient/12345',
      audience: 'consumer',
    }),
  });
  const resA = await handleTrafficAttributionRecorder(reqA);
  assertEquals(resA.status, 200);
  assert(capturedArgs !== null, 'recordTouch should have been invoked (case A)');
  assertEquals((capturedArgs as { landingPath: string }).landingPath, '/[redacted]');

  // Scenario B: /dose-log/<id>
  capturedArgs = null;
  const reqB = new Request('https://app.leanshot.app/functions/v1/traffic-attribution-recorder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.leanshot.app',
    },
    body: JSON.stringify({
      anonId: 'abc-phi-b',
      landingPath: '/dose-log/xyz',
      audience: 'consumer',
    }),
  });
  const resB = await handleTrafficAttributionRecorder(reqB);
  assertEquals(resB.status, 200);
  assert(capturedArgs !== null, 'recordTouch should have been invoked (case B)');
  assertEquals((capturedArgs as { landingPath: string }).landingPath, '/[redacted]');

  // Scenario C: non-PHI path passes through
  capturedArgs = null;
  const reqC = new Request('https://app.leanshot.app/functions/v1/traffic-attribution-recorder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.leanshot.app',
    },
    body: JSON.stringify({
      anonId: 'abc-non-phi',
      landingPath: '/pricing',
      audience: 'consumer',
    }),
  });
  const resC = await handleTrafficAttributionRecorder(reqC);
  assertEquals(resC.status, 200);
  assert(capturedArgs !== null, 'recordTouch should have been invoked (case C)');
  assertEquals((capturedArgs as { landingPath: string }).landingPath, '/pricing');

  setRecordTouchForTest(null);
});

// ============================================================================
// Test 4: returns 200 + ok=false on RPC failure (fire-and-forget contract)
// ============================================================================

Deno.test('Test 4: returns 200 + body.ok=false on recordTouch failure', async () => {
  setRecordTouchForTest(async () => ({ ok: false, error: 'upsert_failed:network' }));

  const req = new Request('https://app.leanshot.app/functions/v1/traffic-attribution-recorder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.leanshot.app',
    },
    body: JSON.stringify({ anonId: 'abc-fail', audience: 'consumer' }),
  });
  const res = await handleTrafficAttributionRecorder(req);
  assertEquals(res.status, 200, 'must return 200 even on RPC failure (fire-and-forget)');
  const body = (await res.json()) as { ok: boolean; error?: string };
  assertEquals(body.ok, false);
  assertEquals(body.error, 'upsert_failed:network');

  setRecordTouchForTest(null);
});

// ============================================================================
// Helper-level sanity checks (cheap; lock the regexes for refactor safety)
// ============================================================================

Deno.test('helper: clamp() returns null for null input', () => {
  assertEquals(clamp(null, 10), null);
  assertEquals(clamp(undefined, 10), null);
  assertEquals(clamp('abc', 10), 'abc');
  assertEquals(clamp('a'.repeat(15), 10)?.length, 10);
});

Deno.test('helper: redactPath() PHI regex coverage', () => {
  assertEquals(redactPath('/patient/abc'), '/[redacted]');
  assertEquals(redactPath('/patient'), '/[redacted]');
  assertEquals(redactPath('/dose-log/123'), '/[redacted]');
  assertEquals(redactPath('/clinic/abc/patient/xyz'), '/[redacted]');
  assertEquals(redactPath('/pricing'), '/pricing');
  assertEquals(redactPath('/share/clinic-abc'), '/share/clinic-abc');
});

Deno.test('helper: isAllowedOrigin() allowlist', () => {
  assert(isAllowedOrigin('https://app.leanshot.app'));
  assert(isAllowedOrigin('https://leanshot.app'));
  assert(isAllowedOrigin('https://www.leanshot.app'));
  assert(!isAllowedOrigin('https://evil.example.com'));
  assert(!isAllowedOrigin('http://app.leanshot.app')); // http denied
  assert(!isAllowedOrigin(null));
  assert(!isAllowedOrigin(''));
});
