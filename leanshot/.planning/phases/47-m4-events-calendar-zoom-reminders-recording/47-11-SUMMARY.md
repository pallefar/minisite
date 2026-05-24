---
phase: 47-m4-events-calendar-zoom-reminders-recording
plan: 11
subsystem: admin / events
tags: [admin, events, mux, zoom, pathname-router, course-attach]
requires:
  - 47-01  # events table + RLS (is_staff INSERT/UPDATE)
  - 47-02  # event_rsvps schema + waitlist promotion trigger
  - 47-03  # event_get_join_url SECDEF (column allowlist)
  - 47-04  # event-covers bucket
  - 47-06  # zoom-create-meeting Edge Fn
  - 47-09  # mux-create-upload event-recording branch
  - 47-10  # consumer events surface + event-types.ts
provides:
  - "Admin Events module under /admin/events* (pathname-routed)"
  - "Create / edit / list / attendees / recording-upload surfaces"
  - "Zoom radio: paste-URL vs Generate via zoom-create-meeting Fn"
  - "course_modules attach-to-module picker for D-15"
  - "event-covers bucket upload for D-16 hero image"
affects:
  - src/lib/admin/modules.ts  # registers events entry (8th community-area module)
tech-stack:
  added:
    - "CalendarDays lucide icon for events module"
  patterns:
    - "pathname-based admin layout (window.location.pathname + popstate + useState)"
    - "Suspense + lazy per-subview"
    - "MuxUploader endpoint-resolver function pattern (LessonVideoUploader analog)"
    - "Direct supabase.from('events').insert + functions.invoke chain for Zoom generate"
key-files:
  created:
    - leanshot/src/admin/modules/events/AdminEventsLayout.tsx
    - leanshot/src/admin/modules/events/EventListPage.tsx
    - leanshot/src/admin/modules/events/EventEditPage.tsx
    - leanshot/src/admin/modules/events/EventAttendeesPane.tsx
    - leanshot/src/admin/modules/events/EventRecordingUploader.tsx
    - leanshot/src/admin/modules/events/manifest.ts
  modified:
    - leanshot/src/lib/admin/modules.ts  # +CalendarDaysIcon import; +events manifest entry
decisions:
  - "Pathname-based routing (no client-router package imports) — matches the corrected admin precedent per memory reference_react_router_consumer_admin_split + sibling modules CommunityAdminLayout / CoursesAdminLayout / ModerationLayout."
  - "Zoom Generate mode: INSERT events row FIRST so event_id exists, THEN invoke zoom-create-meeting Fn — Fn writes join_url + zoom_meeting_id + zoom_managed=true via service-role (events RLS allows is_staff INSERT but column allowlist hides those fields from subsequent client SELECT; this is intentional per D-18)."
  - "Re-generation of Zoom meeting on edit is OUT OF SCOPE — radio disabled when zoom_managed is already true. Operator can clear via direct DB if needed; future iteration can add an admin-only re-generate path."
  - "Cover image upload persists immediately on edit-mode (writes events.cover_url on upload success) rather than waiting for Save click — matches the UX expectation that file-pickers are atomic operations. Create mode uses 'pending-<timestamp>' path namespace and writes cover_url into the INSERT payload."
  - "Going-count computed via separate event_rsvps query rather than a denormalized counter — admin org scale is low (≤200 events typically), and adding a counter column would require migration + trigger work for marginal benefit."
  - "EventListPage status badge (upcoming/live/past) derived client-side from start_at/end_at — no DB column; cheap and avoids needing a server-computed view."
  - "Manifest minRole='staff' (not 'admin') — events are a community-operations surface; on-duty staff should be able to create/edit events. DB-layer events RLS + Edge Fn 403 ADMIN_REQUIRED enforce server-side gate (Pattern S1 dual-layer)."
  - "manifest.ts re-exports the AdminModule entry as eventsModule rather than defining a divergent shape — keeps one type definition (AdminModule from src/lib/admin/modules.ts) and avoids manifest-vs-global drift."
metrics:
  tasks_completed: 2
  files_created: 6
  files_modified: 1
  approx_lines_added: 1470
  completed_date: 2026-05-24
---

# Phase 47 Plan 11: Admin Events Module Summary

One-liner: Admin CRUD surface for events under /admin/events* — pathname-routed layout with EventListPage / EventEditPage (Zoom radio + course_modules picker + event-covers upload) / EventAttendeesPane / EventRecordingUploader (Mux event-recording branch).

## What shipped

6 new files in `src/admin/modules/events/` + 1 registration edit in the global `ADMIN_MODULES` manifest.

### AdminEventsLayout.tsx

Pathname-based dispatcher. `resolveView(pathname)` matches `/admin/events`, `/admin/events/new`, `/admin/events/<id>/edit`, `/admin/events/<id>/attendees`, `/admin/events/<id>/recording`. Uses `window.location.pathname` + `popstate` listener + `useState` + `pushState`-on-navigate (mirrors `CommunityAdminLayout.tsx` and `CoursesAdminLayout.tsx`). Each subview is `lazy()` + wrapped in `<Suspense>`.

### EventListPage.tsx

Reads `events` joined to `community_spaces` (column allowlist excludes `join_url`/`zoom_meeting_id`). Per-row going count computed via sibling `event_rsvps` query filtered `status='going'`. Status badge derived from `start_at`/`end_at` vs `Date.now()` (upcoming/live/past). Row action buttons navigate to edit / attendees / recording.

### EventEditPage.tsx

Full create + edit form per CONTEXT D-01 + D-06 + D-15 + D-16:
- **Title** (required, max 200), **Description** (markdown textarea, max 4000)
- **Start / End** (`datetime-local` inputs; client validation ensures end > start; DB enforces via `events_time_chk` CHECK constraint)
- **Capacity** (number; 0 = unlimited)
- **Space** dropdown (queries `community_spaces`)
- **Zoom radio** (D-06):
  - *Paste meeting URL* — writes `join_url` directly, `zoom_managed=false`
  - *Generate Zoom meeting* — INSERTs the event row first (so `event_id` exists), then `supabase.functions.invoke('zoom-create-meeting', { body: { event_id } })`. Fn writes `join_url` + `zoom_meeting_id` + `zoom_managed=true` via service-role. On error the row stays created so operator can re-run from edit (logged as deviation below).
  - Re-generate disabled on edit when `zoom_managed` is already true
- **Attach to course module** (D-15) — dropdown of `course_modules` JOIN `courses` labeled `"Course Title › Module Title"` (Phase 46 schema)
- **Cover image upload** (D-16) — file input → `supabase.storage.from('event-covers').upload('<event_id>/<filename>')` → `getPublicUrl(...).publicUrl` → `events.cover_url`. On edit, persists immediately; on create, namespaces with `pending-<timestamp>` and writes URL into INSERT payload.

### EventAttendeesPane.tsx

Reads `event_rsvps` JOIN `profiles` for the event. Status pills (going / maybe / not_going / waitlist with `#position`). Admin Remove DELETEs the rsvp row — the `event_rsvps_promotion` trigger cascades to promote the next waitlisted user when capacity frees up (per Phase 47 Plan 47-02).

### EventRecordingUploader.tsx

Forks LessonVideoUploader (Phase 46 Plan 46-09 admin Mux uploader). Calls `supabase.functions.invoke('mux-create-upload', { body: { kind: 'event-recording', event_id } })` to resolve the Direct Upload endpoint; `MuxUploader` from `@mux/mux-uploader-react` handles the chunked PUT. 8 GB file size ceiling (events can run ~3h). Fn enforces `is_staff` server-side and returns 403 ADMIN_REQUIRED for non-staff (T-46-07 mirror, defense in depth on top of `minRole='staff'` UX gate — Pattern S1 dual-layer).

### manifest.ts

Re-exports the `AdminModule` entry as `eventsModule` for callers needing per-module manifest by name. Uses the canonical `AdminModule` type from `@/lib/admin/modules` — no divergent shape.

### src/lib/admin/modules.ts edit

Adds `CalendarDays` import + registers `events` entry with `route: 'events'`, `minRole: 'staff'`, `flagKey: 'admin.events.enabled'`, `lazy: () => import('@/admin/modules/events/AdminEventsLayout')`. AdminShell's URL-prefix catch-all (`pathname.startsWith('/admin/events/')`) routes all sub-routes here automatically — no per-module switch branch needed (per memory `feedback_admin_module_manifest_vs_router_branch_drift`).

## Acceptance gates (all pass)

```text
6 file presence checks            → PASS (all present)
grep -rc 'react-router-dom'       → 0 (no lines match in module dir)
grep -rcE '<Routes|<Route|...'    → 0 (no lines match in module dir)
window.location.pathname in
  AdminEventsLayout                → 4 occurrences (≥1 required)
popstate in AdminEventsLayout      → 4 occurrences (≥1 required)
zoom-create-meeting in
  EventEditPage                    → 5 occurrences (≥1 required)
course_modules in EventEditPage    → 3 occurrences (≥1 required)
event-covers in EventEditPage      → 6 occurrences (≥1 required)
kind: 'event-recording' in
  EventRecordingUploader           → 2 occurrences (≥1 required)
/admin/events in manifest.ts       → 2 occurrences (≥1 required)
events in src/lib/admin/modules.ts → 8 occurrences (≥1 required)
tsc -p tsconfig.app.json --noEmit  → exit 0 (clean)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Type] Supabase join-shape type narrowing in EventAttendeesPane**
- **Found during:** Task 2 tsc check
- **Issue:** PostgREST type inference returned `profile: { handle: any; display_name: any; }[]` (array) for the one-to-one `profiles` join via `user_id`, breaking the direct cast to `{ handle: ... } | null`.
- **Fix:** Widened the cast to `unknown` then to a union `T | T[] | null`; runtime guard `Array.isArray(profile) ? profile[0] ?? null : profile` extracts the row. Same idiom used in EventListPage and EventEditPage for `space`/`course` joins (proactive, applied during initial write).
- **Files modified:** `leanshot/src/admin/modules/events/EventAttendeesPane.tsx`
- **Commit:** `e0c5be90`

**2. [Rule 3 - Blocking] Comment text referenced the literal `react-router-dom` token**
- **Found during:** Task 1 grep gate (after writing the files)
- **Issue:** Documentation header comments contained the phrase "NO react-router-dom" — which the negation grep gate (acceptance criteria `grep -rc 'react-router-dom' ... | grep -v ':0$' | wc -l = 0`) would flag as a match. This is exactly the trap documented in memory `feedback_negation_grep_defeated_by_comment_string`.
- **Fix:** Rewrote both comments (AdminEventsLayout.tsx + EventEditPage.tsx) to describe the absence without using the literal package name.
- **Files modified:** `leanshot/src/admin/modules/events/AdminEventsLayout.tsx`, `leanshot/src/admin/modules/events/EventEditPage.tsx`
- **Commit:** Folded into `649c8967` (caught before commit)

**3. [Rule 3 - Blocking] node_modules missing in worktree**
- **Found during:** Task 1 tsc check
- **Issue:** Per memory `reference_npm_install_worktree_main_drift`, worktree doesn't inherit node_modules. Symlinked `leanshot/node_modules` → `/Users/karstenhaldan/minisite/leanshot/node_modules` to access local `tsc`. Symlink itself is gitignored (via `leanshot/node_modules/` rule).
- **Files modified:** None tracked (symlink only)

### Operational notes

**Zoom re-generation is out of scope.** Per the plan's "On edit, re-generating is out of scope" language, the Generate radio is disabled when `zoom_managed` is already true. If an admin needs to re-issue a Zoom meeting, they currently must clear `zoom_managed`/`join_url`/`zoom_meeting_id` via direct DB intervention. A future iteration can ship a "Regenerate Zoom" affordance with a confirmation prompt.

**Zoom Fn error path leaves the event row intact.** When `zoom-create-meeting` returns an error after a successful INSERT, the event row is preserved (toast surfaces the failure) so the operator can re-run from the edit screen. This is intentional — losing the entered title/description/start/end would be a worse UX than a temporarily-missing meeting URL.

**Cover-image upload before Save in CREATE mode** writes to `event-covers/pending-<timestamp>/<filename>` rather than blocking the Save click. The Save then writes that publicUrl into the INSERT. The "pending-" path is harmless (orphaned uploads simply exist in the bucket; no link to any event row). A future janitor cron could prune unreferenced pending-* objects if desired.

## Threat surface scan

No new threat surface introduced beyond the plan's `<threat_model>` (T-47-43..45). All new surface is gated by existing RLS/Fn checks already deployed in 47-01..47-09.

## Self-Check: PASSED

Files verified present (worktree):
- `leanshot/src/admin/modules/events/AdminEventsLayout.tsx` — FOUND
- `leanshot/src/admin/modules/events/EventListPage.tsx` — FOUND
- `leanshot/src/admin/modules/events/EventEditPage.tsx` — FOUND
- `leanshot/src/admin/modules/events/EventAttendeesPane.tsx` — FOUND
- `leanshot/src/admin/modules/events/EventRecordingUploader.tsx` — FOUND
- `leanshot/src/admin/modules/events/manifest.ts` — FOUND
- `leanshot/src/lib/admin/modules.ts` — MODIFIED (events entry registered)

Commits verified in `git log`:
- `649c8967` — feat(47-11): AdminEventsLayout + EventListPage + EventEditPage (pathname-routed)
- `e0c5be90` — feat(47-11): EventAttendeesPane + EventRecordingUploader + manifest

Acceptance gates: all pass (see table above). `tsc -p tsconfig.app.json --noEmit` exit 0.
