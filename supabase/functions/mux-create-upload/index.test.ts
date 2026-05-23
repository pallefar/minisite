/**
 * Deno tests for mux-create-upload Edge Function.
 *
 * Per reference_deno_test_top_level_serve_trap: index.ts uses the denoGlobal?.serve
 * guard so importing this module does NOT spawn a real HTTP server.
 *
 * Run: $HOME/.deno/bin/deno test --no-check supabase/functions/mux-create-upload/index.test.ts
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler, setAdminForTest, resetAdminForTest, setMuxForTest, resetMuxForTest } from './index.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MuxUploadCallArgs {
  cors_origin: string;
  new_asset_settings: {
    playback_policies: string[];
    max_duration_seconds: number;
    passthrough: string;
  };
  timeout: number;
}

function makeMockAdmin(opts: {
  userId?: string | null;
  tierLabel?: string;
  shouldThrow?: boolean;
}): unknown {
  const { userId = 'user-1', tierLabel = 'pro', shouldThrow = false } = opts;

  const mockAdmin = {
    auth: {
      getUser: (_bearer: string) => {
        if (userId === null) {
          return Promise.resolve({ data: { user: null }, error: null });
        }
        return Promise.resolve({
          data: { user: { id: userId } },
          error: null,
        });
      },
    },
    from: (table: string) => {
      if (table === 'tier_effective') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              single: () => {
                if (shouldThrow) return Promise.reject(new Error('DB error'));
                return Promise.resolve({
                  data: tierLabel ? { tier_label: tierLabel } : null,
                  error: null,
                });
              },
            }),
          }),
        };
      }
      return {};
    },
  };
  return mockAdmin;
}

const MUX_UPLOAD_ID = 'mux-upload-1';
const MUX_UPLOAD_URL = 'https://storage.googleapis.com/mux-uploads/mux-upload-1';

let lastMuxCallArgs: MuxUploadCallArgs | null = null;
let muxShouldThrow = false;

function makeMockMux(): unknown {
  return {
    video: {
      uploads: {
        create: (args: MuxUploadCallArgs) => {
          lastMuxCallArgs = args;
          if (muxShouldThrow) return Promise.reject(new Error('Mux API error'));
          return Promise.resolve({ id: MUX_UPLOAD_ID, url: MUX_UPLOAD_URL });
        },
      },
    },
  };
}

function makeRequest(opts: {
  method?: string;
  bearer?: string;
  body?: unknown;
  origin?: string;
}): Request {
  const { method = 'POST', bearer, body, origin = 'https://app.leanshot.app' } = opts;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Origin': origin,
  };
  if (bearer !== undefined) {
    headers['Authorization'] = `Bearer ${bearer}`;
  }
  return new Request('https://example.supabase.co/functions/v1/mux-create-upload', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

Deno.test('returns 401 when no Authorization header', async () => {
  resetAdminForTest();
  resetMuxForTest();
  setAdminForTest(makeMockAdmin({ userId: null }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: undefined, body: { post_id: 'post-1' } });
  const res = await handler(req);

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');

  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 401 when JWT resolves to null user', async () => {
  resetAdminForTest();
  resetMuxForTest();
  setAdminForTest(makeMockAdmin({ userId: null }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'invalid-token', body: { post_id: 'post-1' } });
  const res = await handler(req);

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');

  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 403 VIDEO_TIER_REQUIRED when tier_label is free', async () => {
  resetAdminForTest();
  resetMuxForTest();
  setAdminForTest(makeMockAdmin({ userId: 'user-1', tierLabel: 'free' }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid-jwt', body: { post_id: 'post-1' } });
  const res = await handler(req);

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'VIDEO_TIER_REQUIRED');

  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 403 VIDEO_TIER_REQUIRED when tier_label is null (no row)', async () => {
  resetAdminForTest();
  resetMuxForTest();
  // tierLabel empty string → defaults to 'free'
  setAdminForTest(makeMockAdmin({ userId: 'user-1', tierLabel: '' }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid-jwt', body: { post_id: 'post-1' } });
  const res = await handler(req);

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'VIDEO_TIER_REQUIRED');

  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 200 with upload url+id for pro tier', async () => {
  resetAdminForTest();
  resetMuxForTest();
  lastMuxCallArgs = null;
  muxShouldThrow = false;
  setAdminForTest(makeMockAdmin({ userId: 'user-1', tierLabel: 'pro' }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid-jwt', body: { post_id: 'post-abc' } });
  const res = await handler(req);

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, MUX_UPLOAD_URL);
  assertEquals(body.upload_id, MUX_UPLOAD_ID);

  // Assert the passthrough payload shape (authoritative contract for mux-webhook)
  assertExists(lastMuxCallArgs);
  const passthrough = JSON.parse(lastMuxCallArgs!.new_asset_settings.passthrough);
  assertEquals(passthrough.user_id, 'user-1');
  assertEquals(passthrough.post_id, 'post-abc');

  // Assert max_duration_seconds = 300 (D-05: 5-min cap)
  assertEquals(lastMuxCallArgs!.new_asset_settings.max_duration_seconds, 300);

  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 200 with upload url+id for lifetime tier', async () => {
  resetAdminForTest();
  resetMuxForTest();
  lastMuxCallArgs = null;
  muxShouldThrow = false;
  setAdminForTest(makeMockAdmin({ userId: 'user-2', tierLabel: 'lifetime' }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid-jwt', body: { post_id: 'post-def' } });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertExists(lastMuxCallArgs);
  const passthrough = JSON.parse(lastMuxCallArgs!.new_asset_settings.passthrough);
  assertEquals(passthrough.user_id, 'user-2');
  assertEquals(passthrough.post_id, 'post-def');

  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 200 with upload url+id for trial tier (Claude Discretion D-06)', async () => {
  resetAdminForTest();
  resetMuxForTest();
  lastMuxCallArgs = null;
  muxShouldThrow = false;
  setAdminForTest(makeMockAdmin({ userId: 'user-3', tierLabel: 'trial' }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid-jwt', body: { post_id: 'post-trial' } });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertExists(lastMuxCallArgs);
  const passthrough = JSON.parse(lastMuxCallArgs!.new_asset_settings.passthrough);
  assertEquals(passthrough.user_id, 'user-3');
  assertEquals(passthrough.post_id, 'post-trial');

  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 500 mux_error when Mux SDK throws', async () => {
  resetAdminForTest();
  resetMuxForTest();
  muxShouldThrow = true;
  setAdminForTest(makeMockAdmin({ userId: 'user-1', tierLabel: 'pro' }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid-jwt', body: { post_id: 'post-1' } });
  const res = await handler(req);

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, 'mux_error');

  muxShouldThrow = false;
  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 400 invalid_post_id when post_id is missing', async () => {
  resetAdminForTest();
  resetMuxForTest();
  setAdminForTest(makeMockAdmin({ userId: 'user-1', tierLabel: 'pro' }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid-jwt', body: {} });
  const res = await handler(req);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'invalid_post_id');

  resetAdminForTest();
  resetMuxForTest();
});

Deno.test('returns 405 for non-POST methods', async () => {
  const req = makeRequest({ method: 'GET', bearer: 'valid-jwt' });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test('OPTIONS preflight returns 204 with CORS headers', async () => {
  const req = makeRequest({ method: 'OPTIONS' });
  const res = await handler(req);
  assertEquals(res.status, 204);
  assertExists(res.headers.get('Access-Control-Allow-Origin'));
});
