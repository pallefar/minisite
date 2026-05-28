/**
 * Phase 46 Plan 08 — CourseSidebar (module/lesson tree for CourseDetailView).
 *
 * Pure render component. Receives modules + lessons + progress via props
 * (loading owned by CourseDetailView so the sidebar can be reused inside
 * the lesson player view if we ever want a persistent rail).
 *
 * Per-row affordances:
 *   - Completion checkmark when progress.completed_at !== null.
 *   - Lock icon when lesson.is_free_preview === false AND currentTier === 'free'
 *     (UI advisory only; mux-sign-playback returns 403 if bypassed — T-46-01).
 *   - aria-current="page" on the active lesson row.
 *
 * Module rows are simple non-collapsing headers (matches the v0 admin
 * editor; collapsible groups can land in a follow-up plan if needed).
 */
import { CheckCircle2, Lock, Play } from 'lucide-react';
import type { TierLabel } from '@/lib/community/tier-gate';
import type { CourseLesson, CourseModule, LessonProgress } from '@/lib/course/course-types';
import { cn } from '@/lib/helpers';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CourseSidebarProps {
  modules: CourseModule[];
  /** Map of module_id → ordered lessons. */
  lessonsByModule: Record<string, CourseLesson[]>;
  /** Map of lesson_id → progress row for current user (sparse — only watched lessons). */
  progressByLesson: Record<string, LessonProgress>;
  activeLessonId: string | null;
  currentTier: TierLabel;
  onLessonClick: (lessonId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function CourseSidebar({
  modules,
  lessonsByModule,
  progressByLesson,
  activeLessonId,
  currentTier,
  onLessonClick,
}: CourseSidebarProps) {
  if (modules.length === 0) {
    return <p className="text-[13px] text-[var(--color-text-secondary)] italic">No modules yet.</p>;
  }

  return (
    <nav aria-label="Course modules" className="space-y-5">
      {modules.map((module) => {
        const lessons = lessonsByModule[module.id] ?? [];
        return (
          <div key={module.id}>
            <h3 className="text-[13px] font-semibold tracking-tight text-[var(--color-text)] uppercase mb-2">
              {module.title}
            </h3>
            <ul className="space-y-1">
              {lessons.map((lesson) => {
                const completed =
                  progressByLesson[lesson.id]?.completed_at !== null &&
                  progressByLesson[lesson.id]?.completed_at !== undefined;
                const locked = !lesson.is_free_preview && currentTier === 'free';
                const active = activeLessonId === lesson.id;
                return (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      onClick={() => onLessonClick(lesson.id)}
                      aria-current={active ? 'page' : undefined}
                      aria-label={`Open lesson ${lesson.title}${locked ? ' (locked — upgrade required)' : ''}`}
                      className={cn(
                        'group w-full text-left rounded-lg px-3 py-2 inline-flex items-center gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                        active
                          ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]',
                      )}
                    >
                      <span aria-hidden className="shrink-0">
                        {completed ? (
                          <CheckCircle2 className="size-4" />
                        ) : locked ? (
                          <Lock className="size-4" />
                        ) : (
                          <Play className="size-4" />
                        )}
                      </span>
                      <span className="flex-1 text-[13px] font-medium truncate">
                        {lesson.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                        {formatDuration(lesson.duration_seconds)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {lessons.length === 0 && (
                <li className="px-3 py-2 text-[12px] italic text-[var(--color-text-secondary)]">
                  No lessons yet.
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
