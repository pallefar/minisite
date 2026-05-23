/**
 * Deno tests for mux-webhook Edge Function.
 *
 * Per reference_deno_test_top_level_serve_trap: index.ts uses import.meta.main
 * + denoGlobal?.serve guard so importing this module does NOT spawn a real server.
 *
 * Run: $HOME/.deno/bin/deno test --no-check supabase/functions/mux-webhook/index.test.ts
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  handler,
  setAdminForTest,
  resetAdminForTest,
  setVerifyForTest,
  resetVerifyForTest,
} from './index.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Track calls to admin.from('community_posts').update().eq()
 */
interface UpdateCall {
  payload: Record<string, unknown>;
  filterCol: string;
  filterVal: string;
}

let updateCalls: UpdateCall[] = [];

function makeMockAdmin(): unknown {
  return {
    from: (table: string) => {
      if (table === 'community_posts') {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: (col: string, val: string) => {
              updateCalls.push({ payload, filterCol: col, filterVal: val });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
    },
  };
}

/** A verifySignature stub that succeeds (returns void) */
function verifyOk(_body: string, _headers: Headers, _secret: string): void {
  // success — no-op
}

/** A verifySignature stub that throws (simulates invalid signature) */
function verifyFail(_body: string, _headers: Headers, _secret: string): void {
  throw new Error('Signature mismatch');
}

function makeRequest(opts: {
  method?: string;
  body?: unknown;
}): Request {
  const { method = 'POST', body } = opts;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'mux-signature': 't=1234567890,v1=abc123',
  };
  return new Request('https://example.supabase.co/functions/v1/mux-webhook', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeAssetReadyEvent(opts: {
  postId?: string;
  playbackId?: string;
  missingPassthrough?: boolean;
  malformedPassthrough?: boolean;
}): unknown {
  const {
    postId = 'post-123',
    playbackId = 'playback-abc',
    missingPassthrough = false,
    malformedPassthrough = false,
  } = opts;
  return {
    type: 'video.asset.ready',
    data: {
      id: 'asset-xyz',
      playback_ids: playbackId ? [{ id: playbackId, policy: 'public' }] : [],
      passthrough: missingPassthrough
        ? undefined
        : malformedPassthrough
        ? 'not-valid-json'
        : JSON.stringify({ user_id: 'user-1', post_id: postId }),
    },
  };
}

function makeAssetErroredEvent(opts: { postId?: string }): unknown {
  const { postId = 'post-456' } = opts;
  return {
    type: 'video.asset.errored',
    data: {
      id: 'asset-err',
      passthrough: JSON.stringify({ user_id: 'user-2', post_id: postId }),
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

Deno.test('returns 401 when Mux-Signature is invalid (verifySignature throws)', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyFail); // throws → 401

  const req = makeRequest({ body: makeAssetReadyEvent({}) });
  const res = await handler(req);

  assertEquals(res.status, 401);
  assertEquals(await res.text(), 'Unauthorized');
  assertEquals(updateCalls.length, 0); // no DB call on bad signature

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('handles video.asset.ready: updates video_status=ready + mux_playback_id WHERE id=passthrough.post_id', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const POST_ID = 'post-aaa-111';
  const PLAYBACK_ID = 'playback-bbb-222';
  const req = makeRequest({
    body: makeAssetReadyEvent({ postId: POST_ID, playbackId: PLAYBACK_ID }),
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(updateCalls.length, 1);

  const call = updateCalls[0];
  assertExists(call);

  // Assert UPDATE payload
  assertEquals(call.payload.video_status, 'ready');
  assertEquals(call.payload.mux_playback_id, PLAYBACK_ID);

  // Assert filter is eq('id', passthrough.post_id) — NOT eq('mux_upload_id', ...)
  assertEquals(call.filterCol, 'id');
  assertEquals(call.filterVal, POST_ID);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('handles video.asset.errored: updates video_status=rejected WHERE id=passthrough.post_id', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const POST_ID = 'post-err-999';
  const req = makeRequest({ body: makeAssetErroredEvent({ postId: POST_ID }) });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(updateCalls.length, 1);

  const call = updateCalls[0];
  assertExists(call);

  // Assert UPDATE payload
  assertEquals(call.payload.video_status, 'rejected');
  // errored: no playback ID set — payload should only have video_status
  assertEquals(Object.keys(call.payload).includes('mux_playback_id'), false);

  // Assert filter is eq('id', passthrough.post_id)
  assertEquals(call.filterCol, 'id');
  assertEquals(call.filterVal, POST_ID);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('handles missing passthrough: returns 200 ok WITHOUT DB update', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const req = makeRequest({ body: makeAssetReadyEvent({ missingPassthrough: true }) });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  // No DB call — passthrough missing → skip UPDATE (no retry loop)
  assertEquals(updateCalls.length, 0);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('handles malformed passthrough JSON: returns 200 ok WITHOUT DB update', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const req = makeRequest({ body: makeAssetReadyEvent({ malformedPassthrough: true }) });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  // No DB call — malformed passthrough → skip UPDATE
  assertEquals(updateCalls.length, 0);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('handles unknown event type: returns 200 ok WITHOUT DB update', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const req = makeRequest({
    body: {
      type: 'video.asset.created', // unknown event type
      data: {
        id: 'asset-new',
        passthrough: JSON.stringify({ user_id: 'user-1', post_id: 'post-new' }),
      },
    },
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  // No DB call for unknown event types
  assertEquals(updateCalls.length, 0);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('returns 405 for non-POST methods', async () => {
  const req = new Request('https://example.supabase.co/functions/v1/mux-webhook', {
    method: 'GET',
  });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test('raw body text is read BEFORE verifySignature (behavioral: body passed as string)', async () => {
  // This test verifies the raw-body-first pattern by checking that
  // verifySignature receives a string (raw text body), not an object.
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());

  let capturedBody: unknown = undefined;
  setVerifyForTest((body: string, _headers: Headers, _secret: string) => {
    capturedBody = body;
    // success — no-op
  });

  const req = makeRequest({ body: makeAssetReadyEvent({}) });
  await handler(req);

  // Body passed to verifySignature must be a string (raw text), not a parsed object
  assertEquals(typeof capturedBody, 'string');

  resetAdminForTest();
  resetVerifyForTest();
});
