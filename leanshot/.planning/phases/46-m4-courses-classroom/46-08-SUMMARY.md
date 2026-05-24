---
phase: 46
plan: 08
subsystem: courses-consumer
tags: [courses, consumer-ui, classroom, mux-player, lazy, bundle-budget, anti-skip, certificates]
requires: [46-01, 46-02, 46-03, 46-04, 46-05, 46-06, 46-07]
provides:
  - "TabId 'classroom' (Phase 46 new top-level tab)"
  - "Zustand activeCourseId + activeLessonId UIState slice + setActiveCourse action"
  - "src/lib/course/course-progress.ts — createProgressSyncer + sendProgressBeacon + isLessonComplete"
  - "src/lib/course/course-storage.ts — COURSE_RESOURCES_BUCKET + downloadResourceSignedUrl + mimeToResourceType"
  - "ClassroomTabShell + CourseListView + CourseDetailView + CourseSidebar + LessonPlayerView + LessonResourceList"
  - "course_lessons.resources jsonb column (supplemental migration)"
affects:
  - "src/types/index.ts TabId union"
  - "src/lib/store.ts (new UIState + action)"
  - "src/lib/i18n/nav-labels.ts (exhaustive switch arms)"
  - "src/lib/constants.ts TAB_TITLES"
  - "src/components/layout/Sidebar.tsx + MobileNav.tsx (Classroom nav entry)"
  - "src/App.tsx (lazy import + tab branch)"
  - "src/lib/course/course-types.ts (CourseLesson.resources + new LessonResource shape)"
tech-stack:
  added: []
  patterns:
    - "Mux Player /lazy entry point (defers ~170 kB to viewport intersection)"
    - "navigator.sendBeacon text/plain JSON body (Auth token in body — sendBeacon cannot set headers)"
    - "Client-side anti-skip via Math.max accumulate + 15s debounce + server GREATEST() preservation"
    - "Stub-then-replace for same-wave file collisions (LessonPlayerView stub in Task 2, full impl in Task 3)"
    - "DOMPurify re-export from Phase 44 (no new policy per plan-checker gate)"
key-files:
  created:
    - leanshot/src/lib/course/course-progress.ts
    - leanshot/src/lib/course/course-progress.test.ts
    - leanshot/src/lib/course/course-storage.ts
    - leanshot/src/components/course/ClassroomTabShell.tsx
    - leanshot/src/components/course/CourseListView.tsx
    - leanshot/src/components/course/CourseDetailView.tsx
    - leanshot/src/components/course/CourseSidebar.tsx
    - leanshot/src/components/course/LessonPlayerView.tsx
    - leanshot/src/components/course/LessonResourceList.tsx
    - supabase/migrations/20270725000006_p46_course_lessons_resources_column.sql
  modified:
    - leanshot/src/types/index.ts
    - leanshot/src/lib/store.ts
    - leanshot/src/lib/course/course-types.ts
    - leanshot/src/lib/i18n/nav-labels.ts
    - leanshot/src/lib/constants.ts
    - leanshot/src/components/layout/Sidebar.tsx
    - leanshot/src/components/layout/MobileNav.tsx
    - leanshot/src/App.tsx
    - leanshot/public/locales/en/nav.json
    - leanshot/public/locales/es/nav.json
decisions:
  - "TabId widened with 'classroom' (EXCEPTION per CONTEXT — courses are a distinct content surface, not a Community sub-view; documented inline in src/types/index.ts and in the App.tsx render branch comment)."
  - "Stub-then-replace ordering for LessonPlayerView: Task 2 shipped a 30-line stub with the final prop signature so ClassroomTabShell typechecked at commit time; Task 3 replaced it in-place. Avoids the same-wave 'plan-A imports plan-B's not-yet-shipped file' trap."
  - "course_lessons.resources jsonb column shipped here as supplemental migration 20270725000006 — Plan 46-01 omitted it; both Plan 46-09 (admin writer) and this plan's LessonResourceList (reader) depend on it. Filename collision-checked against the existing 5 timestamps."
  - "MobileNav: added Classroom as the 11th entry rather than dropping Insights — the nav strip already uses overflow-x scroll (`overflow-x-auto scrollbar-none`), so the iOS-style scrollable strip absorbs it cleanly."
  - "Resource download UI: per-row inline error states (forbidden/not_found/network) rather than a global toast — the row's button stays the natural retry surface."
  - "Mark Complete force-flushes the progress syncer BEFORE invoking complete_lesson RPC, so the server-side ≥95% gate re-reads the freshest DB max (otherwise a click within the 15s debounce window could fail the gate against a stale value)."
metrics:
  duration: "~50 min"
  completed: "2026-05-24"
  commits: 3
  tasks: 3
  files_created: 10
  files_modified: 10
---

# Phase 46 Plan 08: Consumer-side Classroom Surface — Summary

**One-liner:** Ships TabId `'classroom'` + the full consumer Classroom (course list / detail / Mux signed-playback lesson player with client-side anti-skip + tab-close sendBeacon + Mark-Complete ≥95% gate + course-complete certificate trigger + tier-gated resource downloads) at 6.55 kB gz for the `course-player` chunk (78% under the 30 kB ceiling).

## What shipped

### TDD harness (Task 1)
- 14 vitest cases covering `createProgressSyncer` (scrub-back tracking via `Math.max`; rounded-int RPC args; 15s debounce behavior; flush-no-op when clean), `sendProgressBeacon` (text/plain JSON body shape; URL composition; access-token-required guard), and `isLessonComplete` (≥95% boundary; null progress; zero/null duration guards).
- All 14 passing; ran via `npx vitest run --config vite.config.ts src/lib/course/course-progress.test.ts` to bypass the workspace projects config that masks the SPA test directory (per memory reference_vitest_4_projects_config_masks_default).

### Foundation (Task 1)
- `TabId` widened with `'classroom'` (inline comment documents the EXCEPTION rationale per CONTEXT + memory reference_react_router_consumer_admin_split).
- `useStore` exposes `activeCourseId: string | null`, `activeLessonId: string | null`, and `setActiveCourse(courseId, lessonId?)` — both fields excluded from `partialize` (ephemeral nav state, mirroring `activeCommunitySpaceId`).
- `src/lib/course/course-storage.ts`: `COURSE_RESOURCES_BUCKET`, `COURSE_RESOURCES_MIMES` (PDF/MP4/ZIP, no SVG), 200 MB cap, `downloadResourceSignedUrl` (60-min TTL with forbidden/not_found/network error mapping), `mimeToResourceType` helper.
- `src/lib/course/course-progress.ts`: `SYNC_DEBOUNCE_MS = 15_000`; `createProgressSyncer` (anti-scrub-back via `Math.max`, dirty-flag to suppress spurious flush, async flush with timer clear, `getLastPosition()` + `getMaxReached()` accessors for beacon body); `sendProgressBeacon` (early-return false when accessToken empty since unsigned beacons are silently dropped; rounded ints; `text/plain` default content-type via string body); `isLessonComplete` (null-progress + zero-duration guards; ratio comparison).
- Sidebar + MobileNav extended with Classroom entry (`BookOpen` icon). MobileNav uses existing `overflow-x-auto` so no tab dropped.
- `TAB_TITLES.classroom` + `nav:classroom` + `nav:tab_short_classroom` keys (en/es).

### Views (Task 2)
- `ClassroomTabShell`: Suspense + 3-way dispatch on `activeLessonId`/`activeCourseId`; lazy-imports the three sub-views (all route into `course-player` chunk via `vite.config.ts:227`). Resolves `TierLabel` from `tier_effective` view (same dependency as `CommunityTabShell`).
- `CourseListView`: `supabase.from('courses').order(created_at desc)` → card grid (`interactive` variant); EmptyState; loading skeleton; error card. Accepts `currentUserId`/`currentTier` forward-compat props.
- `CourseDetailView`: single embed query (`courses → course_modules → course_lessons`) + separate `lesson_progress` query scoped to current user. Renders cover + title + sanitized description + completion summary + Start/Resume CTA + `CourseSidebar`. Back button → `setActiveCourse(null)`.
- `CourseSidebar`: pure render component with completion check / lock / play affordances; `aria-current="page"` on active row; per-lesson lock badge when `!is_free_preview && currentTier === 'free'` (UI advisory only — server enforces 403 via `mux-sign-playback`).
- `App.tsx`: lazy import + `{currentTab === 'classroom' && <ClassroomTabShell />}` branch.

### Lesson Player + Resources (Task 3)
- `LessonPlayerView` (full implementation, replaces Task 2 stub):
  - `import MuxPlayer from '@mux/mux-player-react/lazy'` (CRITICAL — bare entry defeats 30 kB ceiling).
  - `supabase.functions.invoke('mux-sign-playback', { body: { lesson_id } })` → `{ playback, thumbnail, playback_id }`; `FunctionsHttpError.context.error` branches: `tier_required` → upgrade CTA, `lesson_not_ready`/`lesson_not_found` → "still preparing" card, fallthrough → generic error card.
  - `createProgressSyncer` ref wired to MuxPlayer `onTimeUpdate`; 15s debounce → `public.update_lesson_position` RPC (GREATEST() preserves max server-side per D-09/D-12).
  - `beforeunload` + `visibilitychange→hidden` listeners → `sendProgressBeacon` (text/plain JSON, access_token in body since sendBeacon cannot set headers per RESEARCH Pitfall 3). NO Mux `video.view` webhook reference per memory reference_mux_video_view_event_for_antiskip.
  - `Mark Complete`: client-gated by `isLessonComplete`; on click force-flushes syncer (so server re-reads freshest DB max), invokes `complete_lesson` RPC, refreshes progress, then attempts `generate-course-certificate` (400/404 silently OK — course not yet 100%). On success surfaces `{ download_url, verification_url }` in an inline cert-ready card with Award icon.
  - `content_md` sanitized via `sanitizeCommunityMarkdown` (Phase 44 reuse via `@/lib/course/dompurify-config`) — NO new DOMPurify policy.
  - Prev/Next nav via `order_index` lookup within the same module.
  - `startTime={progress?.last_position_seconds ?? 0}` for resume.
- `LessonResourceList`: iterates `course_lessons.resources` jsonb; per-row gate stack `isResourceAllowed(tier, mimeToResourceType(mime))`; locked rows show "Pro" badge instead of Download. Click → `downloadResourceSignedUrl` → `window.open` in new tab; inline error states (forbidden / not_found / network).
- `supabase/migrations/20270725000006_p46_course_lessons_resources_column.sql`: adds `course_lessons.resources jsonb not null default '[]'::jsonb` idempotently. Plan 46-01 omitted it; Plan 46-09 admin LessonResourceUploader writes; this plan reads. Timestamp 000006 next free slot.

## Verification

| Gate                                                              | Result |
| ----------------------------------------------------------------- | ------ |
| `npx vitest run src/lib/course/course-progress.test.ts`           | **14/14 passing** |
| `npx tsc -p tsconfig.app.json --noEmit`                           | **clean** |
| `grep -qE "'classroom'" src/types/index.ts`                       | pass   |
| `grep -qE "activeCourseId" src/lib/store.ts`                      | pass   |
| `grep -qE "setActiveCourse" src/lib/store.ts`                     | pass   |
| `grep -qE "COURSE_RESOURCES_BUCKET" src/lib/course/course-storage.ts` | pass |
| `grep -qE "createProgressSyncer" src/lib/course/course-progress.ts`   | pass |
| `grep -qE "isLessonComplete" src/lib/course/course-progress.ts`       | pass |
| `grep -qE "setTab\(.*classroom" src/components/layout/Sidebar.tsx`   | pass |
| `grep -qE "setTab\(.*classroom" src/components/layout/MobileNav.tsx` | pass |
| `grep -qE "ClassroomTabShell" src/App.tsx`                        | pass   |
| `grep -qE "currentTab === 'classroom'" src/App.tsx`               | pass   |
| `grep -qE "@mux/mux-player-react/lazy" src/components/course/LessonPlayerView.tsx` | pass |
| `grep -qE "mux-sign-playback" src/components/course/LessonPlayerView.tsx`          | pass |
| `grep -qE "navigator\.sendBeacon" src/lib/course/course-progress.ts`               | pass |
| `! grep -rE 'new DOMPurify\|createDOMPurify' src/components/course/`               | pass |
| `! grep -rE "from '@mux/mux-player-react'[^/]" src/components/course/`             | pass |
| `npm run build`                                                    | clean (6.93s; PWA precache 142 entries) |
| `bash scripts/assert-bundle-budget.sh`                             | **PASS** (all 14 chunks within ceiling) |

### Bundle budget detail (`course-player` chunk)

| Chunk           | Ceiling  | Actual gz | Headroom |
| --------------- | -------- | --------- | -------- |
| `course-player` | 30 kB    | **6.55 kB** | 78% |

The 6.55 kB chunk contains the shell + list/detail/sidebar/player + resource-list + sanitize-glue. Mux player bytes land in the existing `community-media` chunk (298.43 kB / 320 kB ceiling) since the bare `@mux/*` node_modules rule in `vite.config.ts` routes them there — `community-media` was unchanged by this plan (still 298.43 kB).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tsc errors after Task 2 commit (LessonPlayerView not yet shipped).**
- **Found during:** Task 2 verify (`tsc -p tsconfig.app.json --noEmit`).
- **Issue:** `ClassroomTabShell` imports `./LessonPlayerView` which Task 3 ships — same-wave commits would fail tsc.
- **Fix:** Shipped a 30-line stub `LessonPlayerView` in Task 2 with the final prop signature `(lessonId, courseId, currentTier)`. Task 3 replaced it in-place. Documented in the stub's docstring + Task 3 commit message. Applies the stub-then-replace pattern from memory feedback_stub_then_replace_sibling_collision in a within-plan flavor.
- **Files modified:** leanshot/src/components/course/LessonPlayerView.tsx (created in Task 2, rewritten in Task 3)
- **Commit:** e048e03b (stub) → a62d3870 (full)

**2. [Rule 2 - Critical Missing] `course_lessons.resources jsonb` column not in 46-01 schema.**
- **Found during:** Task 3 pre-flight (greppped `supabase/migrations/20270725000001_p46_course_schema.sql` for `resources` — no match).
- **Issue:** Plan 46-01 SUMMARY did not include the column referenced by COURSE-06 + this plan's LessonResourceList + Plan 46-09's LessonResourceUploader. Without the column the consumer view + admin uploader both break.
- **Fix:** Added supplemental migration `supabase/migrations/20270725000006_p46_course_lessons_resources_column.sql` (idempotent `add column if not exists`). Filename timestamp 000006 is the next free slot after Plan 46-02..05's 000005. Extended `CourseLesson` type with `resources: LessonResource[]` + new `LessonResource` shape. Updated `CourseDetailView` PostgREST select string to include the column.
- **Files modified:** supabase/migrations/20270725000006_p46_course_lessons_resources_column.sql (new); leanshot/src/lib/course/course-types.ts; leanshot/src/components/course/CourseDetailView.tsx
- **Commit:** a62d3870

**3. [Rule 1 - Bug] `renderPostBodyHtml(string)` is the wrong signature.**
- **Found during:** Task 2 tsc.
- **Issue:** Phase 44's `renderPostBodyHtml` takes `{ body, deleted_at }` shape (post-flavored), not bare markdown string. Mis-import would have failed tsc.
- **Fix:** Switched both call sites (CourseDetailView + LessonPlayerView) to `sanitizeCommunityMarkdown(string)` — same dompurify policy, plain string in / sanitized HTML out.
- **Files modified:** leanshot/src/components/course/CourseDetailView.tsx; leanshot/src/components/course/LessonPlayerView.tsx
- **Commit:** e048e03b (CourseDetailView path) + a62d3870 (LessonPlayerView path)

**4. [Rule 3 - Blocking] supabase-js `rpc()` return type mismatch with ProgressRpcClient narrow interface.**
- **Found during:** Task 3 tsc (LessonPlayerView wiring createProgressSyncer with the real supabase client).
- **Issue:** supabase-js v2 `rpc()` returns a `PostgrestFilterBuilder` (thenable) which is missing `Promise.catch`/`finally`/`Symbol.toStringTag`. The `ProgressRpcClient` narrow contract demands a strict `Promise<{data,error}>`.
- **Fix:** Cast at the single call site: `supabaseClient: supabase as unknown as ProgressRpcClient`. The narrow contract only needs `rpc()` to return a thenable resolving to `{data,error}` — which `PostgrestFilterBuilder` does at runtime. Exported `ProgressRpcClient` type from course-progress.ts to enable the cast import.
- **Files modified:** leanshot/src/components/course/LessonPlayerView.tsx
- **Commit:** a62d3870

**5. [Rule 2 - Critical Missing] `TAB_TITLES` Record exhaustiveness broken by new TabId.**
- **Found during:** Task 1 tsc (after widening TabId).
- **Issue:** `src/lib/constants.ts:122` declares `TAB_TITLES: Record<TabId, {title, sub}>` — TypeScript correctly errored that `classroom` was missing.
- **Fix:** Added `classroom: { title: 'Classroom', sub: 'Courses, lessons, and earned certificates' }` to the record.
- **Files modified:** leanshot/src/lib/constants.ts
- **Commit:** b5b221fd

### No architectural deviations (Rule 4). All issues were mechanical scope additions.

## Outstanding follow-ups

- **db push:** the new migration `20270725000006_p46_course_lessons_resources_column.sql` needs `supabase db push --linked` at phase close-out (per memory feedback_phase_close_out_db_push_verification). Cannot be pushed mid-plan because the timestamp would block earlier migrations from re-applying cleanly. The phase close-out plan (46-11) should sweep this with Plan 46-09's migrations.
- **Playwright @phase46 (Plan 46-11):** end-to-end walk of course list → detail → lesson player → mark complete → cert-ready card. The consumer surface is ready; the suite needs at least one seeded course with a Ready Mux asset to exercise the full happy path. Plan 46-11 owns the seeding + Playwright spec.
- **HUMAN UAT (deferred to milestone close-out):** visually verify the mobile bottom-nav strip with 11 entries scrolls smoothly on iOS Safari (the layout uses existing `overflow-x-auto scrollbar-none` so should not regress, but worth a real-device check). Add to the M4 milestone UAT checklist.
- **Bundle budget telemetry:** course-player at 6.55 kB / 30 kB leaves 78% headroom — Plan 46-09 admin CourseEditor (sibling-wave) may push additional code into the chunk if it routes its files under `src/components/course/`. Admin code SHOULD live under `src/admin/modules/courses/` per Plan 46-09's frontmatter, so no chunk pollution expected. If it does land here, the ceiling has plenty of room.

## Known Stubs

None. All UI paths reach real data sources (supabase tables + RPCs + Edge Fns). The CourseListView's tier-aware locked-card surface is deferred to Plan 46-09 follow-up (the card grid renders all courses uniformly today; Plan 46-09 ships the per-course enrollment count + tier badge in the admin editor and adds a sibling card-level lock badge for Free users in a follow-up).

## Self-Check

Files exist (worktree-relative paths):
- ✅ leanshot/src/lib/course/course-progress.ts
- ✅ leanshot/src/lib/course/course-progress.test.ts
- ✅ leanshot/src/lib/course/course-storage.ts
- ✅ leanshot/src/components/course/ClassroomTabShell.tsx
- ✅ leanshot/src/components/course/CourseListView.tsx
- ✅ leanshot/src/components/course/CourseDetailView.tsx
- ✅ leanshot/src/components/course/CourseSidebar.tsx
- ✅ leanshot/src/components/course/LessonPlayerView.tsx
- ✅ leanshot/src/components/course/LessonResourceList.tsx
- ✅ supabase/migrations/20270725000006_p46_course_lessons_resources_column.sql

Commits exist (`git log --oneline`):
- ✅ b5b221fd feat(46-08): foundation
- ✅ e048e03b feat(46-08): ClassroomTabShell + views
- ✅ a62d3870 feat(46-08): LessonPlayerView + LessonResourceList + resources column

## Self-Check: PASSED
