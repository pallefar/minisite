/**
 * Phase 46 Plan 08 — LessonPlayerView (stub placeholder).
 *
 * Replaced in-place by Task 3 of this same plan. The stub exists so
 * ClassroomTabShell + CourseDetailView typecheck during Task 2 commit
 * (single-wave plan; same-wave plans cannot import a not-yet-shipped file).
 *
 * Final implementation (Task 3) wires:
 *   - @mux/mux-player-react/lazy with signed tokens from mux-sign-playback
 *   - onTimeUpdate accumulate + 15s debounced update_lesson_position RPC
 *   - beforeunload + visibilitychange → navigator.sendBeacon
 *   - Mark Complete (≥95% gate) + course-complete certificate trigger
 *   - LessonResourceList (tier-gated downloads)
 */
import type { TierLabel } from '@/lib/community/tier-gate';

export interface LessonPlayerViewProps {
  lessonId: string;
  courseId: string;
  currentTier: TierLabel;
}

export function LessonPlayerView(_props: LessonPlayerViewProps) {
  return (
    <div className="p-4" role="status" aria-live="polite">
      <p className="text-[14px] text-[var(--color-text-secondary)]">
        Loading lesson player…
      </p>
    </div>
  );
}

export default LessonPlayerView;
