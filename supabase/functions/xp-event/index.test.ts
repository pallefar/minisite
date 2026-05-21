/**
 * Deno tests for `xp-event` Edge Function — Phase 35 Plan 35-03.
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts`.
 *
 * Test plan (Plan 35-03 Task 3 spec):
 *   T1 — Missing bearer → 401 unauthenticated
 *   T2 — Invalid event enum → 400 invalid_body
 *   T3 — Happy path: sanitizes properties (PHI key dropped, allowlist key kept)
 *   T4 — Vendor-gated: POSTHOG_PROJECT_KEY missing → 200 (captureServer no-op)
 *
 * Uses __internal.handler for direct invocation (no Deno.serve port binding).
 * Uses __internal.sanitizeProperties for allowlist unit test.
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-net --allow-env index.test.ts
 */

import { assertEquals } from 'jsr:@std/assert@1';
import { __internal } from './index.ts';
import { setMirrorAdminForTest, resetMirrorAdminForTest } from '../_shared/posthog-server.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
// POSTHOG_PROJECT_KEY intentionally empty — vendor-gated no-op mode
Deno.env.set('POSTHOG_PROJECT_KEY', '');

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_JWT = 'fake-user-jwt';

// ============================================================================
// Fake admin builder — mirrors admin-grant-freeze-token/index.test.ts shape
// ============================================================================

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(opts: { authUserId: string | null }): any {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (opts.authUserId === null) {
          return Promise.resolve({ data: { user: null }, error: { message: 'bad token' } });
        }
        return Promise.resolve({ data: { user: { id: opts.authUserId } }, error: null });
      },
    },
  };
}

// ============================================================================
// Shared noop events_mirror admin (prevents async fetch noise in tests)
// ============================================================================

// deno-lint-ignore no-explicit-any
const noopMirrorAdmin: any = {
  from: (_table: string) => ({ insert: () => Promise.resolve({ error: null }) }),
};

// ============================================================================
// Request builder
// ============================================================================

function mkReq(opts: { method?: string; jwt?: string; body?: unknown }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.jwt) headers.authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/xp-event', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// ============================================================================
// T1 — Missing bearer → 401 unauthenticated
// ============================================================================

Deno.test('T1: missing bearer → 401 unauthenticated', async () => {
  __internal.setAdminForTest(makeFakeAdmin({ authUserId: USER_ID }));
  setMirrorAdminForTest(noopMirrorAdmin);

  const req = mkReq({ body: { event: 'xp_earned', properties: { xp_delta: 25 } } });
  // No JWT header — Authorization absent
  const res = await __internal.handler(req);
  assertEquals(res.status, 401, 'missing JWT must return 401');
  const body = await res.json();
  assertEquals(body.error, 'unauthenticated');

  __internal.resetAdminForTest();
  resetMirrorAdminForTest();
});

// ============================================================================
// T2 — Invalid event enum → 400 invalid_body
// ============================================================================

Deno.test('T2: invalid event enum → 400 invalid_body', async () => {
  __internal.setAdminForTest(makeFakeAdmin({ authUserId: USER_ID }));
  setMirrorAdminForTest(noopMirrorAdmin);

  // Event not in the 6-event enum
  const req = mkReq({
    jwt: USER_JWT,
    body: { event: 'not_a_valid_event', properties: {} },
  });
  const res = await __internal.handler(req);
  assertEquals(res.status, 400, 'invalid event must return 400');
  const body = await res.json();
  assertEquals(body.error, 'invalid_body');

  __internal.resetAdminForTest();
  resetMirrorAdminForTest();
});

// ============================================================================
// T3 — Happy path: properties sanitized (PHI key dropped, allowlist key kept)
// ============================================================================

Deno.test('T3: happy path sanitizes properties — PHI key dropped, allowlist key kept', async () => {
  // Use sanitizeProperties directly for isolation (no network call needed)
  // Then also verify the full handler returns 200.

  // Unit: allowlist enforcement
  const input = {
    xp_delta: 25,           // allowed
    action_type: 'injection_log',  // allowed
    weight_kg: 80.5,        // NOT allowed — PHI, must be dropped
    dose_mg: 1.0,           // NOT allowed — PHI, must be dropped
    badge_id: 'level-5',    // allowed
    challenge_id: 'abc-123', // allowed
    streak_days: 12,        // allowed
    freeze_tokens_remaining: 2,  // allowed
    level_before: 4,        // allowed
    level_after: 5,         // allowed
    patient_name: 'John',   // NOT allowed — PHI, must be dropped
  };

  const sanitized = __internal.sanitizeProperties(input);

  // Only the 8 allowed keys should survive
  assertEquals(sanitized.xp_delta, 25, 'xp_delta should pass through');
  assertEquals(sanitized.action_type, 'injection_log', 'action_type should pass through');
  assertEquals(sanitized.badge_id, 'level-5', 'badge_id should pass through');
  assertEquals(sanitized.challenge_id, 'abc-123', 'challenge_id should pass through');
  assertEquals(sanitized.streak_days, 12, 'streak_days should pass through');
  assertEquals(sanitized.freeze_tokens_remaining, 2, 'freeze_tokens_remaining should pass through');
  assertEquals(sanitized.level_before, 4, 'level_before should pass through');
  assertEquals(sanitized.level_after, 5, 'level_after should pass through');

  // PHI keys must be dropped
  assertEquals(Object.hasOwn(sanitized, 'weight_kg'), false, 'weight_kg (PHI) must be dropped');
  assertEquals(Object.hasOwn(sanitized, 'dose_mg'), false, 'dose_mg (PHI) must be dropped');
  assertEquals(Object.hasOwn(sanitized, 'patient_name'), false, 'patient_name (PHI) must be dropped');

  // Integration: full handler with valid event returns 200
  __internal.setAdminForTest(makeFakeAdmin({ authUserId: USER_ID }));
  setMirrorAdminForTest(noopMirrorAdmin);

  const req = mkReq({
    jwt: USER_JWT,
    body: {
      event: 'xp_earned',
      properties: { xp_delta: 25, action_type: 'injection_log', weight_kg: 80 },
    },
  });
  const res = await __internal.handler(req);
  assertEquals(res.status, 200, 'valid xp_earned event must return 200');
  const resBody = await res.json();
  assertEquals(resBody.ok, true, 'response.ok must be true');

  __internal.resetAdminForTest();
  resetMirrorAdminForTest();
});

// ============================================================================
// T4 — Vendor-gated: POSTHOG_PROJECT_KEY missing → 200 (captureServer no-op)
// ============================================================================

Deno.test('T4: POSTHOG_PROJECT_KEY missing → 200 (vendor-gated no-op)', async () => {
  // POSTHOG_PROJECT_KEY is already set to '' in this test file's setup.
  // captureServer no-ops when key is missing (vendor-gated health-check pattern).
  __internal.setAdminForTest(makeFakeAdmin({ authUserId: USER_ID }));
  setMirrorAdminForTest(noopMirrorAdmin);

  const req = mkReq({
    jwt: USER_JWT,
    body: { event: 'level_up', properties: { level_before: 4, level_after: 5 } },
  });
  const res = await __internal.handler(req);
  // Even with PostHog key absent, handler returns 200 (not 500/503)
  // — captureServer is a no-op, not a failure (reference_vendor_gated_send_health_check)
  assertEquals(res.status, 200, 'missing PostHog key must still return 200 (vendor-gated no-op)');
  const body = await res.json();
  assertEquals(body.ok, true, 'response.ok must be true in vendor-gated mode');

  __internal.resetAdminForTest();
  resetMirrorAdminForTest();
});
