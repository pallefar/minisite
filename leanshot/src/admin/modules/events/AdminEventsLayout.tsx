/**
 * Phase 47 Plan 47-11 — AdminEventsLayout (admin surface).
 *
 * Admin module entry for Events CRUD + Attendees + Recording uploader.
 *
 * Routing model: pathname-based (consistent with other admin modules
 * per ReviewsLayout.tsx, CommunityAdminLayout.tsx, CoursesAdminLayout.tsx).
 * Uses window.location.pathname + popstate + useState; no client-router
 * package imports. See memory `reference_react_router_consumer_admin_split`
 * (CORRECTED 2026-05-23: admin uses pathname-based switching).
 *
 * Sub-routes (string-prefix match on window.location.pathname):
 *   /admin/events                   → EventListPage
 *   /admin/events/new               → EventEditPage (create)
 *   /admin/events/:id/edit          → EventEditPage (edit)
 *   /admin/events/:id/attendees     → EventAttendeesPane
 *   /admin/events/:id/recording     → EventRecordingUploader
 *
 * AdminShell.tsx URL-prefix catch-all (pathname.startsWith('/admin/events/'))
 * routes ALL of the above to this single layout — registered in
 * src/lib/admin/modules.ts (per feedback_admin_module_manifest_vs_router_branch_drift).
 *
 * Browser back/forward updates the view via the popstate listener.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

const EventListPage = lazy(() =>
  import('./EventListPage').then((m) => ({ default: m.EventListPage })),
);
const EventEditPage = lazy(() =>
  import('./EventEditPage').then((m) => ({ default: m.EventEditPage })),
);
const EventAttendeesPane = lazy(() =>
  import('./EventAttendeesPane').then((m) => ({ default: m.EventAttendeesPane })),
);
const EventRecordingUploader = lazy(() =>
  import('./EventRecordingUploader').then((m) => ({
    default: m.EventRecordingUploader,
  })),
);

// ─── View union ───────────────────────────────────────────────────────────────

type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; eventId: string }
  | { type: 'attendees'; eventId: string }
  | { type: 'recording'; eventId: string };

export function resolveView(pathname: string): View {
  const trimmed = pathname.replace(/\/+$/, '');

  if (trimmed === '/admin/events' || trimmed === '/admin/events/') {
    return { type: 'list' };
  }

  // /admin/events/<id>(/<sub>)?
  const m = trimmed.match(/^\/admin\/events\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return { type: 'list' };
  const [, seg1, seg2] = m;
  if (!seg1) return { type: 'list' };

  if (seg1 === 'new') return { type: 'new' };

  if (seg2 === 'attendees') return { type: 'attendees', eventId: seg1 };
  if (seg2 === 'recording') return { type: 'recording', eventId: seg1 };

  // /admin/events/<id>/edit (default for any other / no further segment).
  return { type: 'edit', eventId: seg1 };
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function AdminEventsLayout() {
  const [pathname, setPathname] = useState<string>(window.location.pathname);

  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const view = useMemo(() => resolveView(pathname), [pathname]);

  const navigate = (path: string): void => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  return (
    <div className="admin-events-module space-y-6">
      <Suspense
        fallback={<div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>}
      >
        {view.type === 'list' && <EventListPage onNavigate={navigate} />}

        {view.type === 'new' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate('/admin/events')}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to events
            </button>
            <EventEditPage eventId={null} onNavigate={navigate} />
          </div>
        )}

        {view.type === 'edit' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate('/admin/events')}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to events
            </button>
            <EventEditPage eventId={view.eventId} onNavigate={navigate} />
          </div>
        )}

        {view.type === 'attendees' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate(`/admin/events/${view.eventId}/edit`)}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to event
            </button>
            <EventAttendeesPane eventId={view.eventId} />
          </div>
        )}

        {view.type === 'recording' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate(`/admin/events/${view.eventId}/edit`)}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to event
            </button>
            <EventRecordingUploader eventId={view.eventId} />
          </div>
        )}
      </Suspense>
    </div>
  );
}
