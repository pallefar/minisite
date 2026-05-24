/**
 * Deno tests for lesson-progress-beacon Edge Function.
 *
 * Per reference_deno_test_top_level_serve_trap: index.ts uses the
 * `import.meta.main && denoGlobal?.serve` guard so importing this module
 * does NOT spawn a real HTTP server.
 *
 * Critical correctness coverage (per CONTEXT.md correction 8 + RESEARCH Pitfall 3):
 *   - sendBeacon sends Content-Type: text/plain;charset=UTF-8 with a JSON string body.
 *     The fn MUST use `req.text()` + `JSON.parse()`, NOT `req.json()` (would throw).
 *   - sendBeacon cannot set Authorization header — access_token MUST come from body.
 *   - sendBeacon cannot read responses — all error paths return 200 silently.
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/lesson-progress-beacon/
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  handler,
  setAdminForTest,
  resetAdminForTest,
  setUserClientFactoryForTest,
  resetUserClientFactoryForTest,
} from './index.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface RpcCallArgs {
  name: string;
  args: {
    p_lesson_id?: unknown;
    p_last_position_seconds?: unknown;
    p_max_position_reached_seconds?: unknown;
  };
}

let lastRpcCall: RpcCallArgs | null = null;
let rpcCallCount = 0;

function makeMockAdmin(opts: { validToken?: string; userId?: string }): unknown {
  const { validToken = 'valid-jwt', userId = 'user-1' } = opts;
  return {
    auth: {
      getUser: (token: string) => {
        if (token === validToken) {
          return Promise.resolve({ data: { user: { id: userId } }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: null });
      },
    },
  };
}

function makeMockUserClient(): unknown {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCallCount++;
      lastRpcCall = {
        name,
        args: args as RpcCallArgs['args'],
      };
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function resetRpcRecorder(): void {
  lastRpcCall = null;
  rpcCallCount = 0;
}

function makeBeaconRequest(opts: {
  method?: string;
  body?: string | undefined;
  contentType?: string;
}): Request {
  const { method = 'POST', body, contentType = 'text/plain;charset=UTF-8' } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = contentType;
  return new Request('https://example.supabase.co/functions/v1/lesson-progress-beacon', {
    method,
    headers,
    body,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

Deno.test('valid text/plain body + valid token → 200 + rpc called once', async () => {
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRpcRecorder();
  setAdminForTest(makeMockAdmin({ validToken: 'jwt-A', userId: 'user-A' }));
  setUserClientFactoryForTest((_token: string) => makeMockUserClient());

  const body = JSON.stringify({
    lesson_id: 'lesson-1',
    last_position_seconds: 120,
    max_position_reached_seconds: 130,
    access_token: 'jwt-A',
  });
  const req = makeBeaconRequest({ body });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(rpcCallCount, 1);
  assertExists(lastRpcCall);
  assertEquals(lastRpcCall!.name, 'update_lesson_position');
  assertEquals(lastRpcCall!.args.p_lesson_id, 'lesson-1');
  assertEquals(lastRpcCall!.args.p_last_position_seconds, 120);
  assertEquals(lastRpcCall!.args.p_max_position_reached_seconds, 130);

  resetAdminForTest();
  resetUserClientFactoryForTest();
});

Deno.test('Content-Type: text/plain;charset=UTF-8 body parses correctly (sendBeacon shape)', async () => {
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRpcRecorder();
  setAdminForTest(makeMockAdmin({ validToken: 'jwt-B', userId: 'user-B' }));
  setUserClientFactoryForTest((_token: string) => makeMockUserClient());

  const body = JSON.stringify({
    lesson_id: 'lesson-2',
    last_position_seconds: 60,
    max_position_reached_seconds: 60,
    access_token: 'jwt-B',
  });
  // Explicit text/plain content-type — sendBeacon's canonical default for a string body.
  const req = makeBeaconRequest({ body, contentType: 'text/plain;charset=UTF-8' });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(rpcCallCount, 1);

  resetAdminForTest();
  resetUserClientFactoryForTest();
});

Deno.test('invalid JSON body → 200, no rpc call', async () => {
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRpcRecorder();
  setAdminForTest(makeMockAdmin({}));
  setUserClientFactoryForTest((_token: string) => makeMockUserClient());

  const req = makeBeaconRequest({ body: '{not-json' });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(rpcCallCount, 0);

  resetAdminForTest();
  resetUserClientFactoryForTest();
});

Deno.test('missing access_token → 200, no rpc call', async () => {
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRpcRecorder();
  setAdminForTest(makeMockAdmin({}));
  setUserClientFactoryForTest((_token: string) => makeMockUserClient());

  const body = JSON.stringify({
    lesson_id: 'lesson-1',
    last_position_seconds: 10,
    max_position_reached_seconds: 10,
  });
  const req = makeBeaconRequest({ body });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(rpcCallCount, 0);

  resetAdminForTest();
  resetUserClientFactoryForTest();
});

Deno.test('invalid access_token → 200, no rpc call (auth.getUser returns null)', async () => {
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRpcRecorder();
  setAdminForTest(makeMockAdmin({ validToken: 'only-valid-jwt' }));
  setUserClientFactoryForTest((_token: string) => makeMockUserClient());

  const body = JSON.stringify({
    lesson_id: 'lesson-1',
    last_position_seconds: 10,
    max_position_reached_seconds: 10,
    access_token: 'this-is-invalid',
  });
  const req = makeBeaconRequest({ body });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(rpcCallCount, 0);

  resetAdminForTest();
  resetUserClientFactoryForTest();
});

Deno.test('missing lesson_id → 200, no rpc call', async () => {
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRpcRecorder();
  setAdminForTest(makeMockAdmin({ validToken: 'jwt-C', userId: 'user-C' }));
  setUserClientFactoryForTest((_token: string) => makeMockUserClient());

  const body = JSON.stringify({
    last_position_seconds: 10,
    max_position_reached_seconds: 10,
    access_token: 'jwt-C',
  });
  const req = makeBeaconRequest({ body });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(rpcCallCount, 0);

  resetAdminForTest();
  resetUserClientFactoryForTest();
});

Deno.test('non-number last_position_seconds → 200, no rpc call', async () => {
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRpcRecorder();
  setAdminForTest(makeMockAdmin({ validToken: 'jwt-D', userId: 'user-D' }));
  setUserClientFactoryForTest((_token: string) => makeMockUserClient());

  const body = JSON.stringify({
    lesson_id: 'lesson-1',
    last_position_seconds: '120', // string, not number
    max_position_reached_seconds: 130,
    access_token: 'jwt-D',
  });
  const req = makeBeaconRequest({ body });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(rpcCallCount, 0);

  resetAdminForTest();
  resetUserClientFactoryForTest();
});

Deno.test('OPTIONS preflight → 204 with CORS headers', async () => {
  const req = new Request('https://example.supabase.co/functions/v1/lesson-progress-beacon', {
    method: 'OPTIONS',
  });
  const res = await handler(req);
  assertEquals(res.status, 204);
  assertExists(res.headers.get('Access-Control-Allow-Origin'));
});

Deno.test('GET → 405', async () => {
  const req = new Request('https://example.supabase.co/functions/v1/lesson-progress-beacon', {
    method: 'GET',
  });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test('rpc invoked with rounded non-negative integers (clamp/round defense)', async () => {
  resetAdminForTest();
  resetUserClientFactoryForTest();
  resetRpcRecorder();
  setAdminForTest(makeMockAdmin({ validToken: 'jwt-E', userId: 'user-E' }));
  setUserClientFactoryForTest((_token: string) => makeMockUserClient());

  // last=130.7 → 131; max=-5 → 0
  const body = JSON.stringify({
    lesson_id: 'lesson-1',
    last_position_seconds: 130.7,
    max_position_reached_seconds: -5,
    access_token: 'jwt-E',
  });
  const req = makeBeaconRequest({ body });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(rpcCallCount, 1);
  assertExists(lastRpcCall);
  assertEquals(lastRpcCall!.args.p_last_position_seconds, 131);
  assertEquals(lastRpcCall!.args.p_max_position_reached_seconds, 0);

  resetAdminForTest();
  resetUserClientFactoryForTest();
});
