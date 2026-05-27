/**
 * Phase 46 Plan 08 — CourseListView (Classroom landing page).
 *
 * Lists all visible courses (`courses_select_all` RLS policy from
 * Plan 46-01 — public catalog). Clicking a course calls
 * `setActiveCourse(courseId)` to drill into the detail view.
 *
 * Reads:
 *   - courses table — id, title, slug, description, cover_url, created_at
 *
 * UI conventions per CLAUDE.md:
 *   - var(--color-*) tokens (no hard-coded colors).
 *   - Card primitive with `interactive` variant for the click affordance.
 *   - EmptyState for the no-courses case (Plan 46-09 ships first courses).
 *   - aria-current=undefined on the list (selection happens via navigate).
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { TierLabel } from '@/lib/community/tier-gate';
import type { Course } from '@/lib/course/course-types';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CourseListViewProps {
  /** Current authenticated user id; '' for anonymous (free-preview only). */
  currentUserId: string;
  /** Effective tier label from tier_effective (used by future locked-card badges). */
  currentTier: TierLabel;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * `currentUserId` / `currentTier` are accepted for forward-compat with
 * Plan 46-09's enrollment count / tier-locked badges; the v0 list view
 * intentionally does not filter on them (the catalog page is public per
 * `courses_select_all` RLS). They live in the prop signature so the
 * stub-then-replace pattern (memory feedback_stub_then_replace_sibling_collision)
 * keeps any sibling editor from forking the API.
 */
export function CourseListView({
  currentUserId: _currentUserId,
  currentTier: _currentTier,
}: CourseListViewProps) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const setActiveCourse = useStore((s) => s.setActiveCourse);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('courses')
        .select('id, title, slug, description, cover_url, completion_threshold_pct, enforce_completion, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setCourses([]);
        return;
      }
      setCourses((data as Course[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (courses === null) {
    return (
      <div className="p-4 space-y-3" role="status" aria-live="polite" aria-label="Loading courses">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4">
        <Card variant="default" padding="md">
          <p className="text-[14px] text-[var(--color-text)]">
            Could not load courses. Please try again.
          </p>
          <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">{loadError}</p>
        </Card>
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          title="No courses yet"
          body="Once your team publishes a course it will appear here."
        />
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text)] mb-4">
        Classroom
      </h1>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="Courses">
        {courses.map((course) => (
          <li key={course.id}>
            <button
              type="button"
              onClick={() => setActiveCourse(course.id)}
              className="w-full text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              aria-label={`Open course ${course.title}`}
            >
              <Card variant="interactive" padding="md">
                {course.cover_url && (
                  <img
                    src={course.cover_url}
                    alt=""
                    className="w-full h-40 object-cover rounded-lg mb-3"
                    loading="lazy"
                  />
                )}
                <h2 className="text-[16px] font-semibold text-[var(--color-text)]">
                  {course.title}
                </h2>
                {course.description && (
                  <p className="mt-1 text-[13px] text-[var(--color-text-secondary)] line-clamp-3">
                    {course.description}
                  </p>
                )}
                <p className="mt-3 text-[12px] font-medium text-[var(--color-primary)]">
                  View course →
                </p>
              </Card>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
