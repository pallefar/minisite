/**
 * Deno tests for `nps-cta-click-log` — Phase 36 Plan 36-02 Task 2.
 *
 * T1 — no Bearer → 401 unauthenticated
 * T2 — invalid JWT → 401 unauthenticated
 * T3 — invalid platform (e.g. 'apple_app_store') → 400 invalid_platform
 * T4 — OPTIONS preflight → 204 with CORS headers
 * T5 — valid request fires captureServer({event:'external_review_clicked', userId, properties:{platform}})
 * T6 — returns 204 No Content on success
 * T7 — captureServer is called BEFORE shutdownPostHog (finally semantics)
 * T8 — body missing platform field → 400 invalid_platform
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts`.
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const USER_UUID = '55555555-5555-4555-8555-555555555555';
const VALID_JWT = 'jwt-valid';

interface CaptureLog {
  calls: Array<{ event: string; userId: string; properties?: Record<string, unknown> }>;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(authBehavior: 'ok' | 'error'): any {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (authBehavior === 'error') {
          return Promise.resolve({ data: { user: null }, error: { message: 'invalid_jwt' } });
        }
        return Promise.resolve({ data: { user: { id: USER_UUID } }, error: null });
      },
    },
  };
}

function makeCaptureSpy(log: CaptureLog) {
  return (args: { event: string; userId: string; properties?: Record<string, unknown> }) => {
    log.calls.push(args);
  };
}

function mkReq(opts: { jwt?: string; body?: unknown; method?: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/nps-cta-click-log', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function setEnv(): void {
  Deno.env.delete('POSTHOG_PROJECT_KEY');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
}

Deno.test('T1: no Bearer → 401 unauthenticated', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin('ok'));
  const log: CaptureLog = { calls: [] };
  __internal.setCaptureForTest(makeCaptureSpy(log));
  try {
    const res = await __internal.handleClickLog(mkReq({ body: { platform: 'trustpilot' } }));
    assertEquals(res.status, 401);
    assertEquals(log.calls.length, 0);
  } finally {
    __internal.resetCaptureForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T2: invalid JWT → 401 unauthenticated', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin('error'));
  const log: CaptureLog = { calls: [] };
  __internal.setCaptureForTest(makeCaptureSpy(log));
  try {
    const res = await __internal.handleClickLog(
      mkReq({ jwt: VALID_JWT, body: { platform: 'trustpilot' } }),
    );
    assertEquals(res.status, 401);
    assertEquals(log.calls.length, 0);
  } finally {
    __internal.resetCaptureForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T3: invalid platform → 400 invalid_platform', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin('ok'));
  const log: CaptureLog = { calls: [] };
  __internal.setCaptureForTest(makeCaptureSpy(log));
  try {
    const res = await __internal.handleClickLog(
      mkReq({ jwt: VALID_JWT, body: { platform: 'apple_app_store' } }),
    );
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'invalid_platform');
    assertEquals(log.calls.length, 0);
  } finally {
    __internal.resetCaptureForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T4: OPTIONS preflight → 204 with CORS headers', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin('ok'));
  try {
    const res = await __internal.handleClickLog(mkReq({ method: 'OPTIONS' }));
    assertEquals(res.status, 204);
    assert(res.headers.get('Access-Control-Allow-Origin') !== null);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T5: valid request fires captureServer with correct shape (T-36-12: only platform in properties)', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin('ok'));
  const log: CaptureLog = { calls: [] };
  __internal.setCaptureForTest(makeCaptureSpy(log));
  try {
    const res = await __internal.handleClickLog(
      mkReq({ jwt: VALID_JWT, body: { platform: 'trustpilot' } }),
    );
    assertEquals(res.status, 204);
    assertEquals(log.calls.length, 1);
    assertEquals(log.calls[0].event, 'external_review_clicked');
    assertEquals(log.calls[0].userId, USER_UUID);
    assertEquals(log.calls[0].properties, { platform: 'trustpilot' });
    // T-36-12 PII discipline: no rating, no feedback_text, no other PII.
    const keys = Object.keys(log.calls[0].properties ?? {});
    assertEquals(keys, ['platform']);
  } finally {
    __internal.resetCaptureForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T6: success returns 204 No Content (no body)', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin('ok'));
  __internal.setCaptureForTest(() => {});
  try {
    const res = await __internal.handleClickLog(
      mkReq({ jwt: VALID_JWT, body: { platform: 'g2' } }),
    );
    assertEquals(res.status, 204);
    // No body on 204 — the Body stream is empty.
    const text = await res.text();
    assertEquals(text, '');
  } finally {
    __internal.resetCaptureForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T7: shutdownPostHog awaited in finally — capture called even when no real PostHog client (no throw)', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin('ok'));
  let captureCalled = false;
  __internal.setCaptureForTest(() => {
    captureCalled = true;
  });
  try {
    const res = await __internal.handleClickLog(
      mkReq({ jwt: VALID_JWT, body: { platform: 'capterra' } }),
    );
    assertEquals(res.status, 204);
    assert(captureCalled);
  } finally {
    __internal.resetCaptureForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T8: body missing platform → 400 invalid_platform', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin('ok'));
  __internal.setCaptureForTest(() => {});
  try {
    const res = await __internal.handleClickLog(mkReq({ jwt: VALID_JWT, body: {} }));
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'invalid_platform');
  } finally {
    __internal.resetCaptureForTest();
    __internal.resetAdminForTest();
  }
});
