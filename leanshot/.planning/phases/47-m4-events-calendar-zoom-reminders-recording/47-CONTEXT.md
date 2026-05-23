# Phase 47: M4 Events Calendar + Zoom + Reminders + Recording - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Events platform layered onto Phase 44's community_spaces — every event lives in a space (space_id NOT NULL), so org-private vs global visibility, tier-gating, and RLS predicates are derived from the space, not duplicated on events. Admins create events (title + description + start_at + end_at + capacity + space_id + visibility/RSVP settings + optional Zoom OAuth meeting OR pasted meet URL). Users RSVP Going / Maybe / Not Going via a SECURITY DEFINER RPC that takes a row-level `SELECT FOR UPDATE` on `events` to enforce capacity atomically, returning either `going` or `waitlist`. When a `going` RSVP cancels, an AFTER UPDATE/DELETE trigger on `event_rsvps` promotes the head of the waitlist synchronously (ordered by `waitlist_position`) and queues a promotion email via `_shared/email-router.ts` (PHI flag derived from `community_spaces.org_id IS NOT NULL`). Meeting deep-links never sit in client-visible event rows — clients call `event-join-url` Edge Fn which verifies `rsvp_status='going'` before returning the URL (mirrors `mux-sign-playback` access-check pattern). Reminders fire via hourly `pg_cron` + per-user-timezone fan-out Edge Fn (mirror Phase 38 weekly-digest verbatim) using `profiles.timezone` (IANA, default `America/New_York`); idempotent via `event_reminder_sent (event_id, user_id, kind)` UNIQUE. Post-event admin uploads the recording via the existing Mux uploader; `mux-webhook` `video.asset.ready` handler reads the event's `attach_to_module_id` (pre-configured at event creation) and INSERTs a new `course_lessons` row in the target module (Phase 46 schema). Calendar surface = new top-level TabId `events` (parallel to `classroom`), list-only chronological layout (no new calendar lib), reusing existing Card primitives.

**Out of scope:** Recurring events (RRULE), iCal/.ics export, Zoom Cloud Recording auto-pull (admin uploads manually via Mux), web-push reminders, in-app "starting in 1h" banner, Google Meet / Whereby / Teams OAuth (paste-link only for non-Zoom), per-admin or per-org Zoom OAuth (platform-shared account only), multi-host/co-organizer events, event polls / Q&A / event-specific chat thread, month-grid calendar layout, native mobile push notifications, standalone (space_id NULL) events.

</domain>

<decisions>
## Implementation Decisions

### Schema + Scoping + Capacity + Waitlist

- **D-01:** Event ↔ space relationship = **`events.space_id NOT NULL`** (every event lives in a `community_spaces` row). Org-scoped vs global derived from `community_spaces.org_id IS NOT NULL`. RLS on `events` reuses the Phase 44 D-08/D-09 space predicates verbatim (`min_tier` + `org_id` membership). No standalone/platform-wide events in v1. Schema: `events (id uuid pk, space_id uuid not null references community_spaces(id) on delete cascade, title text not null, description text, start_at timestamptz not null, end_at timestamptz not null, capacity integer not null default 0 /* 0 = unlimited */, join_url text, zoom_meeting_id text, zoom_managed boolean not null default false, attach_to_module_id uuid references course_modules(id), cover_url text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (end_at > start_at))`. Indexes: `(space_id, start_at)`, `(start_at)` for the fan-out cron.

- **D-02:** Capacity enforcement = **SECURITY DEFINER RPC `event_rsvp_create(p_event_id, p_status)` with `SELECT FOR UPDATE` on the events row**. Mirrors Phase 35 freeze-token pattern + Phase 44 reaction-toggle RPC. Atomic: locks the row, counts current `going` rows, branches to `going` if `count < capacity OR capacity = 0`, else `waitlist` (with `waitlist_position = (SELECT coalesce(max(waitlist_position),0)+1 FROM event_rsvps WHERE event_id=p_event_id AND status='waitlist')`). Returns enum `('going','waitlist')`. Per memory `reference_postgres_no_insert_on_conflict_do_delete` — use `SELECT FOR UPDATE` + branch INSERT/UPDATE, NOT `ON CONFLICT DO …`. RPC body searchable for `auth.uid()` per memory `feedback_rpc_auth_uid_vs_service_role_mismatch` — RSVP is user-initiated, not service-role; `auth.uid()` is fine.

- **D-03:** Waitlist promotion = **`AFTER UPDATE OR DELETE ON event_rsvps` trigger, synchronous**. When a row transitions from `status='going'` to anything else (or is deleted), the trigger selects the head of the waitlist (`ORDER BY waitlist_position ASC LIMIT 1 FOR UPDATE SKIP LOCKED`), updates its `status` to `going`, sets `waitlist_position = NULL`, and INSERTs an `event_promotion_queue` row (event_id, user_id, promoted_at) that the reminder fan-out Fn drains into a "you've been promoted" email next hourly tick. Order = strict FIFO via `waitlist_position`. No cron, no race window. Trigger uses `app.suppress_audit` GUC per memory `reference_supabase_migration_gotchas` if cascading writes hit audit log.

- **D-04:** PHI marker for email routing = **derive `phi: <space.org_id IS NOT NULL>` at template-render time**. NO new `events.is_phi` column. Reuses Phase 25 D-03 (`_shared/email-router.ts` switches Resend vs SES on template's `phi:boolean`). Org-scoped event → SES. Global space event → Resend. Locked.

- **D-05:** RSVP status enum = **`('going','maybe','not_going','waitlist')`** stored as Postgres `text` with `CHECK` constraint (matches Phase 44 idiom; avoids enum-migration pain). `rsvp_create` RPC enforces "client can request `going` or `maybe` or `not_going`; only the RPC can write `waitlist`".

### Zoom Integration

- **D-06:** Zoom integration depth = **paste-link AND Zoom OAuth auto-generate (both ship v1)**. Matches ROADMAP success criterion #3 verbatim. Event-create form has a radio: "Paste meeting URL" (any provider) vs "Generate Zoom meeting" (platform-shared OAuth). On "Generate", `zoom-create-meeting` Edge Fn calls Zoom Meeting API with the platform-shared Server-to-Server OAuth token (cached in vault.decrypted_secrets) and writes `zoom_meeting_id` + `join_url` back. `events.zoom_managed = true` flags the row for future cleanup (Zoom meeting deletion on event delete).

- **D-07:** Zoom OAuth account model = **platform-shared Server-to-Server OAuth (one LeanShot Zoom user, all generated meetings under it)**. Single OAuth token in `vault.decrypted_secrets` (name='zoom_s2s_token') + auto-refresh handler. Trade-off: meetings show "LeanShot" as host, not the actual event organizer. Acceptable for community events. Per-admin and per-org OAuth deferred (no clinic ask yet). Per memory `reference_supabase_pg_cron_vault_service_role_pattern` — same vault-row + hardcoded URL pattern for any future cron-driven Zoom call.

- **D-08:** Other providers (Google Meet / Whereby / Teams / Jitsi) = **paste-link only**. No additional OAuth integrations v1. EVENT-03 phrase "Zoom / Google Meet integration" is satisfied: Zoom via OAuth + Meet via paste-link.

- **D-09:** Meeting deep-link visibility = **Edge Fn `event-join-url` validates `rsvp_status='going'` before returning the URL**. RLS on `events.join_url` + `events.zoom_meeting_id` hides those columns from anyone who isn't (a) the admin who created the event OR (b) an RSVP'd 'going' attendee. Client never sees the URL in the events row — click "Join meeting" → Edge Fn → URL. Mirrors `mux-sign-playback` access-check shape. Logged-out / non-attendee click → 403 + "RSVP to see the meeting link".

### Reminder Pipeline

- **D-10:** Reminder cron architecture = **hourly `pg_cron 0 * * * *` → Edge Fn `event-reminders-fanout` → per-user-timezone scan**. Mirrors Phase 38 weekly-digest fan-out verbatim (per memory `reference_supabase_pg_cron_vault_service_role_pattern` + dollar-quote nesting per `reference_postgres_dollar_quote_nesting_in_cron_body` — use outer `$cron$` + inner `$reminders$` tags). Fan-out logic:
  - For every (event, user) where `rsvp_status='going'`, compute `local_start_at = event.start_at AT TIME ZONE profiles.timezone`.
  - If `local_start_at - now() AT TIME ZONE profiles.timezone` falls in `[23h, 25h)` → fire kind=`'1d'` reminder (if not already sent).
  - If `local_start_at - now() AT TIME ZONE profiles.timezone` falls in `[0h, 2h)` → fire kind=`'1h'` reminder (if not already sent).
  - Also drains `event_promotion_queue` (D-03) into "you've been promoted from waitlist" sends.
  - Idempotent via `INSERT INTO event_reminder_sent (event_id, user_id, kind) … ON CONFLICT DO NOTHING` — UNIQUE constraint `(event_id, user_id, kind)` where kind ∈ `('1d','1h','promotion')`.

- **D-11:** Reminder channels = **EMAIL ONLY v1**. NO web-push reminders, NO in-app banner. Deliberate scope trim. Phase 42's `push_subscriptions` table is NOT consumed by Phase 47. Documented in Deferred Ideas. Operator preferred trim despite [[feedback_aggressive_foundations]] default — events reminder channel surface is narrow enough that hybrid email+push doesn't justify the build cost yet.

- **D-12:** Reminder cron granularity = **1h** (matches the cron tick). The `[23h,25h)` / `[0h,2h)` windows absorb the ±1h cron-tick drift. UNIQUE constraint guarantees at-most-once per kind. No finer (15-min) cron in v1.

### Calendar UI + Recording Workflow

- **D-13:** Calendar surface = **new top-level TabId `'events'`** in the consumer App.tsx switch. Position between `'classroom'` and `'community'` in the nav. Widens `TabId` union in `src/types/index.ts` (per memory `reference_react_router_consumer_admin_split` — consumer surface uses TabId, not react-router; admin still uses `react-router-dom`). Logged-out marketing visitors don't see the tab. Tier-gating handled per-event by the space's `min_tier` (Phase 44).

- **D-14:** Calendar layout = **list-only chronological** (upcoming events first, then past). NO month-grid library in v1. Reuses existing `Card` + `Sheet` primitives. Filters by space + date range via existing community filter chips. Bundle ceiling protected (per Phase 24 D-bundle). Month-grid + `@schedule-x/react` deferred to v2 if usage data justifies.

- **D-15:** Recording → lesson attachment = **admin pre-configures target at event creation; `mux-webhook video.asset.ready` auto-attaches**. Event-create form has optional "Attach recording to" picker (Course → Module dropdown; reuses Phase 46 course_modules query). Saved as `events.attach_to_module_id`. Post-event: admin clicks "Upload recording" → existing Mux uploader (`mux-create-upload` with NEW `kind: 'event-recording'` discriminator + `passthrough: { event_id }`). Webhook handler branches on `passthrough.kind === 'event-recording'`:
  1. Reads `events.attach_to_module_id` for the `event_id`.
  2. If non-null: INSERTs into `course_lessons` (module_id, title=`<event.title> recording`, mux_asset_id, mux_playback_id, duration_seconds, is_free_preview=false, is_required=false, order_index=`(SELECT coalesce(max(order_index),0)+1 …)`). Lesson is `is_required=false` so it doesn't break course completion math (Phase 46 D-04 / D-11).
  3. If null: just stores `events.recording_mux_asset_id` + `events.recording_playback_id` (event card shows the recording inline; no lesson created).

- **D-16:** Event covers / images = **optional `cover_url`, stored in NEW `event-covers` Supabase Storage bucket**. Path-prefix `event-covers/{event_id}/{filename}`. RLS = admin (creator) writes; public read (matches Phase 44 `community-media` pattern for non-PHI; org-scoped events still public-bucket because the *event row* gates visibility via RLS, not the asset). MIME whitelist (image/jpeg, image/png, image/webp) + 2MB cap.

### Claude's Discretion

- Exact Zoom Server-to-Server OAuth SDK / npm package — researcher confirms latest Deno-compatible. Likely direct `fetch` to `https://api.zoom.us/v2/users/me/meetings` with bearer token; no SDK needed.
- Zoom token refresh handler — S2S tokens are 1h TTL; either fetch-on-demand and cache in-memory (Edge Fn cold start), or pre-refresh via separate cron. Researcher recommends.
- `event_rsvp_create` RPC return shape — researcher picks between custom composite type vs JSONB.
- Promotion email subject line / template — copywriter task, not planner concern.
- TabId 'events' icon (lucide-react) — `Calendar` or `CalendarDays`. Planner picks.
- Whether `events.zoom_managed=true` events need a Zoom-side cleanup hook on event delete — researcher confirms whether dangling Zoom meetings cost anything; defer cleanup unless meaningful.
- Whether to also show past events with recordings on the events tab (acts like a "video archive") — recommend YES for engagement, but if planner thinks scope-creep, can defer.
- HMAC orchestrator auth for `event-reminders-fanout` Edge Fn — reuse Phase 38 winback pattern (per memory `reference_supabase_service_role_key_format_divergence`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 47 Source-of-Truth

- `.planning/ROADMAP.md` §Phase 47 — Goal, dependencies, success criteria, requirements binding
- `.planning/REQUIREMENTS.md` §EVENT-01..05 — Requirement-by-requirement scope

### Upstream Locks (cross-phase contracts that constrain this phase)

- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` D-03 — `_shared/email-router.ts` switches Resend (non-PHI) vs SES (PHI) on template `phi:boolean`. Phase 47 D-04 derives `phi` from `community_spaces.org_id IS NOT NULL`. NEVER bypass the router.
- `.planning/phases/38-m5b-ai-recommender-pgvector-claude-digest/38-CONTEXT.md` — pg_cron hourly fan-out + per-user-TZ scan + vault.decrypted_secrets service_role pattern. Phase 47 D-10 mirrors verbatim.
- `.planning/phases/42-v1-3-polish-closeout/42-CONTEXT.md` — `push_subscriptions` table (NOT consumed in Phase 47 per D-11; documented in Deferred Ideas).
- `.planning/phases/43-m4-membership-tiers-extension/43-CONTEXT.md` — `tier_effective.has_active` (Pro/Lifetime) — referenced indirectly via `community_spaces.min_tier` RLS.
- `.planning/phases/44-m4-community-feed-foundation/44-CONTEXT.md` — `community_spaces` schema (org_id + min_tier); Mux pipeline (`mux-create-upload` + `mux-webhook`); tier-gate.ts; notify-community Edge Fn dual-auth pattern.
- `.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-CONTEXT.md` — Per-space RLS hardening; FOR UPDATE SKIP LOCKED idiom for promotions.
- `.planning/phases/46-m4-courses-classroom/46-CONTEXT.md` — `course_lessons` schema (attachment target per D-15); `course_modules` (parent of lessons); `mux-webhook` extension pattern (new `kind` discriminator).

### Live Schema Refs (verified 2026-05-23)

- `supabase/migrations/20270720000001_p44_community_schema.sql` — `community_spaces` (id, name, description, org_id nullable, min_tier text check ('free','pro','lifetime'), timestamps). FK target for `events.space_id`.
- `supabase/migrations/20270705000009_phase38_profiles_timezone.sql` — `profiles.timezone text NOT NULL DEFAULT 'America/New_York'` with IANA CHECK. Read directly in `event-reminders-fanout` Edge Fn.
- `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` — template for new cron job `phase47-event-reminders-hourly` (`0 * * * *` → HTTP invoke `event-reminders-fanout`).

### Shared Infrastructure (re-use, don't re-invent)

- `supabase/functions/_shared/email-router.ts` (Phase 25) — REQUIRED for all reminder + promotion email sends. Set `phi: space.org_id IS NOT NULL` on every template invocation.
- `supabase/functions/mux-create-upload/index.ts` (Phase 44, extended by Phase 46) — add NEW branch `kind === 'event-recording'` with `passthrough: { event_id }`.
- `supabase/functions/mux-webhook/index.ts` (Phase 44, extended by Phase 46) — add NEW handler branch for `passthrough.kind === 'event-recording'` per D-15.
- `src/lib/community/tier-gate.ts` (Phase 44 / 46) — reuse `isEventVisible(user_tier, space.min_tier, space.org_id, user.org_memberships)` predicate (already covers spaces; events inherit).
- `src/components/community/` — Card + Sheet patterns; admin forms; dnd-kit primitives (NOT needed for events v1 — list is chronological not reorderable).
- Phase 38 cron migration template — copy + rename `phase38-*` jobs → `phase47-event-reminders-hourly`. Reuse dollar-quote-tag pattern (`$cron$ … $reminders$`).
- Phase 38 HMAC orchestrator-auth pattern — `event-reminders-fanout` Fn validates HMAC of the payload + bearer = `sb_secret_*` token (per memory `reference_supabase_service_role_key_format_divergence`).

### External Library Refs (for researcher's Context7 sweep)

- **Zoom Meeting API (Server-to-Server OAuth)** — `POST /users/me/meetings`; token endpoint `POST /oauth/token?grant_type=account_credentials&account_id=<id>`. 1h TTL on access token. Researcher confirms exact scope set required (`meeting:write:admin` likely).
- **Mux Webhooks** — extend `video.asset.ready` handler. Already wired (Phase 44 + 46).
- **lucide-react** — already shipped. Pick `Calendar` or `CalendarDays` for the new TabId icon.
- **Postgres `AT TIME ZONE`** — used in fan-out cron predicate. No new dep.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 44 community_spaces** — events FK directly to it; RLS predicates inherit. `min_tier` + `org_id` gate everything without new policy code.
- **Phase 25 email-router** — drop-in for both reminder (1d/1h) and promotion (waitlist-promoted) sends. Set `phi` per space.
- **Phase 38 cron + fan-out template** — `event-reminders-fanout` is structurally identical to `weekly-digest-hourly-fanout`. Researcher diffs the two for shape consistency.
- **Phase 38 profiles.timezone** — already present + IANA-validated. Just read.
- **Phase 44 + 46 Mux pipeline** — `mux-create-upload` + `mux-webhook` extended with `kind: 'event-recording'`. Zero new endpoints.
- **Phase 46 course_lessons + course_modules** — D-15 INSERT target. `is_required=false` lessons don't affect course completion math.

### Established Patterns

- **SECDEF RPC + `SELECT FOR UPDATE`** for atomic capacity check (D-02) — Phase 35 freeze-token + Phase 44 reactions precedent.
- **AFTER trigger for cascading writes** (D-03) — used by Phase 24 events_mirror dual-write; Phase 44 mention notifications. `FOR UPDATE SKIP LOCKED` safeguards against trigger storms.
- **Edge Fn access-check before secret URL return** (D-09) — exact shape of `mux-sign-playback` (Phase 46 D-07).
- **Hourly pg_cron + per-user-TZ fan-out** (D-10) — Phase 38 weekly-digest verbatim.
- **`kind:` discriminator on mux-create-upload + mux-webhook passthrough** (D-15) — Phase 44 + 46 evolution. Adding `event-recording` is the third use; pattern is now load-bearing.
- **Dollar-quote tag nesting** (per memory `reference_postgres_dollar_quote_nesting_in_cron_body`) — outer `$cron$` + inner `$reminders$` in the cron migration.
- **Vendor secret pre-flight** (per memory `feedback_vendor_secret_preflight_surface`) — Zoom S2S OAuth credentials (account_id + client_id + client_secret) surfaced at Wave 0 dispatch; operator sets via `supabase secrets set ZOOM_S2S_ACCOUNT_ID=… ZOOM_S2S_CLIENT_ID=… ZOOM_S2S_CLIENT_SECRET=…` in parallel with execute.

### Integration Points

- **Events tab in consumer App.tsx** — new top-level TabId; widens `TabId` union; new lazy-loaded `EventsTab` route. Position between `'classroom'` and `'community'`.
- **Admin Events Editor** — new admin module under `src/admin/modules/events/` following Phase 42 + 44 admin shell pattern (per memory `reference_react_router_consumer_admin_split` — admin uses react-router). New route `/admin/events`.
- **`event-join-url` Edge Fn** — net-new; RLS-shaped access check; redirects or returns JSON `{ url }`.
- **`zoom-create-meeting` Edge Fn** — net-new; called from admin event-create form; writes back `zoom_meeting_id` + `join_url` to the events row via service role.
- **`event-reminders-fanout` Edge Fn** — net-new; hourly cron target; reads events + profiles.timezone + event_rsvps + event_promotion_queue; calls email-router.
- **`mux-webhook` extension** — new branch for `kind: 'event-recording'`; reads `events.attach_to_module_id`; INSERTs into `course_lessons` if set, else writes `events.recording_*` columns.

### Bundle Routing

- `events` chunk — new isolated chunk via `vite.config.ts` manualChunks rule; ≤25 kB gz target. Strictly UI + RPC client; no Mux Player (recording playback reuses Phase 46 LessonPlayer if the recording got attached to a lesson, OR a thin CommunityVideoPlayer fork for inline event-card playback).

</code_context>

<specifics>
## Specific Ideas

- Skool's events UX as the visual reference: chronological list of upcoming events (with cover image + "Going / Maybe" pills); past events demoted to "Past events" section with optional inline recording playback.
- Eventbrite-style "X going, Y waitlist, capacity Z" badge on each event card.
- Event card layout: cover image (16:9), title, start time in user's local TZ, host, space tag, RSVP CTA, "view details" → drill-in.
- Drill-in: full description (markdown via Phase 44 dompurify pipeline), RSVP pills (Going / Maybe / Not Going), capacity bar, attendee count, [Join meeting] button (calls event-join-url), [Add to my calendar] CTA — **deferred to v2 (no .ics in v1)**.
- Promotion email subject: "You're off the waitlist for [event title] 🎉" — admin team copywriter task.
- 1d reminder subject: "Tomorrow: [event title] at [local time]". 1h reminder: "Starting in an hour: [event title]".

</specifics>

<deferred>
## Deferred Ideas

- **Recurring events (RRULE)** — duplicate-event button covers the 80% case; full RRULE engine deferred to v2.
- **iCal / .ics export** — "Add to my calendar" button is the obvious next add; ~30 lines of Edge Fn code. Defer to v2 unless an early-adopter clinic asks.
- **Zoom Cloud Recording auto-pull** — Zoom webhook on `recording.completed` → download MP4 → upload to Mux → attach. Requires Zoom Cloud Recording subscription. Defer.
- **Web-push reminders** — Phase 42 `push_subscriptions` exists; D-11 deliberate scope trim. Add when event volume justifies the build cost.
- **In-app "starting in 1h" banner** — dashboard pill if user RSVP'd and event starts within 1h. Defer with web-push.
- **Google Meet / Whereby / Teams OAuth** — paste-link covers the gap for v1; native OAuth integrations deferred until any one of them is the dominant clinic ask.
- **Per-admin Zoom OAuth** — meetings show "LeanShot" as host in v1 (D-07). Per-admin OAuth + token refresh deferred.
- **Per-org Zoom OAuth** — clinic-branded Zoom integration deferred until first clinic asks.
- **Multi-host / co-organizer events** — single `created_by` admin in v1; co-host roster deferred.
- **Event polls / Q&A / event-specific chat thread** — Mighty Networks territory; defer until community engagement data justifies.
- **Month-grid calendar layout** — list-only v1 (D-14). `@schedule-x/react` or similar lightweight lib deferred until usage data warrants.
- **Native mobile push notifications** — PWA-only platform; native push deferred (no native app v1).
- **Standalone (space_id NULL) events** — every event lives in a space v1 (D-01). Platform-wide announcements use a dedicated "Announcements" global space instead.
- **Event-time tier upgrade gating** — RSVP allowed for any tier that can see the space; no tier-up at event time. If clinic asks for "Pro-only events inside Free space", add `events.min_tier_override` column. Defer.

</deferred>

---

*Phase: 47-M4 Events Calendar + Zoom + Reminders + Recording*
*Context gathered: 2026-05-23*
