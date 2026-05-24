/**
 * Phase 46 Plan 08 — Lesson-progress sync helpers (client-side anti-skip).
 *
 * Three primitives consumed by LessonPlayerView:
 *
 *   1. createProgressSyncer({ lessonId, supabaseClient })
 *        Tracks `maxReached` across an onTimeUpdate firehose, debounces RPC
 *        writes to once per 15 s, and exposes a `flush()` for unmount /
 *        tab-blur. Uses `Math.max` so a scrub-back NEVER lowers the watch
 *        ceiling (mirrors the server-side GREATEST(...) in
 *        public.update_lesson_position SECDEF RPC — D-09 / D-12 / Plan 46-01).
 *
 *   2. sendProgressBeacon({ lessonId, lastPosition, maxReached, accessToken,
 *                          supabaseUrl })
 *        Wraps navigator.sendBeacon for the tab-close / visibilitychange
 *        race. sendBeacon sends `Content-Type: text/plain;charset=UTF-8`
 *        and CANNOT set the Authorization header — `access_token` rides
 *        in the body and the Edge Fn (`lesson-progress-beacon`, Plan 46-06)
 *        uses `req.text()` + `JSON.parse()`. See memory
 *        reference_mux_video_view_event_for_antiskip + RESEARCH Pitfall 3.
 *
 *   3. isLessonComplete(progress, lesson)
 *        Client-side mirror of the server-side ≥95% gate in
 *        public.complete_lesson RPC (D-10 / D-12). Enables/disables the
 *        Mark Complete CTA. The server re-checks against
 *        `lesson_progress.max_position_reached_seconds` from DB so a
 *        bypassed/spoofed client gate is harmless (T-46-02 accept-soft).
 *
 * Anti-skip note (per memory reference_mux_video_view_event_for_antiskip):
 *   The Mux `video.view` webhook DOES NOT exist. Anti-skip is entirely
 *   client-side accumulate → debounced DB write → server complete_lesson
 *   double-check from DB. This file owns the client half.
 */
import type { CourseLesson, LessonProgress } from '@/lib/course/course-types';

// ─── createProgressSyncer ─────────────────────────────────────────────────────

/**
 * Debounce window for `update_lesson_position` RPC writes.
 *
 * 15 s balances "don't lose more than 15 s on a tab-close" against
 * "don't hammer the RPC at 60 Hz from onTimeUpdate". The sendBeacon path
 * catches the trailing-edge loss within the debounce window.
 */
export const SYNC_DEBOUNCE_MS = 15_000;

/**
 * Minimum supabase-js surface area the syncer needs. Accepting the narrow
 * shape (rather than the full SupabaseClient) keeps the unit test stub
 * trivial AND lets non-Supabase callers (future Web Worker variants) reuse
 * the same syncer with a tiny adapter.
 */
export interface ProgressRpcClient {
  rpc(
    fn: 'update_lesson_position',
    args: {
      p_lesson_id: string;
      p_last_position_seconds: number;
      p_max_position_reached_seconds: number;
    },
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface CreateProgressSyncerOpts {
  lessonId: string;
  supabaseClient: ProgressRpcClient;
}

export interface ProgressSyncer {
  /** Call from MuxPlayer.onTimeUpdate (or any time-tick source). */
  onTimeUpdate(currentTime: number): void;
  /** Force-flush any pending RPC. Safe to call repeatedly (no-op when clean). */
  flush(): Promise<void>;
  /** Server-known max watch position (for UI gating + beacon body). */
  getMaxReached(): number;
  /** Last received currentTime (for beacon body — distinct from max). */
  getLastPosition(): number;
}

export function createProgressSyncer(opts: CreateProgressSyncerOpts): ProgressSyncer {
  const { lessonId, supabaseClient } = opts;

  let maxReached = 0;
  let lastPosition = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * `dirty` tracks whether onTimeUpdate has been called since the last
   * flush. Without it, `flush()` would fire spurious RPC writes on
   * unmount when the user never started playback.
   */
  let dirty = false;

  async function flush(): Promise<void> {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (!dirty) return;
    dirty = false;
    // We swallow rpc errors here: the next onTimeUpdate will schedule
    // another flush, and the tab-close sendBeacon is the final safety net.
    // Surfacing errors at this layer would couple the syncer to toast UI.
    await supabaseClient.rpc('update_lesson_position', {
      p_lesson_id: lessonId,
      p_last_position_seconds: Math.round(lastPosition),
      p_max_position_reached_seconds: Math.round(maxReached),
    });
  }

  function onTimeUpdate(currentTime: number): void {
    if (!Number.isFinite(currentTime) || currentTime < 0) return;
    maxReached = Math.max(maxReached, currentTime);
    lastPosition = currentTime;
    dirty = true;

    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void flush();
    }, SYNC_DEBOUNCE_MS);
  }

  return {
    onTimeUpdate,
    flush,
    getMaxReached: () => maxReached,
    getLastPosition: () => lastPosition,
  };
}

// ─── sendProgressBeacon ───────────────────────────────────────────────────────

export interface SendProgressBeaconOpts {
  lessonId: string;
  lastPosition: number;
  maxReached: number;
  /**
   * User JWT — required because navigator.sendBeacon cannot set the
   * Authorization header. The lesson-progress-beacon Edge Fn validates
   * the token via admin.auth.getUser(token).
   */
  accessToken: string;
  /**
   * Origin for the Edge Fn endpoint. In production read from
   * `import.meta.env.VITE_SUPABASE_URL`; injected here as a parameter to
   * keep this module env-free + trivially testable.
   */
  supabaseUrl: string;
}

/**
 * Fire a best-effort tab-close progress save. Returns the boolean from
 * navigator.sendBeacon (true = browser accepted the queued send; false =
 * queue full / quota exceeded / browser declined).
 *
 * Pre-condition: `accessToken` MUST be non-empty — without it the Fn
 * cannot validate the JWT and the write is silently dropped (sendBeacon
 * cannot read responses). Returning false here surfaces that case to the
 * caller without making the network call.
 */
export function sendProgressBeacon(opts: SendProgressBeaconOpts): boolean {
  const { lessonId, lastPosition, maxReached, accessToken, supabaseUrl } = opts;

  // sendBeacon cannot read responses → unsigned beacons are dropped server-side
  // with zero feedback. Short-circuit so callers can distinguish "queued" from
  // "no auth available" (e.g. anonymous user, expired session at unload time).
  if (!accessToken) return false;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return false;
  }

  const body = JSON.stringify({
    lesson_id: lessonId,
    last_position_seconds: Math.round(lastPosition),
    max_position_reached_seconds: Math.round(maxReached),
    access_token: accessToken,
  });

  // Endpoint path matches supabase/functions/lesson-progress-beacon/index.ts
  // (Plan 46-06). text/plain content-type is the sendBeacon default for
  // string bodies — the Fn uses req.text() + JSON.parse() per Pitfall 3.
  return navigator.sendBeacon(
    `${supabaseUrl}/functions/v1/lesson-progress-beacon`,
    body,
  );
}

// ─── isLessonComplete ─────────────────────────────────────────────────────────

/**
 * Client-side mirror of the server-side ≥95% gate (Plan 46-01 D-10 / D-12).
 *
 * Returns true iff:
 *   - lesson.duration_seconds is a positive number (zero-division + null guard), AND
 *   - progress is non-null, AND
 *   - max_position_reached_seconds / duration_seconds >= 0.95.
 *
 * UI usage: enable/disable the "Mark Complete" button. The server
 * complete_lesson RPC RE-CHECKS the ratio against the DB-stored
 * max_position so a spoofed client gate is harmless — the worst case is
 * a user sees an enabled button that fails on click (T-46-02).
 *
 * NOTE: courses with `enforce_completion=false` bypass the server gate
 * (D-12); this client mirror DOES NOT read enforce_completion (the lesson
 * type only carries `is_required`). The conservative default — render the
 * button enabled at ≥95% — matches the strict server-mode UX exactly and
 * is acceptable for the bypass-mode case (the server will simply mark
 * complete unconditionally).
 */
export function isLessonComplete(
  progress: LessonProgress | null,
  lesson: CourseLesson,
): boolean {
  if (!progress) return false;
  const duration = lesson.duration_seconds;
  if (duration === null || duration <= 0) return false;
  return progress.max_position_reached_seconds / duration >= 0.95;
}
