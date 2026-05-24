/**
 * Phase 46 Plan 08 — ClassroomTabShell.
 *
 * Consumer-surface tab shell for the Classroom section.
 * Mirrors src/components/community/CommunityTabShell.tsx exactly:
 *   - Zustand-driven navigation (no react-router on the consumer surface
 *     per CLAUDE.md + memory reference_react_router_consumer_admin_split).
 *   - Suspense fallback skeleton with role="status" aria-live="polite".
 *   - Lazy sub-views so the player + media bytes load on demand.
 *
 * Two-level dispatch (Zustand store fields from Task 1):
 *   activeCourseId === null AND activeLessonId === null  → CourseListView
 *   activeCourseId !== null AND activeLessonId === null  → CourseDetailView
 *   activeCourseId !== null AND activeLessonId !== null  → LessonPlayerView
 *
 * Path is `src/components/course/` (singular) so the vite.config.ts chunk
 * rule `if (id.includes('/src/components/course/')) return 'course-player'`
 * routes every file into the `course-player` chunk (≤30 kB gz ceiling).
 *
 * TierLabel resolved asynchronously from the `tier_effective` view since
 * the store's `tier` slice uses billing Tier ('free'|'paid'|'past_due')
 * NOT the community TierLabel ('free'|'trial'|'pro'|'lifetime'). Identical
 * approach to CommunityTabShell.
 */
import { Suspense, lazy, useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import type { TierLabel } from '@/lib/community/tier-gate';
import { readTierLabel } from '@/lib/community/tier-gate';
import { useStore } from '@/lib/store';

// ─── Lazy sub-components (all routed into the course-player chunk) ───────────

const CourseListView = lazy(() =>
  import('./CourseListView').then((m) => ({ default: m.CourseListView })),
);
const CourseDetailView = lazy(() =>
  import('./CourseDetailView').then((m) => ({ default: m.CourseDetailView })),
);
const LessonPlayerView = lazy(() =>
  import('./LessonPlayerView').then((m) => ({ default: m.LessonPlayerView })),
);

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClassroomTabShell() {
  // CLAUDE.md State Management: one selector per primitive (avoids store-wide re-render).
  const currentUserId = useStore((s) => s.signedIn?.user?.id ?? '');
  const activeCourseId = useStore((s) => s.activeCourseId);
  const activeLessonId = useStore((s) => s.activeLessonId);
  const [currentTier, setCurrentTier] = useState<TierLabel>('free');

  // Resolve community TierLabel from tier_effective (same dependency as CommunityTabShell).
  useEffect(() => {
    if (!currentUserId) return;
    void readTierLabel(currentUserId).then(setCurrentTier);
  }, [currentUserId]);

  const fallback = (
    <div
      className="p-4 space-y-3"
      role="status"
      aria-live="polite"
      aria-label="Loading classroom"
    >
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      {activeLessonId && activeCourseId ? (
        <LessonPlayerView
          lessonId={activeLessonId}
          courseId={activeCourseId}
          currentTier={currentTier}
        />
      ) : activeCourseId ? (
        <CourseDetailView
          courseId={activeCourseId}
          currentUserId={currentUserId}
          currentTier={currentTier}
        />
      ) : (
        <CourseListView currentUserId={currentUserId} currentTier={currentTier} />
      )}
    </Suspense>
  );
}
