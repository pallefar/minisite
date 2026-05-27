/**
 * Phase 46 Plan 08 — course-progress helpers (TDD RED → GREEN).
 *
 * Covers:
 *   - createProgressSyncer: max tracking (anti-scrub-back), debounced flush,
 *     and RPC dispatch args.
 *   - sendProgressBeacon: navigator.sendBeacon called with text/plain JSON
 *     body containing lesson_id + positions + access_token (T-46-02 trust
 *     boundary — access_token rides in body because sendBeacon cannot set
 *     headers per RESEARCH Pitfall 3).
 *   - isLessonComplete: ≥95% client-side gate (UX mirror of server
 *     complete_lesson RPC ≥95% check from Plan 46-01 D-10/D-12).
 *
 * Anti-skip note: per memory reference_mux_video_view_event_for_antiskip,
 * Mux's video.view webhook DOES NOT exist — the accumulate-then-debounce
 * pattern exercised here is the entire client-side anti-skip story. The
 * server complete_lesson RPC double-checks against duration_seconds in DB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProgressSyncer,
  isLessonComplete,
  sendProgressBeacon,
} from '@/lib/course/course-progress';
import type { CourseLesson, LessonProgress } from '@/lib/course/course-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LESSON_ID = 'lesson-uuid-1';

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function makeStubClient() {
  const calls: RpcCall[] = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: null, error: null };
    }),
  };
  return { client, calls };
}

function makeLesson(overrides: Partial<CourseLesson> = {}): CourseLesson {
  return {
    id: LESSON_ID,
    module_id: 'mod-1',
    title: 'Test Lesson',
    content_md: null,
    order_index: 1,
    mux_asset_id: null,
    mux_playback_id: 'pb-1',
    mux_status: 'ready',
    duration_seconds: 600,
    is_free_preview: false,
    is_required: true,
    captions_enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeProgress(overrides: Partial<LessonProgress> = {}): LessonProgress {
  return {
    user_id: 'user-1',
    lesson_id: LESSON_ID,
    course_id: 'course-1',
    completed_at: null,
    last_position_seconds: 0,
    max_position_reached_seconds: 0,
    last_seen_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── createProgressSyncer ─────────────────────────────────────────────────────

describe('createProgressSyncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('onTimeUpdate tracks max correctly across scrub-back (100 → 50 → 110)', () => {
    const { client } = makeStubClient();
    const syncer = createProgressSyncer({
      lessonId: LESSON_ID,
      supabaseClient: client as unknown as Parameters<typeof createProgressSyncer>[0]['supabaseClient'],
    });

    syncer.onTimeUpdate(100);
    expect(syncer.getMaxReached()).toBe(100);

    // Scrub back to 50 — max must NOT regress.
    syncer.onTimeUpdate(50);
    expect(syncer.getMaxReached()).toBe(100);
    expect(syncer.getLastPosition()).toBe(50);

    // Forward to 110 — max bumps.
    syncer.onTimeUpdate(110);
    expect(syncer.getMaxReached()).toBe(110);
    expect(syncer.getLastPosition()).toBe(110);
  });

  it('flush calls rpc("update_lesson_position") with rounded position + max', async () => {
    const { client, calls } = makeStubClient();
    const syncer = createProgressSyncer({
      lessonId: LESSON_ID,
      supabaseClient: client as unknown as Parameters<typeof createProgressSyncer>[0]['supabaseClient'],
    });

    syncer.onTimeUpdate(42.7);
    syncer.onTimeUpdate(50.4);

    await syncer.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe('update_lesson_position');
    expect(calls[0]?.args).toEqual({
      p_lesson_id: LESSON_ID,
      p_last_position_seconds: 50,
      p_max_position_reached_seconds: 50,
    });
  });

  it('debounce: rapid onTimeUpdate calls within 15s do NOT trigger multiple flushes', () => {
    const { client } = makeStubClient();
    const syncer = createProgressSyncer({
      lessonId: LESSON_ID,
      supabaseClient: client as unknown as Parameters<typeof createProgressSyncer>[0]['supabaseClient'],
    });

    // 100 updates in rapid succession (simulated tight onTimeUpdate loop).
    for (let i = 1; i <= 100; i++) {
      syncer.onTimeUpdate(i * 0.1);
    }
    // Advance partway — debounce should not have fired yet.
    vi.advanceTimersByTime(10_000);
    expect(client.rpc).not.toHaveBeenCalled();

    // Advance past the 15s threshold from the LAST onTimeUpdate.
    vi.advanceTimersByTime(6_000);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when no onTimeUpdate has been received', async () => {
    const { client, calls } = makeStubClient();
    const syncer = createProgressSyncer({
      lessonId: LESSON_ID,
      supabaseClient: client as unknown as Parameters<typeof createProgressSyncer>[0]['supabaseClient'],
    });
    await syncer.flush();
    expect(calls).toHaveLength(0);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

// ─── sendProgressBeacon ───────────────────────────────────────────────────────

describe('sendProgressBeacon', () => {
  let beaconSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    beaconSpy = vi.fn(() => true);
    // jsdom doesn't ship sendBeacon; install our stub on the global navigator.
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beaconSpy,
    });
  });

  it('calls navigator.sendBeacon with a text/plain JSON body containing all required fields', () => {
    const ok = sendProgressBeacon({
      lessonId: LESSON_ID,
      lastPosition: 123,
      maxReached: 456,
      accessToken: 'token-abc',
      supabaseUrl: 'https://stub.supabase.co',
    });

    expect(ok).toBe(true);
    expect(beaconSpy).toHaveBeenCalledTimes(1);

    const [url, body] = beaconSpy.mock.calls[0]!;
    expect(url).toBe('https://stub.supabase.co/functions/v1/lesson-progress-beacon');

    expect(typeof body).toBe('string');
    const parsed = JSON.parse(body as string) as Record<string, unknown>;
    expect(parsed).toEqual({
      lesson_id: LESSON_ID,
      last_position_seconds: 123,
      max_position_reached_seconds: 456,
      access_token: 'token-abc',
    });
  });

  it('returns false when navigator.sendBeacon returns false (queue-full / quota)', () => {
    beaconSpy.mockReturnValueOnce(false);
    const ok = sendProgressBeacon({
      lessonId: LESSON_ID,
      lastPosition: 1,
      maxReached: 1,
      accessToken: 'tok',
      supabaseUrl: 'https://stub.supabase.co',
    });
    expect(ok).toBe(false);
  });

  it('returns false when accessToken is empty (cannot authenticate beacon)', () => {
    const ok = sendProgressBeacon({
      lessonId: LESSON_ID,
      lastPosition: 1,
      maxReached: 1,
      accessToken: '',
      supabaseUrl: 'https://stub.supabase.co',
    });
    expect(ok).toBe(false);
    expect(beaconSpy).not.toHaveBeenCalled();
  });

  it('rounds float positions to integers before serialising', () => {
    sendProgressBeacon({
      lessonId: LESSON_ID,
      lastPosition: 42.7,
      maxReached: 99.2,
      accessToken: 'tok',
      supabaseUrl: 'https://stub.supabase.co',
    });
    const body = beaconSpy.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(body) as Record<string, number>;
    expect(parsed.last_position_seconds).toBe(43);
    expect(parsed.max_position_reached_seconds).toBe(99);
  });
});

// ─── isLessonComplete ─────────────────────────────────────────────────────────

describe('isLessonComplete', () => {
  it('returns false when lesson.duration_seconds is null (anti-skip ratio undefined)', () => {
    const lesson = makeLesson({ duration_seconds: null });
    const progress = makeProgress({ max_position_reached_seconds: 1000 });
    expect(isLessonComplete(progress, lesson)).toBe(false);
  });

  it('returns false when lesson.duration_seconds is 0 (zero-division guard)', () => {
    const lesson = makeLesson({ duration_seconds: 0 });
    const progress = makeProgress({ max_position_reached_seconds: 100 });
    expect(isLessonComplete(progress, lesson)).toBe(false);
  });

  it('returns false when progress is null (user has not started watching)', () => {
    const lesson = makeLesson({ duration_seconds: 600 });
    expect(isLessonComplete(null, lesson)).toBe(false);
  });

  it('returns true when ratio === 0.95 (exact threshold boundary)', () => {
    const lesson = makeLesson({ duration_seconds: 600 });
    const progress = makeProgress({ max_position_reached_seconds: 570 }); // 0.95
    expect(isLessonComplete(progress, lesson)).toBe(true);
  });

  it('returns false at ratio 0.94 (just below threshold)', () => {
    const lesson = makeLesson({ duration_seconds: 600 });
    const progress = makeProgress({ max_position_reached_seconds: 564 }); // 0.94
    expect(isLessonComplete(progress, lesson)).toBe(false);
  });

  it('returns true at ratio 0.99', () => {
    const lesson = makeLesson({ duration_seconds: 1000 });
    const progress = makeProgress({ max_position_reached_seconds: 990 });
    expect(isLessonComplete(progress, lesson)).toBe(true);
  });
});
