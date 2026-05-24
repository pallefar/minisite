/**
 * Deno tests for mux-sign-playback Edge Function (Phase 46 Plan 04).
 *
 * Per reference_deno_test_top_level_serve_trap: index.ts uses the
 * import.meta.main + denoGlobal?.serve guard so importing this module from
 * test code does NOT spawn a real HTTP server.
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-env --allow-net \
 *      supabase/functions/mux-sign-playback/
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  handler,
  setAdminForTest,
  resetAdminForTest,
  setMuxForTest,
  resetMuxForTest,
} from './index.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockLesson {
  id: string;
  mux_playback_id: string | null;
  is_free_preview: boolean;
  mux_status: string | null;
}

interface MockAdminOpts {
  userId?: string | null; // null → admin.auth.getUser returns null user
  lessons?: Record<string, MockLesson | null>;
  hasActive?: boolean; // tier_effective.has_active for the user
  tierRowMissing?: boolean; // tier_effective row absent → has_active resolves to false
}

function makeMockAdmin(opts: MockAdminOpts): unknown {
  const {
    userId = 'user-1',
    lessons = {},
    hasActive = true,
    tierRowMissing = false,
  } = opts;

  return {
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
      if (table === 'course_lessons') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => {
                const row = lessons[val] ?? null;
                return Promise.resolve({ data: row, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'tier_effective') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () => {
                if (tierRowMissing) {
                  return Promise.resolve({ data: null, error: null });
                }
                return Promise.resolve({
                  data: { has_active: hasActive },
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
}

interface MuxSignCall {
  playbackId: string;
  options: {
    type: string;
    expiration?: string;
    keyId?: string;
    keySecret?: string;
    params?: Record<string, unknown>;
  };
}

let lastSignCalls: MuxSignCall[] = [];
let muxShouldThrow = false;

function makeMockMux(): unknown {
  return {
    jwt: {
      signPlaybackId: (playbackId: string, options: MuxSignCall['options']) => {
        lastSignCalls.push({ playbackId, options });
        if (muxShouldThrow) return Promise.reject(new Error('Mux signing error'));
        return Promise.resolve(`test.jwt.${options.type}.${playbackId}`);
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
  return new Request('https://example.supabase.co/functions/v1/mux-sign-playback', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function setSigningEnv(): void {
  Deno.env.set('MUX_SIGNING_KEY_ID', 'test-key-id-abc');
  Deno.env.set('MUX_SIGNING_KEY_PRIVATE', 'test-key-private-base64-pem');
}

function clearSigningEnv(): void {
  Deno.env.delete('MUX_SIGNING_KEY_ID');
  Deno.env.delete('MUX_SIGNING_KEY_PRIVATE');
}

function resetAll(): void {
  lastSignCalls = [];
  muxShouldThrow = false;
  resetAdminForTest();
  resetMuxForTest();
  clearSigningEnv();
}

// ---------------------------------------------------------------------------
// Test suite (8 cases)
// ---------------------------------------------------------------------------

Deno.test('returns 401 when no Authorization header', async () => {
  resetAll();
  setSigningEnv();
  setAdminForTest(makeMockAdmin({}));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: undefined, body: { lesson_id: 'lesson-1' } });
  const res = await handler(req);

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');

  resetAll();
});

Deno.test('returns 401 when bearer JWT resolves to null user', async () => {
  resetAll();
  setSigningEnv();
  setAdminForTest(makeMockAdmin({ userId: null }));
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'invalid-token', body: { lesson_id: 'lesson-1' } });
  const res = await handler(req);

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');

  resetAll();
});

Deno.test('returns 404 lesson_not_found when lesson row absent', async () => {
  resetAll();
  setSigningEnv();
  setAdminForTest(
    makeMockAdmin({
      userId: 'user-1',
      lessons: { 'lesson-missing': null },
    }),
  );
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid', body: { lesson_id: 'lesson-missing' } });
  const res = await handler(req);

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'lesson_not_found');

  resetAll();
});

Deno.test('returns 404 lesson_not_ready when mux_playback_id is null', async () => {
  resetAll();
  setSigningEnv();
  setAdminForTest(
    makeMockAdmin({
      userId: 'user-1',
      lessons: {
        'lesson-pending': {
          id: 'lesson-pending',
          mux_playback_id: null,
          is_free_preview: false,
          mux_status: 'preparing',
        },
      },
    }),
  );
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid', body: { lesson_id: 'lesson-pending' } });
  const res = await handler(req);

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'lesson_not_ready');

  resetAll();
});

Deno.test('returns 403 tier_required for free user requesting non-preview lesson', async () => {
  resetAll();
  setSigningEnv();
  setAdminForTest(
    makeMockAdmin({
      userId: 'user-free',
      hasActive: false,
      lessons: {
        'lesson-paid': {
          id: 'lesson-paid',
          mux_playback_id: 'mux-pb-paid',
          is_free_preview: false,
          mux_status: 'ready',
        },
      },
    }),
  );
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid', body: { lesson_id: 'lesson-paid' } });
  const res = await handler(req);

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'tier_required');

  resetAll();
});

Deno.test('returns 200 + tokens for free user when lesson.is_free_preview=true (bypass)', async () => {
  resetAll();
  setSigningEnv();
  setAdminForTest(
    makeMockAdmin({
      userId: 'user-free',
      hasActive: false,
      lessons: {
        'lesson-preview': {
          id: 'lesson-preview',
          mux_playback_id: 'mux-pb-preview',
          is_free_preview: true,
          mux_status: 'ready',
        },
      },
    }),
  );
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid', body: { lesson_id: 'lesson-preview' } });
  const res = await handler(req);

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.playback_id, 'mux-pb-preview');
  assertExists(body.playback);
  assertExists(body.thumbnail);

  // Two signPlaybackId calls (video + thumbnail), both with explicit
  // keyId/keySecret + 4h exp; thumbnail with params.time=1.
  assertEquals(lastSignCalls.length, 2);
  const videoCall = lastSignCalls.find((c) => c.options.type === 'video')!;
  const thumbCall = lastSignCalls.find((c) => c.options.type === 'thumbnail')!;
  assertExists(videoCall);
  assertExists(thumbCall);
  assertEquals(videoCall.options.keyId, 'test-key-id-abc');
  assertEquals(videoCall.options.keySecret, 'test-key-private-base64-pem');
  assertEquals(videoCall.options.expiration, '4h');
  assertEquals(thumbCall.options.keyId, 'test-key-id-abc');
  assertEquals(thumbCall.options.keySecret, 'test-key-private-base64-pem');
  assertEquals(thumbCall.options.expiration, '4h');
  assertEquals(thumbCall.options.params?.time, 1);

  resetAll();
});

Deno.test('returns 200 + tokens for pro user requesting non-preview lesson', async () => {
  resetAll();
  setSigningEnv();
  setAdminForTest(
    makeMockAdmin({
      userId: 'user-pro',
      hasActive: true,
      lessons: {
        'lesson-paid': {
          id: 'lesson-paid',
          mux_playback_id: 'mux-pb-paid-xyz',
          is_free_preview: false,
          mux_status: 'ready',
        },
      },
    }),
  );
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid', body: { lesson_id: 'lesson-paid' } });
  const res = await handler(req);

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.playback_id, 'mux-pb-paid-xyz');
  assertExists(body.playback);
  assertExists(body.thumbnail);

  assertEquals(lastSignCalls.length, 2);
  const videoCall = lastSignCalls.find((c) => c.options.type === 'video')!;
  assertEquals(videoCall.playbackId, 'mux-pb-paid-xyz');
  assertEquals(videoCall.options.expiration, '4h');

  resetAll();
});

Deno.test('returns 500 signing_key_missing when MUX_SIGNING_KEY_ID env is empty', async () => {
  resetAll();
  // Intentionally do NOT setSigningEnv(); only set the private half so we
  // exercise the missing-key-id branch.
  Deno.env.set('MUX_SIGNING_KEY_PRIVATE', 'test-private');
  Deno.env.delete('MUX_SIGNING_KEY_ID');

  setAdminForTest(
    makeMockAdmin({
      userId: 'user-pro',
      hasActive: true,
      lessons: {
        'lesson-paid': {
          id: 'lesson-paid',
          mux_playback_id: 'mux-pb-paid',
          is_free_preview: false,
          mux_status: 'ready',
        },
      },
    }),
  );
  setMuxForTest(makeMockMux());

  const req = makeRequest({ bearer: 'valid', body: { lesson_id: 'lesson-paid' } });
  const res = await handler(req);

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, 'signing_key_missing');

  resetAll();
});
