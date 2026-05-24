/**
 * EVENT-05 mux-webhook event-recording branch tests — Plan 47-09 GREEN.
 *
 * passthrough shape: { kind: 'event-recording', event_id, user_id }
 *
 * Branch behaviour (only on video.asset.ready):
 *   - Read events row (id, title, attach_to_module_id).
 *   - If attach_to_module_id NOT NULL → INSERT into course_lessons with
 *     is_required=false, is_free_preview=false, computed next order_index.
 *   - Else → UPDATE events SET recording_mux_asset_id, recording_playback_id.
 *   - Missing event_id → log + 200 (no retry loop).
 *   - Event row not found → log + 200 (no retry).
 *
 * Per reference_deno_test_top_level_serve_trap: index.ts uses import.meta.main
 * + denoGlobal?.serve guard so importing this module does NOT spawn a real server.
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-all \
 *      supabase/functions/mux-webhook/event-recording.test.ts
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
// Mock helpers — event-recording branch needs admin.from('events').select +
// admin.from('course_lessons').select + admin.from('course_lessons').insert +
// admin.from('events').update.
// ---------------------------------------------------------------------------

interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
}
interface UpdateCall {
  table: string;
  payload: Record<string, unknown>;
  filterCol: string;
  filterVal: string;
}

let insertCalls: InsertCall[] = [];
let updateCalls: UpdateCall[] = [];

function reset(): void {
  insertCalls = [];
  updateCalls = [];
  resetAdminForTest();
  resetVerifyForTest();
}

function verifyOk(_body: string, _headers: Headers, _secret: string): void {}

interface EventRow {
  id: string;
  title: string;
  attach_to_module_id: string | null;
}

function makeMockAdmin(opts: {
  event: EventRow | null;
  maxOrderIndex?: number | null; // for course_lessons.select(order_index)
}): unknown {
  const { event, maxOrderIndex = null } = opts;

  const eventsStub = {
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => ({
        maybeSingle: () => Promise.resolve({ data: event, error: null }),
      }),
    }),
    update: (payload: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        updateCalls.push({ table: 'events', payload, filterCol: col, filterVal: val });
        return Promise.resolve({ error: null });
      },
    }),
  };

  const courseLessonsStub = {
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => ({
        order: (_orderCol: string, _opts: unknown) => ({
          limit: (_n: number) => ({
            maybeSingle: () =>
              Promise.resolve({
                data: maxOrderIndex === null ? null : { order_index: maxOrderIndex },
                error: null,
              }),
          }),
        }),
      }),
    }),
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push({ table: 'course_lessons', payload });
      return Promise.resolve({ error: null });
    },
    update: (payload: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        updateCalls.push({ table: 'course_lessons', payload, filterCol: col, filterVal: val });
        return Promise.resolve({ error: null });
      },
    }),
  };

  return {
    from: (table: string) => {
      if (table === 'events') return eventsStub;
      if (table === 'course_lessons') return courseLessonsStub;
      return {};
    },
  };
}

function makeReq(body: unknown): Request {
  return new Request('https://example.supabase.co/functions/v1/mux-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'mux-signature': 't=1234567890,v1=abc123',
    },
    body: JSON.stringify(body),
  });
}

function makeEventRecordingEvent(opts: {
  eventId?: string | null; // null → omit event_id field
  assetId?: string;
  playbackId?: string | null;
  duration?: number;
  type?: string;
}): unknown {
  const {
    eventId = 'event-1',
    assetId = 'asset-rec-1',
    playbackId = 'playback-rec-1',
    duration = 1800,
    type = 'video.asset.ready',
  } = opts;
  const passthrough =
    eventId === null
      ? { kind: 'event-recording' }
      : { kind: 'event-recording', event_id: eventId, user_id: 'admin-1' };
  return {
    type,
    data: {
      id: assetId,
      duration,
      playback_ids: playbackId ? [{ id: playbackId, policy: 'public' }] : [],
      passthrough: JSON.stringify(passthrough),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('event-recording: attach_to_module_id NOT NULL → INSERT course_lessons row', async () => {
  reset();
  setAdminForTest(
    makeMockAdmin({
      event: { id: 'event-1', title: 'Group Coaching Q&A', attach_to_module_id: 'module-99' },
      maxOrderIndex: 4,
    }),
  );
  setVerifyForTest(verifyOk);

  const req = makeReq(
    makeEventRecordingEvent({ eventId: 'event-1', assetId: 'asset-A', playbackId: 'playback-A', duration: 2400 }),
  );
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');

  // INSERT into course_lessons (NOT update events.recording_*)
  assertEquals(insertCalls.length, 1);
  const ins = insertCalls[0]!;
  assertEquals(ins.table, 'course_lessons');
  assertEquals(ins.payload.module_id, 'module-99');
  assertEquals(ins.payload.title, 'Group Coaching Q&A recording');
  assertEquals(ins.payload.mux_asset_id, 'asset-A');
  assertEquals(ins.payload.mux_playback_id, 'playback-A');
  assertEquals(ins.payload.duration_seconds, 2400);
  assertEquals(ins.payload.is_required, false);
  assertEquals(ins.payload.is_free_preview, false);
  assertEquals(ins.payload.order_index, 5); // 4 + 1

  // events table NOT updated in this branch
  const eventsUpdates = updateCalls.filter((c) => c.table === 'events');
  assertEquals(eventsUpdates.length, 0);

  reset();
});

Deno.test('event-recording: attach_to_module_id NOT NULL + no prior lessons → order_index=1', async () => {
  reset();
  setAdminForTest(
    makeMockAdmin({
      event: { id: 'event-1', title: 'Webinar', attach_to_module_id: 'module-empty' },
      maxOrderIndex: null, // no rows for this module yet
    }),
  );
  setVerifyForTest(verifyOk);

  const req = makeReq(makeEventRecordingEvent({ eventId: 'event-1' }));
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(insertCalls.length, 1);
  assertEquals(insertCalls[0]!.payload.order_index, 1); // 0 + 1

  reset();
});

Deno.test('event-recording: attach_to_module_id NULL → UPDATE events.recording_* inline', async () => {
  reset();
  setAdminForTest(
    makeMockAdmin({
      event: { id: 'event-2', title: 'Standalone Event', attach_to_module_id: null },
    }),
  );
  setVerifyForTest(verifyOk);

  const req = makeReq(
    makeEventRecordingEvent({ eventId: 'event-2', assetId: 'asset-B', playbackId: 'playback-B' }),
  );
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');

  // course_lessons NOT inserted
  assertEquals(insertCalls.length, 0);

  // events.recording_* updated
  const eventsUpdates = updateCalls.filter((c) => c.table === 'events');
  assertEquals(eventsUpdates.length, 1);
  const upd = eventsUpdates[0]!;
  assertEquals(upd.payload.recording_mux_asset_id, 'asset-B');
  assertEquals(upd.payload.recording_playback_id, 'playback-B');
  assertEquals(upd.filterCol, 'id');
  assertEquals(upd.filterVal, 'event-2');

  reset();
});

Deno.test('event-recording: missing event_id in passthrough → 200 + NO DB writes', async () => {
  reset();
  setAdminForTest(
    makeMockAdmin({
      event: { id: 'event-x', title: 'x', attach_to_module_id: null },
    }),
  );
  setVerifyForTest(verifyOk);

  const req = makeReq(makeEventRecordingEvent({ eventId: null }));
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(insertCalls.length, 0);
  assertEquals(updateCalls.length, 0);

  reset();
});

Deno.test('event-recording: event row not found → 200 + NO DB writes (no retry)', async () => {
  reset();
  setAdminForTest(makeMockAdmin({ event: null }));
  setVerifyForTest(verifyOk);

  const req = makeReq(makeEventRecordingEvent({ eventId: 'event-missing' }));
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(insertCalls.length, 0);
  assertEquals(updateCalls.length, 0);

  reset();
});

Deno.test('event-recording: non-asset.ready event types are not handled by event-recording branch', async () => {
  // video.asset.errored, video.upload.asset_created etc. with kind=event-recording
  // should fall through (return 200 ok) WITHOUT DB writes — branch only acts on
  // video.asset.ready per RESEARCH Example 6.
  reset();
  setAdminForTest(
    makeMockAdmin({
      event: { id: 'event-1', title: 't', attach_to_module_id: 'module-1' },
      maxOrderIndex: 0,
    }),
  );
  setVerifyForTest(verifyOk);

  const req = makeReq(
    makeEventRecordingEvent({ eventId: 'event-1', type: 'video.asset.errored' }),
  );
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(insertCalls.length, 0);
  assertEquals(updateCalls.length, 0);

  reset();
});

Deno.test('REGRESSION: NO video.view handler (Mux does not emit this event)', async () => {
  reset();
  setAdminForTest(
    makeMockAdmin({
      event: { id: 'event-1', title: 't', attach_to_module_id: null },
    }),
  );
  setVerifyForTest(verifyOk);

  const req = makeReq(makeEventRecordingEvent({ eventId: 'event-1', type: 'video.view' }));
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(insertCalls.length, 0);
  assertEquals(updateCalls.length, 0);

  reset();
});

Deno.test('event-recording: playback_ids empty → mux_playback_id null in insert', async () => {
  reset();
  setAdminForTest(
    makeMockAdmin({
      event: { id: 'event-1', title: 'Title', attach_to_module_id: 'module-1' },
      maxOrderIndex: 0,
    }),
  );
  setVerifyForTest(verifyOk);

  const req = makeReq(makeEventRecordingEvent({ eventId: 'event-1', playbackId: null }));
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(insertCalls.length, 1);
  assertEquals(insertCalls[0]!.payload.mux_playback_id, null);

  reset();
});

Deno.test('event-recording: duration coerced via Math.round (fractional seconds)', async () => {
  reset();
  setAdminForTest(
    makeMockAdmin({
      event: { id: 'event-1', title: 'Title', attach_to_module_id: 'module-1' },
      maxOrderIndex: 0,
    }),
  );
  setVerifyForTest(verifyOk);

  const req = makeReq(makeEventRecordingEvent({ eventId: 'event-1', duration: 1799.7 }));
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(insertCalls.length, 1);
  assertEquals(insertCalls[0]!.payload.duration_seconds, 1800);

  reset();
});

Deno.test('event-recording: existing community-post passthrough is UNAFFECTED by event branch', async () => {
  // A community-post webhook event should never trip the event-recording branch.
  // We don't mock community_posts here; we just confirm event-recording stubs
  // are not invoked. The existing community-post path will hit an empty stub
  // (returning {}) — that's fine for this isolation test because we only
  // assert insertCalls/updateCalls remain empty for the event-recording side.
  reset();
  setAdminForTest({
    from: (_t: string) => ({
      update: (_p: unknown) => ({ eq: (_c: string, _v: string) => Promise.resolve({ error: null }) }),
    }),
  });
  setVerifyForTest(verifyOk);

  const req = makeReq({
    type: 'video.asset.ready',
    data: {
      id: 'asset-cp',
      playback_ids: [{ id: 'pl-cp', policy: 'public' }],
      passthrough: JSON.stringify({ user_id: 'u-1', post_id: 'post-1' }),
    },
  });
  const res = await handler(req);

  assertEquals(res.status, 200);
  // event-recording branch was not entered → its tracking arrays remain empty
  assertEquals(insertCalls.length, 0);

  reset();
});
