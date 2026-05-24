/**
 * Phase 46 Plan 08 — CourseDetailView (course landing + sidebar).
 *
 * Loads course + modules + lessons + per-user progress on mount.
 * Renders title / cover / description (sanitized markdown via Phase 44
 * dompurify reuse) + completion percentage + Start/Resume CTA +
 * CourseSidebar (module/lesson tree).
 *
 * Click a lesson row → setActiveCourse(courseId, lessonId) → shell pivots
 * to LessonPlayerView.
 * Back button → setActiveCourse(null) → shell returns to CourseListView.
 *
 * Markdown safety (T-46-05): description rendered via the Phase 44 reuse
 * helper `renderPostBodyHtml` from `@/lib/course/dompurify-config`
 * (which re-exports `@/lib/community/dompurify-config`). NO new policy.
 */
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import type { TierLabel } from '@/lib/community/tier-gate';
import { sanitizeCommunityMarkdown } from '@/lib/course/dompurify-config';
import type {
  Course,
  CourseLesson,
  CourseModule,
  LessonProgress,
} from '@/lib/course/course-types';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

import { CourseSidebar } from './CourseSidebar';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CourseDetailViewProps {
  courseId: string;
  currentUserId: string;
  currentTier: TierLabel;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CourseShape {
  course: Course;
  modules: CourseModule[];
  lessonsByModule: Record<string, CourseLesson[]>;
}

export function CourseDetailView({
  courseId,
  currentUserId,
  currentTier,
}: CourseDetailViewProps) {
  const [shape, setShape] = useState<CourseShape | null>(null);
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const setActiveCourse = useStore((s) => s.setActiveCourse);

  // Load course + modules + lessons (embedded select keeps it to one round-trip).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('courses')
        .select(`
          id, title, slug, description, cover_url,
          completion_threshold_pct, enforce_completion, created_at, updated_at,
          course_modules(
            id, course_id, title, order_index, created_at, updated_at,
            course_lessons(
              id, module_id, title, content_md, order_index,
              mux_asset_id, mux_playback_id, mux_status, duration_seconds,
              is_free_preview, is_required, captions_enabled,
              created_at, updated_at
            )
          )
        `)
        .eq('id', courseId)
        .single();

      if (cancelled) return;
      if (error || !data) {
        setLoadError(error?.message ?? 'Course not found');
        return;
      }

      // PostgREST nested embed: rows arrive un-sorted; project them into the
      // shape CourseSidebar wants (modules in order_index, lessons grouped + sorted).
      const raw = data as unknown as Course & {
        course_modules?: Array<CourseModule & { course_lessons?: CourseLesson[] }>;
      };
      const modules = (raw.course_modules ?? [])
        .map(({ course_lessons: _l, ...m }) => m)
        .sort((a, b) => a.order_index - b.order_index);
      const lessonsByModule: Record<string, CourseLesson[]> = {};
      for (const m of raw.course_modules ?? []) {
        lessonsByModule[m.id] = (m.course_lessons ?? [])
          .slice()
          .sort((a, b) => a.order_index - b.order_index);
      }
      const { course_modules: _drop, ...course } = raw;
      setShape({ course: course as Course, modules, lessonsByModule });
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // Load per-user progress (separate query — own RLS scope per Plan 46-01).
  useEffect(() => {
    if (!currentUserId) {
      setProgress({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('lesson_progress')
        .select('user_id, lesson_id, course_id, completed_at, last_position_seconds, max_position_reached_seconds, last_seen_at')
        .eq('user_id', currentUserId)
        .eq('course_id', courseId);
      if (cancelled) return;
      if (error || !data) {
        setProgress({});
        return;
      }
      const map: Record<string, LessonProgress> = {};
      for (const row of data as LessonProgress[]) {
        map[row.lesson_id] = row;
      }
      setProgress(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, currentUserId]);

  const summary = useMemo(() => {
    if (!shape) return null;
    const allLessons = shape.modules.flatMap((m) => shape.lessonsByModule[m.id] ?? []);
    const total = allLessons.length;
    const completed = allLessons.filter((l) => progress[l.id]?.completed_at).length;
    const inProgress = allLessons.find(
      (l) => progress[l.id] && !progress[l.id]?.completed_at,
    );
    const firstUncompleted = allLessons.find((l) => !progress[l.id]?.completed_at);
    return { total, completed, inProgress, firstUncompleted };
  }, [shape, progress]);

  if (loadError) {
    return (
      <div className="p-4">
        <button
          type="button"
          onClick={() => setActiveCourse(null)}
          className="inline-flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to courses
        </button>
        <Card variant="default" padding="md">
          <p className="text-[14px] text-[var(--color-text)]">Could not load this course.</p>
          <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">{loadError}</p>
        </Card>
      </div>
    );
  }

  if (!shape) {
    return (
      <div className="p-4 space-y-4" role="status" aria-live="polite" aria-label="Loading course">
        <Skeleton className="h-8 w-1/3 rounded" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  const { course, modules, lessonsByModule } = shape;
  const descriptionHtml = course.description
    ? sanitizeCommunityMarkdown(course.description)
    : null;
  const resumeTarget = summary?.inProgress ?? summary?.firstUncompleted ?? null;
  const ctaLabel = summary && summary.completed > 0 ? 'Resume course' : 'Start course';

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <button
        type="button"
        onClick={() => setActiveCourse(null)}
        className="inline-flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        aria-label="Back to courses"
      >
        <ArrowLeft className="size-4" />
        Back to courses
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        <div>
          {course.cover_url && (
            <img
              src={course.cover_url}
              alt=""
              className="w-full h-56 object-cover rounded-2xl mb-4"
            />
          )}
          <h1 className="text-[24px] font-semibold tracking-tight text-[var(--color-text)] mb-2">
            {course.title}
          </h1>
          {summary && summary.total > 0 && (
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
              {summary.completed} of {summary.total} lessons complete
            </p>
          )}
          {descriptionHtml && (
            <div
              className="prose prose-sm max-w-none text-[var(--color-text)] mb-4"
              // T-46-05 mitigation: HTML is sanitized by the Phase 44
              // DOMPurify policy re-exported via @/lib/course/dompurify-config.
              // No new policy in this file.
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
            />
          )}
          {resumeTarget && (
            <button
              type="button"
              onClick={() => setActiveCourse(course.id, resumeTarget.id)}
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--color-primary)] text-white h-11 px-5 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
              aria-label={`${ctaLabel}: ${resumeTarget.title}`}
            >
              {ctaLabel}
            </button>
          )}
        </div>

        <aside className="lg:sticky lg:top-4 self-start">
          <Card variant="default" padding="md">
            <CourseSidebar
              modules={modules}
              lessonsByModule={lessonsByModule}
              progressByLesson={progress}
              activeLessonId={null}
              currentTier={currentTier}
              onLessonClick={(lessonId) => setActiveCourse(course.id, lessonId)}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}
