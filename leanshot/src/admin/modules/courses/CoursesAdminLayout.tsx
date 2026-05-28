/**
 * Phase 46 Plan 46-09 (COURSE-01/02/06) — Admin Course Editor layout.
 *
 * Pathname-routed admin module (mirrors CommunityAdminLayout / ModerationLayout).
 * Uses `window.location.pathname` + popstate listener + pushState navigation,
 * consistent with the project's "no router on admin" convention
 * (per CLAUDE.md + reference_react_router_consumer_admin_split).
 *
 * URL map:
 *   /admin/courses                                  → list
 *   /admin/courses/new                              → create
 *   /admin/courses/<courseId>                       → edit course
 *   /admin/courses/<courseId>/modules               → module + lesson tree editor
 *   /admin/courses/<courseId>/lesson/<lessonId>     → edit single lesson
 *
 * AdminShell URL-prefix catch-all (pathname.startsWith('/admin/courses/'))
 * routes ALL of the above to this single layout — registered in
 * src/lib/admin/modules.ts (per feedback_admin_module_manifest_vs_router_branch_drift).
 *
 * Browser back/forward updates the view via the popstate listener.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

const CoursesListAdmin = lazy(() =>
  import('./CoursesListAdmin').then((m) => ({ default: m.CoursesListAdmin })),
);
const CourseEditAdmin = lazy(() =>
  import('./CourseEditAdmin').then((m) => ({ default: m.CourseEditAdmin })),
);
const ModuleEditAdmin = lazy(() =>
  import('./ModuleEditAdmin').then((m) => ({ default: m.ModuleEditAdmin })),
);
const LessonEditAdmin = lazy(() =>
  import('./LessonEditAdmin').then((m) => ({ default: m.LessonEditAdmin })),
);

// ─── View union ───────────────────────────────────────────────────────────────

type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; courseId: string }
  | { type: 'modules'; courseId: string }
  | { type: 'lesson-edit'; courseId: string; lessonId: string };

export function resolveView(pathname: string): View {
  // Strip trailing slash for consistent matching.
  const trimmed = pathname.replace(/\/+$/, '');

  if (trimmed === '/admin/courses' || trimmed === '/admin/courses/') {
    return { type: 'list' };
  }

  const m = trimmed.match(/^\/admin\/courses\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/);
  if (!m) return { type: 'list' };
  const [, seg1, seg2, seg3] = m;
  if (!seg1) return { type: 'list' };

  if (seg1 === 'new') return { type: 'new' };

  // /admin/courses/<courseId>/lesson/<lessonId>
  if (seg2 === 'lesson' && seg3) {
    return { type: 'lesson-edit', courseId: seg1, lessonId: seg3 };
  }

  // /admin/courses/<courseId>/modules (with optional further segments)
  if (seg2 === 'modules') {
    return { type: 'modules', courseId: seg1 };
  }

  // /admin/courses/<courseId>
  return { type: 'edit', courseId: seg1 };
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function CoursesAdminLayout() {
  const [pathname, setPathname] = useState<string>(window.location.pathname);

  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const view = useMemo(() => resolveView(pathname), [pathname]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  return (
    <div className="courses-admin-module space-y-6">
      <Suspense
        fallback={<div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>}
      >
        {view.type === 'list' && <CoursesListAdmin onNavigate={navigate} />}

        {view.type === 'new' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate('/admin/courses')}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to courses
            </button>
            <CourseEditAdmin courseId={null} onNavigate={navigate} />
          </div>
        )}

        {view.type === 'edit' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate('/admin/courses')}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to courses
            </button>
            <CourseEditAdmin courseId={view.courseId} onNavigate={navigate} />
          </div>
        )}

        {view.type === 'modules' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate(`/admin/courses/${view.courseId}`)}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to course
            </button>
            <ModuleEditAdmin courseId={view.courseId} onNavigate={navigate} />
          </div>
        )}

        {view.type === 'lesson-edit' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate(`/admin/courses/${view.courseId}/modules`)}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to modules
            </button>
            <LessonEditAdmin
              courseId={view.courseId}
              lessonId={view.lessonId}
              onNavigate={navigate}
            />
          </div>
        )}
      </Suspense>
    </div>
  );
}
