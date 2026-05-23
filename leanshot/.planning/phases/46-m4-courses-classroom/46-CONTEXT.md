# Phase 46: M4 Courses / Classroom - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Self-paced course platform with a 3-level hierarchy (course → module → lesson). Each lesson supports a Mux video (≤30 min, signed JWT playback, auto-captioned English), markdown notes, and downloadable resources (Pro/Lifetime-gated). Lesson progress = per-lesson binary completion with last-watched-timestamp resume across devices; lessons require ≥95% Mux playback to mark complete (anti-skip). Course completion (100% required lessons done) triggers a server-side Edge Fn that generates a fixed-template jsPDF certificate stored in Supabase Storage; certificate carries a public verifiable URL `/verify/<cert_id>` with HMAC-signed token. Landing pages ship single-template in v1 (Phase 39 PAGEAB-06 retrofits per-block variants later — stub-then-replace cross-phase pattern). Reuses Phase 44's Mux Edge Fns + uploader/player primitives; Phase 43's `tier_effective` for resource gating; Phase 15/31's dnd-kit primitives for admin reordering.

**Out of scope:** Per-block A/B variants on landing pages (→ Phase 39 retrofit). Live cohort-based courses (course platforms ship self-paced only in v1; "cohort" courses with scheduled drips deferred). DRM (Widevine/FairPlay — signed playback URLs are sufficient v1; expensive Mux DRM defer). Course completion leaderboards. Per-template editor / admin theme customization. Group enrollments / team licenses.

</domain>

<decisions>
## Implementation Decisions

### Schema + Hierarchy + Free Preview

- **D-01:** Hierarchy = **course → module → lesson** (3-level). Tables: `courses (id, title, slug, description, cover_url, completion_threshold_pct default 100, enforce_completion boolean default true, …)`, `course_modules (id, course_id FK, title, order_index, …)`, `course_lessons (id, module_id FK, title, content_md, mux_asset_id, mux_playback_id, duration_seconds, is_free_preview boolean default false, is_required boolean default true, order_index, …)`. Supports large courses (20+ lessons) without flat-list UX collapse.
- **D-02:** Free-preview default = **first lesson of each course free** (lead-magnet pattern). Implemented by computing `(SELECT id FROM course_lessons WHERE module_id IN (SELECT id FROM course_modules WHERE course_id=$1 ORDER BY order_index ASC LIMIT 1) ORDER BY order_index ASC LIMIT 1)` as the "free preview" lesson. Admin can override via `course_lessons.is_free_preview boolean` (no UI control in v1; manual SQL for any non-default override).
- **D-03:** Admin reordering UX = **dnd-kit drag/drop** for both modules-within-course AND lessons-within-module. REUSE Phase 15 page-builder + Phase 31 onboarding-builder primitives — do NOT introduce a new drag lib. `order_index` written on drop; optimistic UI.
- **D-04:** All lessons **required for completion** (per D-11). No per-lesson optional/skip in v1. Optional/FAQ lessons deferred — admin can author them as a separate non-required Module if needed (which would defer completion until 100%).

### Mux Video Specifics for Courses

- **D-05:** Lesson video constraint = **30 min max length / 2 GB max upload size, ONE video per lesson**. Enforced both client-side (Mux uploader `maxDuration: 1800`) and server-side (mux-webhook rejects assets exceeding `max_duration_seconds` → marks `mux_status='rejected'` on the lesson). The video upload uses the SAME `mux-create-upload` + `mux-webhook` Edge Fns from Phase 44 with a NEW `kind: 'course-lesson'` discriminator and `passthrough: { lesson_id, course_id }`.
- **D-06:** Mux auto-captions = **default-ON for English** (`mux.assets.create({ ...input, generated_subtitles: [{ language_code: 'en', name: 'English (auto)' }] })`). Cost ~$0.04/min added to encode. Spanish captions deferred to Phase 32 i18n alignment (additional ~$0.04/min/lang). Admin per-lesson opt-out via `course_lessons.captions_enabled boolean default true`. Captions show via Mux Player default UI.
- **D-07:** Playback security = **Mux signed playback URLs (JWT, time-limited)**. `course_lessons.mux_playback_id` is the signed-policy ID; client requests playback via `supabase.functions.invoke('mux-sign-playback', { lesson_id })` Edge Fn which checks tier entitlement (Pro/Lifetime per `tier_effective.has_active`) AND course enrollment (TBD: free preview gating logic — see D-02), then signs a Mux JWT with `aud='v'`, `sub=<playback_id>`, `exp=<now + 4h>`. URL not shareable cross-user. Full Mux DRM (Widevine/FairPlay) deferred — signed URLs are sufficient v1.
- **D-08:** Thumbnail = **Mux auto-thumbnail at 1s mark** (mirrors Phase 44 D-07). `image.mux.com/${playback_id}/thumbnail.jpg?time=1` rendered via signed thumbnail URLs (same JWT-sign Edge Fn covers thumbnail tokens). No admin custom thumbnail in v1; defer.

### Progress + Completion + Anti-Skip

- **D-09:** Progress granularity = **per-lesson binary completion + last-watched-timestamp for resume**. Table: `lesson_progress (user_id, lesson_id, course_id, completed_at timestamptz, last_position_seconds integer, last_seen_at timestamptz, PRIMARY KEY (user_id, lesson_id))`. Lesson marked complete when user reaches ≥95% playback (anti-skip per D-12).
- **D-10:** Sync cadence = **every 15 seconds debounced** via Mux Player `onTimeUpdate` event. ~120 writes per 60-min lesson (worst case); use `UPDATE … SET last_position_seconds=$1, last_seen_at=now() WHERE user_id=$2 AND lesson_id=$3` (no realtime broadcast — cross-device resume happens on next mount via `SELECT last_position_seconds`). Tab-close handled via `navigator.sendBeacon('/api/lesson-progress')` to catch the final position.
- **D-11:** Course completion threshold = **100% of required lessons** (matches D-04 "all required"). Admin per-course override via `courses.completion_threshold_pct integer default 100` (allows 80% / 90% for non-credentialing courses). Computed as `(count required completed) / (count required) >= threshold/100`.
- **D-12:** Anti-skip = **≥95% Mux playback required to mark a lesson complete**. Mux-webhook event handler updates a transient `lesson_progress.max_position_reached_seconds` field on every `video.view` event; the client's "Mark complete" button is only enabled when `max_position_reached_seconds / duration_seconds >= 0.95`. Server-side double-check on the `complete_lesson` Edge Fn rejects if the threshold isn't met. Admin per-course toggle via `courses.enforce_completion boolean default true`; uncheck → trust user (no anti-skip) for informational/optional courses.

### Certificate Generation + Verification

- **D-13:** Cert generation = **server-side on completion via Edge Fn**. New `generate-course-certificate` Edge Fn triggers (a) automatically when `complete_course` is called after 100% completion check, or (b) via admin re-issue button (`/admin/courses/<id>/users/<user_id>/re-issue-cert`). Cached in Supabase Storage `certificates/{user_id}/{course_id}-{cert_id}.pdf`. Signed download URL (60-min TTL) returned to user; stable cert→PDF mapping via `certificates (id, user_id, course_id, issued_at, version, pdf_path, verification_token text UNIQUE)`.
- **D-14:** Verification URL = **public `/verify/<cert_id>` page** with HMAC-signed token embedded in cert PDF. Token shape: `base64url(HMAC-SHA256(cert_id + user_id + course_id + issued_at, CERT_VERIFICATION_SECRET))` — same base64url replace-chain as Phase 43's HMAC mint (per memory `reference_base64url_postgres_vercel_mint_verify`). Verification page reads `certificates` row by `cert_id`, validates HMAC token from URL param against stored token, then renders proof card (user name, course title, completion date, "Verified by LeanShot" badge). NOT indexable (`<meta name="robots" content="noindex">`) but accessible to anyone with the URL.
- **D-15:** PDF template = **single fixed jsPDF template, brand-themed**. Interpolated: `{user.full_name}`, `{course.title}`, `{completed_at | format 'MMM D, YYYY'}`, `{verification_url}` (rendered as both visible text + QR code via `qrcode.react` already in stack?). Brand colors from `src/index.css` Tailwind tokens. NO per-course customization in v1. NO admin layout editor.

### Phase 39 Cross-Phase Dependency

- **D-16:** Landing-page A/B = **stub-then-replace (cross-phase pattern, per memory `feedback_cross_phase_queue_table_pattern`)**. Phase 46 ships single-template landing pages (`/courses/<slug>` route reuses Phase 15 PageBuilder with the 3 admin-picked templates: long-form sales / outcome-focused / FAQ-heavy — but NO per-block A/B variants). Phase 39 PAGEAB-06 retrofits per-block variants AFTER Phase 39 executes; no Phase 46 schema changes needed because `page_variant_id` already exists on Phase 15 blocks. Phase 46 plan-checker should NOT block on Phase 39 not being executed yet.

### Claude's Discretion

- Resource-download tier-gating implementation — reuse Phase 44's tier-gate.ts isVideoAllowed pattern but for "isResourceAllowed(tier, resource)". Confirm Phase 43 `tier_effective.has_active` boolean (vs `tier_label`).
- Mux signed-URL signing key — store as Supabase Function Secret `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` (separate from `MUX_TOKEN_*`). New secret-set step in Wave 0; vendor pre-flight check per memory `feedback_vendor_secret_preflight_surface`.
- QR code library — researcher confirms whether `qrcode.react` or `qrcode` is already shipped (Phase 42 PWA might have one); if not, planner picks lightest (`qrcode` npm ≈ 20kB gz; isolated chunk).
- Whether course list page uses PageBuilder or a fixed `/courses` index — recommend fixed index (simpler, faster); landing pages individually use PageBuilder.
- HMAC secret for cert verification: new Supabase Function Secret `CERT_VERIFICATION_SECRET`. NOT a `VITE_*` var (private). Generate via `openssl rand -hex 32`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 46 Source-of-Truth

- `.planning/ROADMAP.md` §Phase 46 (lines 621–634) — Goal, dependencies, success criteria, requirements binding
- `.planning/REQUIREMENTS.md` §COURSE-01..06 (lines 266–271) — Requirement-by-requirement scope

### Upstream Locks (cross-phase contracts that constrain this phase)

- `.planning/phases/44-m4-community-feed-foundation/` — Mux Edge Fns (`mux-create-upload` + `mux-webhook` deployed; reuse with new `kind: 'course-lesson'` + `passthrough: { lesson_id, course_id }`); @mux/mux-uploader-react + @mux/mux-player-react in package.json; bundle ceiling pattern; tier-gate.ts.
- `.planning/phases/43-m4-membership-tiers-extension/` — `tier_effective.has_active` (Pro/Lifetime) for D-07 + D-16 resource entitlement.
- `.planning/phases/15-page-builder/` (or wherever PageBuilder ships) — PageBuilder block schema (Phase 46 reuses 3 admin templates). `page_variant_id` column exists on blocks (forward-compat with Phase 39 PAGEAB-06).
- `.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/` — dnd-kit primitives + onboarding-builder pattern (reuse for module/lesson reordering per D-03).
- `.planning/phases/39-a-b-trifecta/` — PAGEAB-06 per-block variants (PLANNED, not executed). Phase 46 ships v1 landing pages WITHOUT this dependency; Phase 39 retrofits later per D-16.
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-posthog/` — bundle-budget gate; new `course-player` chunk ≤30 kB gz (per ROADMAP success criterion #2).
- `.planning/phases/42-v1-3-polish-closeout/` — PWA web push (could power "lesson released" notifications; defer to v2). PDF download UX patterns.

### Shared Infrastructure (re-use, don't re-invent)

- `supabase/functions/mux-create-upload/index.ts` (Phase 44) — extend with `kind: 'course-lesson'` branch; tier-gate stays the same (Pro/Lifetime/Trial upload).
- `supabase/functions/mux-webhook/index.ts` (Phase 44) — extend handler for `video.view` events (D-12 anti-skip max-position tracking) and `video.asset.ready` for lessons.
- `src/components/community/media/CommunityMediaUploader.tsx` (Phase 44) — fork to `src/components/courses/admin/LessonVideoUploader.tsx` with tighter constraints (30 min vs 5 min).
- `src/components/community/media/CommunityVideoPlayer.tsx` (Phase 44) — fork to `src/components/courses/LessonPlayer.tsx` adding signed-playback URL fetching + `onTimeUpdate` progress tracking.
- `src/lib/community/tier-gate.ts` (Phase 44 Wave 0) — extend with `isResourceAllowed(tier_label, resource_type)` for D-16 Pro-gated resource downloads.
- `src/lib/community/community-storage.ts` (Phase 44) — fork pattern for new `course-resources` Storage bucket (Pro-gated resources; PDF/MP4/ZIP MIME whitelist).
- `src/lib/sync-defer.ts` (Phase 5) — idle-deferred init wrapper. Mux Player + dnd-kit MUST route through this for the `course-player` chunk to fit under 30 kB gz.
- Phase 35 leaderboard handle scheme — NOT needed for v1 courses (no leaderboard). Documented in Deferred Ideas.
- jsPDF (v1.2 stack) — used for D-15 certificate generation.
- Phase 31 dnd-kit primitives — reuse for admin reorder UX per D-03.

### External Library Refs (for researcher's Context7 sweep)

- `@mux/mux-node` — already in supabase/functions (Phase 44); use `assets.create({ generated_subtitles })` for captions per D-06; use `Mux.Webhooks.verifyHeader(...)` (already wired).
- Mux Signed-URL JWT signing — `jose` or `jsonwebtoken` (Deno-compatible); researcher confirms which Phase 25 already uses for HMAC.
- `qrcode` or `qrcode.react` — for D-14 cert verification QR code. Researcher checks if already shipped.
- jsPDF — confirm v1.2 install version + any required jspdf-autotable for layout.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 44 Mux pipeline** — `mux-create-upload` + `mux-webhook` Edge Fns are deployed and tested. Phase 46 extends with `kind` discriminator (cleanest evolution; no new endpoints).
- **Phase 44 `community-media` chunk routing** — `vite.config.ts` already isolates `@mux/*` packages and `src/components/community/media/*`. Phase 46 adds `src/components/courses/` path-isolated chunks: `course-player` (≤30 kB gz) and `course-admin` (admin module; bundle separately from course-player).
- **Phase 43 `tier_effective.has_active`** — boolean for Pro/Lifetime entitlement. D-07 + D-16 read this directly.
- **Phase 31 dnd-kit primitives** — module/lesson reorder UI inherits from onboarding-builder. No new drag lib.
- **Phase 44 dompurify-config** — lesson `content_md` rendered via the same sanitize pipeline. NO new policy.
- **jsPDF in v1.2 stack** — D-15 cert generation; researcher confirms exact import path.

### Established Patterns

- **Per-fn `deno.json` for Edge Fns** (per memory `reference_supabase_functions_deploy_import_map_flag` + Phase 44's mux-create-upload). The new `mux-sign-playback` + `generate-course-certificate` Fns each get their own `deno.json`.
- **HMAC base64url consistency** (per memory `reference_base64url_postgres_vercel_mint_verify`) — D-14 cert verification token follows the same replace-chain as Phase 43's mint/verify.
- **Anti-skip via Mux webhook** — `video.view` events trigger `max_position_reached_seconds` updates (D-12). Mux already sends these; new handler branch in mux-webhook.
- **Vendor secret pre-flight** (per memory `feedback_vendor_secret_preflight_surface`) — Mux signing key + cert HMAC secret surfaced at Wave 0 dispatch; operator sets in parallel with execute.
- **Cross-phase queue/stub pattern** (per memory `feedback_cross_phase_queue_table_pattern`) — Phase 46 ships landing-page templates with `page_variant_id` column already populated to a default; Phase 39 PAGEAB-06 retrofit just adds variant rows. Schema is forward-compatible.
- **Notification CHECK widening NOT needed for v1** — no course-completion email notification in v1 scope (in-app toast only). If admin asks for completion-emails later, that triggers another CHECK widening per Phase 44 44-02 / Phase 45 plan pattern.

### Integration Points

- **`course-lesson` Mux events route to `mux-webhook`** — same Fn as Phase 44; new branch dispatches by `passthrough.kind`.
- **`generate-course-certificate` Edge Fn** — triggered by `complete_course` RPC after 100% threshold check; writes to `certificates` table + uploads PDF to `certificates` Storage bucket. NEW bucket; private; signed-URL access only.
- **`/verify/<cert_id>` route** — NEW public route (not behind auth). Uses Phase 28 RLS on `certificates` table with `SELECT … WHERE id = $1 AND HMAC matches` (security via HMAC, not auth).
- **Admin Course Editor** — new admin module under `src/admin/modules/courses/` following pathname-based routing pattern matched to ReviewsLayout/CommunityAdminLayout (per memory `reference_react_router_consumer_admin_split` refined).
- **Course consumer surface** — NEW top-level TabId `'classroom'` (NOT under 'community'). Course list at root of tab; drill-in to course → module → lesson via local Zustand state (`activeCourseId`, `activeLessonId`). Reuses Phase 45 sub-view pattern.

</code_context>

<specifics>
## Specific Ideas

- Teachable / Skool / Thinkific course UX as the visual reference. Mux Player default UI + minimal chrome on the lesson page.
- Lesson page layout: 16:9 video top, markdown notes below, "Mark complete" CTA (enabled at ≥95%), prev/next-lesson nav, sidebar of all modules/lessons with completion checkmarks.
- Cert design: landscape 11×8.5" PDF; brand-gradient border; bold course title; user's full name in calligraphic font; date + verification URL + QR code in lower-right.
- The "first lesson free" pattern is deliberate lead-magnet psychology — hook on lesson 1 + immediate paywall.
- 95% watching threshold matches Coursera/Udemy convention; balances anti-cheat with users who may skip end-credits.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 39 PAGEAB-06 per-block variants** — schema-compatible now (page_variant_id column); Phase 39 retrofits when executed.
- **Spanish auto-captions** — Phase 32 i18n alignment; ~$0.04/min/lang additional cost.
- **Full Mux DRM (Widevine/FairPlay)** — signed JWT URLs sufficient for v1; DRM defer to clinical-content phase if needed.
- **Cohort-based / drip courses** — release-on-schedule lessons; defer to v2.
- **Course completion leaderboards** — community leaderboard pattern from Phase 45 applies; defer.
- **Admin re-issue cert UI** — D-13 covers the Edge Fn endpoint; admin UI deferred to v2.
- **Admin custom cert template editor** — single fixed template in v1; editor defer.
- **Admin custom lesson thumbnail upload** — auto-thumbnail at 1s in v1; admin upload defer.
- **Lesson chapters / per-segment progress** — per-lesson binary in v1; chapter authoring + per-chapter progress defer.
- **Group enrollments / team licenses** — single-user purchases in v1; team SKU defer.
- **Course "drafts" + scheduled publish** — admin authors → publish immediately in v1; scheduling defer.
- **Course completion email** — in-app toast only in v1; email cert delivery would trigger notification CHECK widening (defer).

</deferred>

---

*Phase: 46-M4 Courses / Classroom*
*Context gathered: 2026-05-23*
