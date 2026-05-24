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
 * Track calls to admin.from(<table>).update().eq()
 *
 * Plan 46-05: separate tracking for community_posts vs course_lessons so
 * regression tests assert that course-lesson webhooks do NOT touch
 * community_posts and vice versa.
 */
interface UpdateCall {
  table: string;
  payload: Record<string, unknown>;
  filterCol: string;
  filterVal: string;
}

let updateCalls: UpdateCall[] = [];

function makeMockAdmin(): unknown {
  const mkTableStub = (table: string) => ({
    update: (payload: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        updateCalls.push({ table, payload, filterCol: col, filterVal: val });
        return Promise.resolve({ error: null });
      },
    }),
  });
  return {
    from: (table: string) => {
      if (table === 'community_posts') return mkTableStub('community_posts');
      if (table === 'course_lessons') return mkTableStub('course_lessons');
      return {};
    },
  };
}

function communityUpdateCalls(): UpdateCall[] {
  return updateCalls.filter((c) => c.table === 'community_posts');
}
function courseLessonUpdateCalls(): UpdateCall[] {
  return updateCalls.filter((c) => c.table === 'course_lessons');
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

// ---------------------------------------------------------------------------
// Plan 46-05: course-lesson dispatch tests (passthrough.kind === 'course-lesson')
// ---------------------------------------------------------------------------

function makeCourseLessonReadyEvent(opts: {
  lessonId?: string;
  courseId?: string;
  assetId?: string;
  playbackId?: string;
  missingLessonId?: boolean;
}): unknown {
  const {
    lessonId = 'lesson-1',
    courseId = 'course-1',
    assetId = 'asset-cl-1',
    playbackId = 'playback-cl-1',
    missingLessonId = false,
  } = opts;
  return {
    type: 'video.asset.ready',
    data: {
      id: assetId,
      playback_ids: [{ id: playbackId, policy: 'signed' }],
      passthrough: JSON.stringify(
        missingLessonId
          ? { kind: 'course-lesson', course_id: courseId }
          : { kind: 'course-lesson', lesson_id: lessonId, course_id: courseId },
      ),
    },
  };
}

Deno.test('course-lesson video.asset.ready → UPDATE course_lessons (mux_playback_id + mux_status=ready)', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const LESSON_ID = 'lesson-aaa';
  const ASSET_ID = 'asset-aaa';
  const PLAYBACK_ID = 'playback-aaa';
  const req = makeRequest({
    body: makeCourseLessonReadyEvent({ lessonId: LESSON_ID, assetId: ASSET_ID, playbackId: PLAYBACK_ID }),
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  // Must hit course_lessons, NOT community_posts
  assertEquals(communityUpdateCalls().length, 0);
  assertEquals(courseLessonUpdateCalls().length, 1);

  const call = courseLessonUpdateCalls()[0]!;
  assertEquals(call.payload.mux_asset_id, ASSET_ID);
  assertEquals(call.payload.mux_playback_id, PLAYBACK_ID);
  assertEquals(call.payload.mux_status, 'ready');
  assertEquals(call.filterCol, 'id');
  assertEquals(call.filterVal, LESSON_ID);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('course-lesson video.asset.errored → UPDATE course_lessons (mux_status=rejected)', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const LESSON_ID = 'lesson-err';
  const req = makeRequest({
    body: {
      type: 'video.asset.errored',
      data: {
        id: 'asset-err',
        passthrough: JSON.stringify({
          kind: 'course-lesson',
          lesson_id: LESSON_ID,
          course_id: 'course-err',
        }),
      },
    },
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(communityUpdateCalls().length, 0);
  assertEquals(courseLessonUpdateCalls().length, 1);

  const call = courseLessonUpdateCalls()[0]!;
  assertEquals(call.payload.mux_status, 'rejected');
  // errored event should NOT include playback_id (asset never became playable)
  assertEquals(Object.keys(call.payload).includes('mux_playback_id'), false);
  assertEquals(call.filterCol, 'id');
  assertEquals(call.filterVal, LESSON_ID);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('course-lesson video.upload.asset_created → UPDATE course_lessons (mux_asset_id + mux_status=processing)', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const LESSON_ID = 'lesson-proc';
  const ASSET_ID = 'asset-proc';
  const req = makeRequest({
    body: {
      type: 'video.upload.asset_created',
      data: {
        id: ASSET_ID,
        passthrough: JSON.stringify({
          kind: 'course-lesson',
          lesson_id: LESSON_ID,
          course_id: 'course-proc',
        }),
      },
    },
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(communityUpdateCalls().length, 0);
  assertEquals(courseLessonUpdateCalls().length, 1);

  const call = courseLessonUpdateCalls()[0]!;
  assertEquals(call.payload.mux_asset_id, ASSET_ID);
  assertEquals(call.payload.mux_status, 'processing');
  assertEquals(call.filterCol, 'id');
  assertEquals(call.filterVal, LESSON_ID);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('course-lesson missing lesson_id → 200 ok + NO DB write (warn only)', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const req = makeRequest({
    body: makeCourseLessonReadyEvent({ missingLessonId: true }),
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  // No DB writes anywhere — neither community_posts nor course_lessons
  assertEquals(updateCalls.length, 0);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('REGRESSION: community-post passthrough (no kind) still routes to community_posts only', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const req = makeRequest({
    body: makeAssetReadyEvent({ postId: 'post-regression', playbackId: 'pl-regression' }),
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(communityUpdateCalls().length, 1);
  assertEquals(courseLessonUpdateCalls().length, 0);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('course-lesson does NOT touch community_posts even on asset.ready', async () => {
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const req = makeRequest({
    body: makeCourseLessonReadyEvent({ lessonId: 'lesson-isolation' }),
  });
  await handler(req);

  assertEquals(communityUpdateCalls().length, 0);
  assertEquals(courseLessonUpdateCalls().length, 1);

  resetAdminForTest();
  resetVerifyForTest();
});

Deno.test('NO video.view handler exists (Mux does not emit this event — RESEARCH Pitfall 1)', async () => {
  // If video.view ever lands as an event, it should be treated as "unknown" — return 200 + no DB write.
  resetAdminForTest();
  resetVerifyForTest();
  updateCalls = [];
  setAdminForTest(makeMockAdmin());
  setVerifyForTest(verifyOk);

  const req = makeRequest({
    body: {
      type: 'video.view',
      data: {
        id: 'asset-view',
        passthrough: JSON.stringify({
          kind: 'course-lesson',
          lesson_id: 'lesson-view',
          course_id: 'course-view',
        }),
      },
    },
  });
  const res = await handler(req);

  // No-op for course-lesson + unhandled event type
  assertEquals(res.status, 200);
  assertEquals(updateCalls.length, 0);

  resetAdminForTest();
  resetVerifyForTest();
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
