# Phase 47: M4 Events Calendar + Zoom + Reminders + Recording - Research

**Researched:** 2026-05-23
**Domain:** Zoom S2S OAuth + Mux webhook extension + per-user-TZ pg_cron fan-out + SECDEF capacity RPC + waitlist FIFO promotion
**Confidence:** HIGH (live-DB verified for schema dependencies; precedent files read directly; Zoom S2S confirmed via official docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-16)

- **D-01** `events` schema with `space_id NOT NULL` FK to `community_spaces`; PHI / tier-gating derived from space; CHECK `end_at > start_at`; indexes `(space_id, start_at)` + `(start_at)`. No standalone (space_id NULL) events.
- **D-02** Capacity enforcement = SECURITY DEFINER RPC `event_rsvp_create(p_event_id, p_status)` with `SELECT FOR UPDATE` on the events row. Branch INSERT/UPDATE, NOT `ON CONFLICT DO …`. RPC uses `auth.uid()` (user-initiated, never service-role).
- **D-03** Waitlist promotion = `AFTER UPDATE OR DELETE ON event_rsvps` trigger, synchronous; head of waitlist selected via `ORDER BY waitlist_position ASC LIMIT 1 FOR UPDATE SKIP LOCKED`; promotes to `going` + queues an `event_promotion_queue` row that the hourly fan-out Fn drains. Strict FIFO via `waitlist_position`. May need `app.suppress_audit` GUC.
- **D-04** PHI marker = derive `phi: space.org_id IS NOT NULL` at template-render time. NO `events.is_phi` column. Reuses Phase 25 `_shared/email-router.ts`.
- **D-05** RSVP status enum = `text` CHECK `('going','maybe','not_going','waitlist')`. RPC enforces "client can request going/maybe/not_going; only the RPC can write waitlist".
- **D-06** Zoom integration depth = paste-link AND Zoom OAuth auto-generate, both v1. Radio in admin event-create form. `zoom-create-meeting` Edge Fn calls Zoom Meeting API with platform-shared Server-to-Server OAuth token (cached in vault). `events.zoom_managed = true` flags for future cleanup.
- **D-07** Zoom OAuth account model = platform-shared Server-to-Server OAuth (single LeanShot Zoom user). Token in `vault.decrypted_secrets` name='zoom_s2s_token' + auto-refresh handler. Per-admin / per-org OAuth deferred.
- **D-08** Other providers = paste-link only (no Google Meet / Whereby / Teams OAuth v1).
- **D-09** Meeting deep-link visibility = `event-join-url` Edge Fn validates `rsvp_status='going'` before returning URL. RLS hides `join_url` / `zoom_meeting_id` columns from non-attendees + non-creators. Mirrors `mux-sign-playback` access-check.
- **D-10** Reminder cron = hourly `pg_cron 0 * * * *` → Edge Fn `event-reminders-fanout` → per-user-timezone scan. Mirrors Phase 38 weekly-digest fan-out. Windows: `[23h,25h)` fires `1d`, `[0h,2h)` fires `1h`. Drains `event_promotion_queue` into promotion sends. Idempotent via UNIQUE `(event_id,user_id,kind)` where kind ∈ `('1d','1h','promotion')`.
- **D-11** Reminder channels = EMAIL ONLY v1. NO web-push. NO in-app banner.
- **D-12** Reminder cron granularity = 1h. UNIQUE constraint absorbs ±1h tick drift.
- **D-13** Calendar surface = new top-level TabId `'events'` in consumer App.tsx; widens `TabId` union in `src/types/index.ts`. Position between `'classroom'` and `'community'`.
- **D-14** Calendar layout = list-only chronological. NO month-grid lib v1. Reuses Card + Sheet.
- **D-15** Recording → lesson attachment = admin pre-configures `events.attach_to_module_id` at event creation. `mux-webhook video.asset.ready` auto-attaches. New `kind: 'event-recording'` discriminator + `passthrough: { event_id }`. If `attach_to_module_id` non-null → INSERT into `course_lessons` (`is_required=false`). Else → store `events.recording_mux_asset_id` + `events.recording_playback_id` inline.
- **D-16** Event covers = optional `cover_url` in NEW `event-covers` Storage bucket. Path `event-covers/{event_id}/{filename}`. Admin write, public read. MIME jpeg/png/webp + 2MB cap.

### Claude's Discretion

- Zoom S2S SDK choice (direct `fetch` recommended below; no npm SDK).
- Zoom token refresh strategy (fetch-on-demand + in-memory cache recommended; no separate refresh cron needed for 1h TTL).
- `event_rsvp_create` RPC return shape (JSONB recommended below).
- Promotion email subject — copy task, not planner concern.
- TabId `'events'` icon — `CalendarDays` recommended (see §lucide-react below).
- Whether Zoom-managed events need a Zoom-side cleanup hook on event delete — defer (no cost incurred by dangling meetings).
- Whether past events with recordings show on events tab — recommend YES; planner picks.
- HMAC orchestrator auth for `event-reminders-fanout` — reuse Phase 38 pattern.

### Deferred Ideas (OUT OF SCOPE)

Recurring events (RRULE), iCal / .ics export, Zoom Cloud Recording auto-pull, web-push reminders, in-app starting-in-1h banner, Google Meet / Whereby / Teams OAuth, per-admin or per-org Zoom OAuth, multi-host events, event polls / Q&A / event-specific chat, month-grid calendar layout, native mobile push, standalone (space_id NULL) events, event-time tier-upgrade gating.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVENT-01 | Events schema + calendar UI (admin creates event with title + description + start + end + capacity + space + RSVP settings + per-tier visibility) | Schema in §Standard Stack; admin module pathname-routed under `src/admin/modules/events/`; tier visibility derived from `community_spaces.min_tier` + `org_id` via inherited RLS |
| EVENT-02 | User RSVPs (Going / Maybe / Not Going); capacity enforced; waitlist auto-promotes when attendee cancels | SECDEF RPC `event_rsvp_create` with `SELECT FOR UPDATE` (D-02); AFTER UPDATE/DELETE trigger `promote_waitlist_on_rsvp_change()` with `FOR UPDATE SKIP LOCKED` (D-03) — concrete skeletons in §Code Examples |
| EVENT-03 | Zoom / Google Meet integration (admin pastes meeting link OR auto-generates via Zoom OAuth; deep-link revealed to attendees only) | `zoom-create-meeting` Edge Fn (S2S OAuth Basic+account_credentials, `POST /users/me/meetings`, `meeting:write:admin` scope, 1h token TTL); `event-join-url` Edge Fn with `rsvp_status='going'` access check (mirrors `mux-sign-playback`) |
| EVENT-04 | Automatic reminder emails (1d + 1h before) via Resend (or SES for PHI clinic events); per-user-timezone-aware | Hourly `pg_cron` → `event-reminders-fanout` mirrors `phase38-weekly-digest-hourly-fanout` verbatim; `phi: space.org_id IS NOT NULL` → Phase 25 router branches Resend vs SES |
| EVENT-05 | Post-event recording uploaded to Mux → attached as new lesson in adjacent course (admin-toggled) | `kind: 'event-recording'` discriminator added to `mux-create-upload` + `mux-webhook`; webhook branch reads `events.attach_to_module_id` → INSERT into `course_lessons` if non-null (Phase 46 D-09 schema) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack locked**: React 19 + Vite + TS strict + Tailwind v4 + Zustand. Consumer SPA has no router — uses Zustand TabId. Admin uses react-router-dom (per memory `reference_react_router_consumer_admin_split`).
- **No new client-side router for events**: TabId `'events'` widens the discriminated union; events drill-in uses local Zustand state (`activeEventId` recommended; mirror Phase 45 sub-view pattern).
- **Bundle ceiling**: aggressive code-split; new `events` chunk ≤25 kB gz. Reuse Phase 44 `Card`/`Sheet`/`community-feed` primitives without forking.
- **Accessibility / reduced-motion**: chronic-condition audience; new admin Event Editor + consumer Event drill-in MUST honor `useReducedMotion()` and provide `aria-label` on icon buttons.
- **Strict TypeScript** + path alias `@/*`.

---

## Summary

Phase 47 layers an events platform on Phase 44's `community_spaces` schema, reusing seven existing pieces of infrastructure (Phase 25 email router, Phase 38 cron fan-out template, Phase 44 Mux Edge Fns, Phase 46 `course_lessons` target, `tier_effective` view, `_shared/lifecycle-utils.checkServiceRoleBearer`, and the `_shared/email-router` PHI branch). Net-new code: 4 Edge Fns (`zoom-create-meeting`, `event-join-url`, `event-reminders-fanout`, plus extensions to `mux-create-upload` + `mux-webhook`), 1 SECDEF RPC, 1 trigger + trigger function, 1 cron migration, 1 Storage bucket, and a list-only consumer surface + admin editor.

**The five most important pre-planning discoveries (live-verified 2026-05-23):**

1. **`community_spaces` exists in production with the expected shape** (`id, name, description, org_id nullable, min_tier text`). `events.space_id FK` lands cleanly. **No `events`, `event_rsvps`, `event_reminder_sent`, `event_promotion_queue` tables exist yet** — Phase 47 creates them all net-new.

2. **`profiles.timezone` is live with the `profiles_timezone_iana` CHECK constraint** (`text ~ '^[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?$'`). Fan-out predicate can `coalesce(p.timezone, 'UTC')` directly — same shape as `phase38-weekly-digest-hourly-fanout`.

3. **Phase 46 `course_lessons` / `course_modules` do NOT yet exist in production** (Phase 46 is still in plan-mode). Phase 47's `events.attach_to_module_id uuid references course_modules(id)` FK MUST land in a migration that depends on Phase 46's schema migration. Plan-time guard: pin the cron + table migration timestamps to land after Phase 46's `course_modules` migration ships.

4. **Mux passthrough already carries JSON (`{user_id, post_id}` in Phase 44; Phase 46 adds `{kind: 'course-lesson', lesson_id, course_id}`)**. Phase 47 adds a third shape: `{kind: 'event-recording', event_id}`. The `mux-webhook` branch must dispatch on `passthrough.kind`. There's no `kind` field today (the Phase 44 webhook reads `passthrough.post_id` directly) — Phase 46's webhook extension is the one that introduces the `kind`-based dispatch. Phase 47 adds the third branch.

5. **Zoom S2S OAuth confirmed**: token endpoint `POST https://zoom.us/oauth/token` with `?grant_type=account_credentials&account_id=<id>`, Basic auth header `Base64(client_id:client_secret)`. Token TTL = 3600s. Scope `meeting:write:admin`. Create endpoint `POST https://api.zoom.us/v2/users/me/meetings` returns `{ id, join_url, start_url, password, … }` — both `id` and `join_url` are in the create-response, so a single Edge Fn round-trip suffices.

**Primary recommendation:** Treat Phase 47 as four well-scoped sub-systems with sharp dependencies on existing code: (1) schema + RSVP RPC + trigger (Wave 0, mirrors Phase 44 SECDEF idioms); (2) Edge Fns (Wave 1, three new + two extensions); (3) cron migration (Wave 1, copy `phase38-weekly-digest-hourly-fanout` verbatim with new fn URL); (4) consumer + admin UI (Wave 2). Vendor secrets (`ZOOM_S2S_*`) surfaced at Wave 0 dispatch.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Events / RSVP / waitlist schema + RLS | Database | — | Capacity invariant + RLS predicates must be DB-owned |
| Atomic capacity check (RSVP create) | Database (SECDEF RPC with `SELECT FOR UPDATE`) | — | Only DB-level row lock can serialize concurrent RSVPs at the capacity boundary |
| Waitlist FIFO promotion | Database (AFTER trigger with `FOR UPDATE SKIP LOCKED`) | — | Synchronous cascade keeps the invariant; trigger storms avoided via SKIP LOCKED |
| Zoom meeting creation (server-side OAuth) | API / Edge Fn (`zoom-create-meeting`) | — | OAuth client secret + meeting-creation API key must stay server-side |
| Meeting join-URL gate | API / Edge Fn (`event-join-url`) | Database (RLS hides `join_url` column) | Two-layer defense: RLS hides the column from clients; Edge Fn double-checks RSVP status |
| Reminder fan-out (per-user-TZ scan) | Database (pg_cron triggers HTTP via pg_net) | API / Edge Fn (`event-reminders-fanout`) | Cron schedule lives in DB; per-user delivery + Resend/SES routing in Edge Fn |
| Email routing (PHI vs non-PHI) | API / Edge Fn (`_shared/email-router`) | — | PHI flag derived from space.org_id at template-render time |
| Recording → lesson attachment | API / Edge Fn (`mux-webhook` extension) | Database (insert into `course_lessons`) | Webhook is the trusted Mux signal; service-role insert into Phase 46 schema |
| Cover image upload + RLS | Storage / CDN (`event-covers` bucket) | Database (RLS) | Public-read for non-PHI assets; admin-write via bucket policy |
| Calendar UI (list-only) | Browser (Zustand TabId `'events'`) | API (Supabase REST for events list) | No new client lib; reuse Card + Sheet primitives |
| Admin event editor | Browser (react-router admin shell) | API (SECDEF admin RPCs) | Per `reference_react_router_consumer_admin_split` — admin uses react-router |

---

## Live-DB Pre-check (verified 2026-05-23)

> Per memory `feedback_live_db_precheck_inverts_research_grep` — confirms what's actually in production, not just what migrations exist locally.

| Object | Live in production? | Notes |
|--------|---------------------|-------|
| `public.profiles.timezone` column | ✅ YES (`text`) | CHECK constraint `profiles_timezone_iana` confirmed: `CHECK ((timezone ~ '^[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?$'::text))` |
| `public.profiles.handle` / `display_name` | ❌ NO | Phase 45 adds these — not relevant to Phase 47 |
| `public.community_spaces` table | ✅ YES | Columns: id (uuid NOT NULL), name (text NOT NULL), description (text), org_id (uuid nullable), min_tier (text NOT NULL), … |
| `public.community_spaces.org_id` | ✅ YES (uuid, nullable) | Phase 47 D-04 PHI derivation reads this |
| `public.community_spaces.min_tier` | ✅ YES (text NOT NULL) | Phase 47 inherits tier-gating via RLS |
| `public.course_lessons` table | ❌ NO (not yet pushed) | Phase 46 ships this. Phase 47 `events.attach_to_module_id` FK depends on Phase 46 migration being applied FIRST. Plan-time guard: Phase 47 schema migration must depend on Phase 46's `course_modules` migration. |
| `public.course_modules` table | ❌ NO (not yet pushed) | Same — Phase 46 net-new. |
| `public.events` / `event_rsvps` / `event_reminder_sent` / `event_promotion_queue` | ❌ NO (correct — this phase creates them) | Sanity check confirms no name collision. |
| `extension pg_cron` | ✅ INSTALLED | Phase 47 cron migration ships `CREATE EXTENSION IF NOT EXISTS` as guard. |
| `extension pg_net` | ✅ INSTALLED | Same. |
| `vault.decrypted_secrets` row name='service_role_key' | ✅ EXISTS | Cron + fan-out reads via `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1`. |
| `tier_effective` view | ✅ EXISTS | Phase 43 — for the inherited space tier-gate. |

**Vendor secret pre-flight (per memory `feedback_vendor_secret_preflight_surface`):**

`supabase secrets list` (LeanShot project, 2026-05-23) — Phase 47 needs:

| Secret name | Currently set? | Required for | Recommended `set` command |
|-------------|---------------|--------------|----------------------------|
| `ZOOM_S2S_ACCOUNT_ID` | ❌ MISSING | `zoom-create-meeting` Fn | `supabase secrets set ZOOM_S2S_ACCOUNT_ID=<account_id>` |
| `ZOOM_S2S_CLIENT_ID` | ❌ MISSING | same | `supabase secrets set ZOOM_S2S_CLIENT_ID=<client_id>` |
| `ZOOM_S2S_CLIENT_SECRET` | ❌ MISSING | same | `supabase secrets set ZOOM_S2S_CLIENT_SECRET=<client_secret>` |
| `MUX_TOKEN_ID` | ❌ MISSING (Phase 46 also surfaces this) | `mux-create-upload` extension | Phase 46 surfaces this; Phase 47 only inherits |
| `MUX_TOKEN_SECRET` | ❌ MISSING (Phase 46 also surfaces this) | same | Phase 46 surfaces this |
| `MUX_WEBHOOK_SECRET` | ❌ MISSING (Phase 46 also surfaces this) | `mux-webhook` extension | Phase 46 surfaces this |
| `MUX_SIGNING_KEY` + `MUX_PRIVATE_KEY` | ❌ MISSING (Phase 46) | `mux-sign-playback` (Phase 46) | Out of Phase 47 scope but Phase 47 depends on Phase 46 Fn for recording-playback |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ SET | `event-reminders-fanout` HMAC/bearer | None |
| `RESEND_API_KEY` + `RESEND_FROM` | ✅ SET | non-PHI reminders | None |

> Phase 47 dispatch confirmation MUST surface the three `ZOOM_S2S_*` lines as a one-line operator action before Wave 0 starts.

---

## Standard Stack

### Core (re-use existing — no new npm deps)

| Library / Module | Version | Purpose | Why Standard |
|------------------|---------|---------|--------------|
| `@supabase/supabase-js` | 2 (via `npm:@supabase/supabase-js@2`) [VERIFIED: in mux-webhook] | Edge Fn DB client | Already in every Edge Fn |
| `@mux/mux-node` | 14 (via `npm:@mux/mux-node@14`) [VERIFIED: mux-webhook line 33] | Mux webhook signature verification | Already wired in Phase 44 |
| `_shared/email-router.ts` | n/a | PHI-aware email dispatch (Resend vs SES) | Phase 25 D-03; PHI flag derived from `community_spaces.org_id IS NOT NULL` per D-04 |
| `_shared/lifecycle-utils.ts` | n/a | `checkServiceRoleBearer`, `constantTimeEqual`, `bearerFromReq`, `jsonResponse`, `jsonError` | Phase 38 pattern; orchestrator-callable Fns use this for auth |
| `_shared/baa-scope.ts` | n/a | NOT required for Phase 47 — reminders are not LLM-mediated; no Anthropic call | — |
| `react-router-dom` | already shipped | Admin Event Editor routes | `reference_react_router_consumer_admin_split` — admin only |
| `lucide-react` | ^0.460.0 [VERIFIED: leanshot/CLAUDE.md] | TabId `'events'` icon | `CalendarDays` recommended over `Calendar` — see §Code Examples |
| `dompurify` + `react-markdown` | already shipped (Phase 44) | Render event description markdown | Reuse Phase 44 / helpdesk pipeline; do NOT introduce a second renderer |

### Supporting

| Module / pattern | Purpose | When to Use |
|------------------|---------|-------------|
| Phase 38 `phase38-weekly-digest-hourly-fanout` cron | Template for `phase47-event-reminders-hourly` | Copy verbatim — only the fn URL + per-user predicate body change |
| Phase 44 `community_spaces` RLS predicate | Inherited by `events` RLS | `events` reads via JOIN to `community_spaces` for org_id + min_tier visibility |
| Phase 46 `mux-create-upload` + `mux-webhook` with `kind` discriminator | Mux pipeline extension | Add `kind: 'event-recording'` branch — Phase 46 introduces the dispatch shape |
| `src/lib/community/tier-gate.ts canAccessSpace()` | Tier check for event visibility | Reuse; no fork. Events inherit space tier-gate. |
| `src/components/community/use-space-realtime.ts` (if Phase 44 generalized it) | NOT required for Phase 47 v1 (no realtime on events) | — |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct `fetch` to Zoom API in Edge Fn | `@zoom/zoom-api-js` SDK | Deno-compat unclear; SDK adds ~50kB to fn bundle; direct fetch is 30 lines [ASSUMED — defer SDK comparison]. **Recommendation:** direct fetch. |
| Per-Fn `deno.json` (per `reference_supabase_functions_deploy_import_map_flag`) | Single shared import_map.json | CLI v2.101.0 silently ignores `--import-map`; per-Fn `deno.json` is the only reliable resolution today. **Mandatory.** |
| `INSERT … ON CONFLICT DO NOTHING` for RSVP idempotency | Plain INSERT + catch unique violation | ON CONFLICT is fine here because RSVP key `(event_id, user_id)` is UNIQUE and we want it idempotent. NOTE: `ON CONFLICT DO DELETE` does not exist (per memory `reference_postgres_no_insert_on_conflict_do_delete`) — relevant for the trigger's branch, not for INSERT. |
| Synchronous trigger for promotion (D-03 locked) | Async via `event_promotion_queue` + cron | Memory `feedback_state_counter_table_needs_upsert_on_event` argues for synchronous when the invariant is "no double-going". CONTEXT D-03 already picks synchronous. |

**Installation:** No new npm dependencies. All work uses existing v1.3 stack.

**Version verification (2026-05-23):**

- `@mux/mux-node` `^14.x` — verified in `supabase/functions/mux-webhook/index.ts` line 33.
- `lucide-react` `^0.460.0` — verified in `leanshot/CLAUDE.md`.
- `@supabase/supabase-js@2` — verified in every Edge Fn.

---

## Architecture Patterns

### System Architecture Diagram

```
                  ┌──────────────────────────────┐
                  │  Admin (react-router)         │
                  │  src/admin/modules/events/   │
                  └──────────┬───────────────────┘
                             │
            ┌────────────────┴─────────────────┐
            │                                  │
            ▼                                  ▼
  ┌──────────────────┐              ┌──────────────────────┐
  │ Supabase REST    │              │ zoom-create-meeting  │
  │ (events INSERT;  │◀──events row─│ (Edge Fn: S2S OAuth) │──▶ Zoom API
  │ creator_id =     │   join_url   │                      │
  │ auth.uid())      │              └──────────────────────┘
  └────────┬─────────┘
           │
           ▼
  ┌────────────────────────┐
  │ events table           │
  │ + RLS via              │
  │ community_spaces       │◀─────┐
  │ (org_id + min_tier)    │      │
  └────────────────────────┘      │
                                  │
  ┌────────────────────────┐      │
  │ Consumer (Zustand      │      │
  │ TabId='events')        │──────┤
  │ src/components/events/ │      │
  └──────┬───────────┬─────┘      │
         │           │            │
   RSVP click       Join click    │
         │           │            │
         ▼           ▼            │
  ┌────────────┐  ┌─────────────────────┐
  │ RPC        │  │ event-join-url      │
  │ event_rsvp │  │ (Edge Fn: rsvp_     │
  │ _create    │  │  status='going'     │
  │ (SECDEF +  │  │  gate)              │
  │ FOR UPDATE)│  └─────────────────────┘
  └─────┬──────┘
        │
        ├──── INSERT event_rsvps (going|waitlist) ──▶ Postgres
        │
        ▼
  ┌────────────────────────┐
  │ AFTER UPDATE/DELETE    │
  │ trigger:               │
  │ promote_waitlist_      │
  │ on_rsvp_change         │ ──▶ event_promotion_queue (drained next hour)
  │ (FOR UPDATE SKIP       │
  │  LOCKED)               │
  └────────────────────────┘

  ┌────────────────────────────────────────────────────────┐
  │ pg_cron (0 * * * *) ──▶ pg_net.http_post              │
  │ ──▶ event-reminders-fanout Edge Fn                    │
  │     ├── scan event_rsvps WHERE status='going'         │
  │     ├── compute local_start_at via profiles.timezone  │
  │     ├── window [23h,25h) → kind='1d'                  │
  │     ├── window [0h,2h)   → kind='1h'                  │
  │     ├── drain event_promotion_queue → kind='promotion'│
  │     └── INSERT event_reminder_sent (UNIQUE)           │
  │         ──▶ _shared/email-router.ts                   │
  │             ├── phi=false → Resend                    │
  │             └── phi=true  → AWS SES (BAA-covered)     │
  └────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────┐
  │ Admin uploads recording → mux-create-upload            │
  │ (kind='event-recording', passthrough={event_id})       │
  │                                                         │
  │ Mux → video.asset.ready → mux-webhook                  │
  │   passthrough.kind === 'event-recording'               │
  │     ├── attach_to_module_id NOT NULL                   │
  │     │     → INSERT course_lessons (is_required=false)  │
  │     └── attach_to_module_id NULL                       │
  │           → UPDATE events SET recording_mux_*=…        │
  └────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   ├── 20270801000001_p47_events_schema.sql            # events + event_rsvps + event_reminder_sent + event_promotion_queue + indexes + CHECK constraints
│   ├── 20270801000002_p47_events_rls.sql               # RLS inheriting community_spaces; hide join_url + zoom_meeting_id from non-attendees
│   ├── 20270801000003_p47_event_rsvp_secdef.sql        # SECURITY DEFINER RPC event_rsvp_create + event_rsvp_update + event_rsvp_cancel
│   ├── 20270801000004_p47_waitlist_promotion_trigger.sql  # promote_waitlist_on_rsvp_change() + AFTER UPDATE/DELETE trigger
│   ├── 20270801000005_p47_event_covers_bucket.sql      # event-covers Storage bucket + RLS
│   ├── 20270801000006_p47_notification_event.sql       # email-router category widening + 3 templates (1d/1h/promotion)
│   └── 20270801000010_p47_pg_cron_schedules.sql        # phase47-event-reminders-hourly (mirror Phase 38)
└── functions/
    ├── zoom-create-meeting/                             # NEW Edge Fn — S2S OAuth + create meeting
    │   ├── index.ts
    │   └── deno.json
    ├── event-join-url/                                  # NEW Edge Fn — RSVP-gated meeting URL
    │   ├── index.ts
    │   └── deno.json
    ├── event-reminders-fanout/                          # NEW Edge Fn — hourly cron target
    │   ├── index.ts
    │   └── deno.json
    ├── mux-create-upload/index.ts                       # EXTEND — add kind='event-recording' branch
    └── mux-webhook/index.ts                             # EXTEND — add passthrough.kind dispatch
leanshot/
└── src/
    ├── types/index.ts                                   # WIDEN TabId union to include 'events'
    ├── components/events/                               # NEW consumer surface
    │   ├── EventsTab.tsx                                # lazy-loaded; list-only chronological
    │   ├── EventCard.tsx                                # cover + title + start_at + RSVP pills
    │   ├── EventDetailSheet.tsx                         # drill-in via Sheet primitive
    │   ├── RsvpPills.tsx                                # Going/Maybe/Not Going
    │   └── JoinMeetingButton.tsx                        # calls event-join-url
    ├── lib/events/                                       # NEW lib helpers
    │   ├── event-types.ts
    │   └── rsvp-client.ts                                # supabase.rpc('event_rsvp_create', …)
    └── admin/modules/events/                             # NEW admin shell module
        ├── AdminEventsLayout.tsx
        ├── EventListPage.tsx
        ├── EventEditPage.tsx                             # cover upload, Zoom radio, attach-to-module picker
        └── manifest.ts                                   # register under ADMIN_MODULES
```

### Pattern 1: SECDEF RPC + `SELECT FOR UPDATE` for atomic capacity check (D-02)

**What:** Lock the parent row before reading-then-conditionally-writing a child row. Eliminates the capacity race that plain INSERT-then-count cannot prevent.

**When to use:** Any time a capacity / quota / limit-bound counter is decremented; or any time idempotent toggle semantics need the "no double-write" guarantee.

**Precedent:** Phase 35 freeze-token + Phase 44 reaction-toggle RPCs (already shipped). Phase 47 RSVP follows the same shape.

### Pattern 2: AFTER trigger with `FOR UPDATE SKIP LOCKED` for waitlist promotion (D-03)

**What:** Fire a trigger on `event_rsvps` UPDATE/DELETE that selects the head of the waitlist with `FOR UPDATE SKIP LOCKED`, promotes it, and inserts a promotion-queue row.

**When to use:** Cascading writes where multiple concurrent triggers could otherwise contend for the same waitlist head. SKIP LOCKED guarantees forward progress at the cost of allowing a concurrent trigger to promote a different row (acceptable because the invariant is "at most N going"; the queue order is FIFO via `waitlist_position`).

**Precedent:** Phase 24 `events_mirror` dual-write trigger + Phase 44 mention-notification trigger.

### Pattern 3: Edge Fn access-check before secret URL return (D-09)

**What:** Mirror `mux-sign-playback` access-check shape. Client never receives the meeting URL via SELECT — instead calls `event-join-url(event_id)` Edge Fn, which validates `rsvp_status='going'` AND `events.start_at < now() + interval '15 minutes'` (NOT before, to prevent pre-event link sharing) before returning the URL.

**When to use:** Any secret/private value that should not be present in DB rows clients can SELECT.

**Precedent:** `mux-sign-playback` (Phase 46) + `dm-access-token` (Phase 45).

### Pattern 4: Hourly pg_cron + per-user-TZ fan-out (D-10)

**What:** Hourly cron tick → pg_net.http_post → Edge Fn iterates per (event, user) where `rsvp_status='going'`, computes `local_start_at AT TIME ZONE profiles.timezone`, fires reminders inside time windows that absorb cron-tick drift, with UNIQUE idempotency table.

**When to use:** Any per-user-timezone scheduled communication.

**Precedent:** `phase38-weekly-digest-hourly-fanout` — Phase 47 copies the dollar-quote tag pattern (`$cron$ … $reminders$`) verbatim.

### Pattern 5: Mux passthrough `kind` discriminator (D-15)

**What:** `mux-create-upload` writes `passthrough: JSON.stringify({ kind: '<source>', …refs })`; `mux-webhook` dispatches on `passthrough.kind`.

**When to use:** Adding a new Mux upload source without forking the webhook Fn.

**Precedent:** Phase 46 introduces the `kind` field for `'course-lesson'`; Phase 47 adds the third value `'event-recording'`.

### Anti-Patterns to Avoid

- **Storing `join_url` in the events row visible to clients.** RLS hides it; if a future planner widens column visibility, clients will pull the secret URL. **Hard-block via RLS column policy.**
- **Using `current_setting('app.service_role_key')` GUC for service-role-key in cron body.** Per memory `reference_supabase_pg_cron_vault_service_role_pattern` — this GUC does NOT exist on this project. Use `vault.decrypted_secrets` row.
- **Bare `$$ … $$` inside `cron.schedule()` body.** Silently closes the outer quote (per memory `reference_postgres_dollar_quote_nesting_in_cron_body`). Use named tags: outer `$cron$`, inner `$reminders$`.
- **`INSERT … ON CONFLICT DO DELETE`** for the RSVP toggle path. This syntax does NOT exist (per memory `reference_postgres_no_insert_on_conflict_do_delete`). Cancel = explicit `DELETE FROM event_rsvps WHERE …` or UPDATE to `not_going`.
- **Calling `event_rsvp_create` from a service-role Edge Fn.** Per memory `feedback_rpc_auth_uid_vs_service_role_mismatch` — RPC body uses `auth.uid()`; service-role caller has no `auth.uid()`. **RSVP is user-initiated; the client calls the RPC with the user JWT.**
- **Falling back from SES to Resend on PHI send failure.** Per `_shared/email-router.ts` comments — silent fallback = PHI outside BAA. Return skipped no-op instead.
- **Adding a `video.view` Mux webhook handler for anti-skip.** Per memory `reference_mux_video_view_event_for_antiskip` — `video.view` does NOT exist as a Mux webhook event. Anti-skip is client-side (Phase 46 concern, not Phase 47).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Capacity race at the boundary | Application-level count-then-INSERT | Postgres `SELECT … FOR UPDATE` inside SECDEF RPC | Plain count-then-INSERT has a TOCTOU window; row-level lock serializes |
| Waitlist FIFO promotion | Polling loop in admin UI | DB trigger with `FOR UPDATE SKIP LOCKED` | Trigger fires synchronously; SKIP LOCKED prevents trigger storms |
| Per-user-timezone scheduling | App-server iteration | `pg_cron` + `AT TIME ZONE profiles.timezone` predicate | Phase 38 already proves the pattern; ~50 lines of SQL |
| Email PHI routing | `if (org_id) { ses } else { resend }` in each Fn | `_shared/email-router.ts` with `phi:boolean` flag | Single dispatch point; HIPAA-compliant by construction (Phase 25 D-03) |
| Zoom JWT or legacy app credential auth | Custom JWT signing | Server-to-Server OAuth (token endpoint + Basic auth) | Zoom deprecated JWT apps; S2S is the supported path |
| Meeting URL hiding from non-attendees | Client-side conditional render | RLS column policy + Edge Fn access check | Two-layer defense — never trust the client to filter |
| Mux webhook signature verification | Custom HMAC | `@mux/mux-node` `mux.webhooks.verifySignature()` | Already wired Phase 44; handles timestamp tolerance + multi-sig |
| Markdown rendering for event description | New renderer | Phase 44 `react-markdown` + `dompurify` pipeline | Reuse — do NOT introduce a second renderer |
| Calendar grid library | `@schedule-x/react` or `react-big-calendar` | List-only chronological (D-14) | Bundle ceiling protected; reuse Card primitives |

**Key insight:** Phase 47 is heavy on infrastructure reuse and light on new abstractions. The only "new" pieces are the three Edge Fns and the cron migration; everything else extends a pattern that already shipped.

---

## Runtime State Inventory

> Phase 47 is greenfield (new tables, new Edge Fns, new TabId). No rename / refactor / migration concerns. Skipping per template instructions.

---

## Common Pitfalls

### Pitfall 1: `events.attach_to_module_id` FK fails because `course_modules` is not yet in production

**What goes wrong:** Phase 47's `events` table migration declares `attach_to_module_id uuid references course_modules(id)`. If Phase 46's `course_modules` migration hasn't been applied yet, `supabase db push` rejects with "relation course_modules does not exist".

**Why it happens:** Phase 46 is currently in plan-mode (verified 2026-05-23 — `course_lessons` and `course_modules` do NOT exist in live DB). Phase 47 dispatches after Phase 46 ships, but local development might re-order.

**How to avoid:** Phase 47 migration timestamps MUST be `>` Phase 46's `course_modules` migration timestamp. Phase 46 will land migrations in the `20270720*` or later window (extending Phase 44's `20270720000001..6_p44_*` range). Phase 47 uses `20270801*` to guarantee ordering.

**Warning signs:** `supabase db push` at Phase 47 Wave 0 rejects with FK error. Fix is to confirm Phase 46 migrations are applied to the linked project before Phase 47 push.

### Pitfall 2: Zoom S2S token expires mid-call

**What goes wrong:** Cached Zoom token TTL is 3600s. If `zoom-create-meeting` Edge Fn is invoked at minute 59 of the token's lifetime, the Mux call may 401 mid-flight.

**Why it happens:** S2S OAuth tokens are short-lived. Edge Fns cold-start frequently, so an in-memory cache is per-instance.

**How to avoid:** Fetch a fresh token on every cold start; cache in memory for the warm window. On 401 from `POST /users/me/meetings`, refetch token and retry ONCE. Do NOT cache across cold starts (no shared cache in Edge Fns).

**Warning signs:** Intermittent 401 from Zoom in `zoom-create-meeting` logs.

### Pitfall 3: pg_cron dollar-quote collision

**What goes wrong:** Bare `$$ … $$` inside `cron.schedule(…, $$ … $$)` body silently closes the outer quote, causing "syntax error at or near DECLARE" at migration apply.

**Why it happens:** Postgres dollar-quote nesting requires unique tags at each nesting level (per memory `reference_postgres_dollar_quote_nesting_in_cron_body`).

**How to avoid:** Use outer `$cron$ … $cron$` plus inner `$reminders$ … $reminders$` (DIFFERENT tag — not the same as Phase 38's `$digest$`). Migration tests at apply time.

**Warning signs:** `supabase db push` fails on the cron migration with cryptic SQL syntax error.

### Pitfall 4: Reminder window overlap fires duplicate `1h` AND `1d` for users whose timezone shifts the event into both windows

**What goes wrong:** Theoretical edge case where an event's `local_start_at - now()` straddles the 23h boundary across two cron ticks. Without the UNIQUE constraint, the same user could get a `1d` reminder twice.

**Why it happens:** Hourly cron + ±1h tick drift overlap means the same (event, user, kind) could match the predicate twice.

**How to avoid:** UNIQUE constraint on `event_reminder_sent (event_id, user_id, kind)`. `INSERT … ON CONFLICT DO NOTHING` in the Edge Fn loop. Idempotent by construction.

**Warning signs:** A user reports receiving two `1d` reminders for the same event.

### Pitfall 5: Race between RSVP cancel and waitlist promotion when N concurrent cancels arrive

**What goes wrong:** Two `going` RSVPs cancel simultaneously; both triggers race to promote the head of the waitlist. Without `FOR UPDATE SKIP LOCKED`, one of two failure modes: (a) both promote the same row (now 2 promotions for 1 going slot vacated → invariant breach); (b) one trigger deadlocks waiting on the row lock.

**Why it happens:** AFTER triggers run in their own transactions; row locks are scoped to the trigger's transaction; without SKIP LOCKED, contention is FIFO with possible deadlock.

**How to avoid:** `SELECT … FROM event_rsvps WHERE event_id=… AND status='waitlist' ORDER BY waitlist_position ASC LIMIT 1 FOR UPDATE SKIP LOCKED`. If the second trigger SKIPs (sees the head already locked), it picks the next available row — exactly the desired behavior (cancel #1 vacates slot → promotes row A; cancel #2 vacates slot → promotes row B).

**Warning signs:** Concurrent-cancel test (see §Validation Architecture) shows duplicate promotions.

### Pitfall 6: PHI flag derivation drift

**What goes wrong:** A planner adds a new email send path and forgets to derive `phi: space.org_id IS NOT NULL` from the event's space. PHI email lands on Resend (no BAA) → HIPAA breach.

**Why it happens:** D-04 derives PHI from the space, not from a column on `events`. New code paths must explicitly fetch the space's `org_id`.

**How to avoid:** Provide a helper `getEventPhiFlag(event_id) → Promise<boolean>` in `supabase/functions/_shared/event-phi.ts` (NEW). Every event email send MUST route through this helper. Plan-checker grep guard: `email-router.send` calls in event-related Fns must pass the result of `getEventPhiFlag`.

**Warning signs:** Code review finds `phi: false` hardcoded in an event email send.

### Pitfall 7: `events.zoom_managed=true` events orphan Zoom meetings on event delete

**What goes wrong:** Admin deletes event → Postgres cascades `event_rsvps` delete → but the Zoom meeting on Zoom's side persists, consuming Zoom storage/listing space.

**Why it happens:** No FK from Postgres to Zoom; nothing tells Zoom to delete the meeting.

**How to avoid:** Per CONTEXT Claude's Discretion — researcher confirms whether dangling Zoom meetings cost anything; defer cleanup unless meaningful. **Recommendation (LOW confidence):** Defer to v2. Zoom does not charge per-meeting storage on standard accounts; orphan meetings are listed in the LeanShot Zoom UI but cause no cost. Document for v2 cleanup hook. [ASSUMED — no Zoom Pro/Business storage pricing verified]

**Warning signs:** Zoom account meetings list grows unboundedly. Trigger v2 cleanup work.

---

## Code Examples

Verified patterns from precedent files (cited inline).

### Example 1: SECDEF RPC `event_rsvp_create` (skeleton)

```sql
-- Source pattern: Phase 35 freeze-token + Phase 44 reactions
-- Memory: reference_postgres_no_insert_on_conflict_do_delete — use branch INSERT/UPDATE
-- Memory: feedback_rpc_auth_uid_vs_service_role_mismatch — uses auth.uid()
CREATE OR REPLACE FUNCTION public.event_rsvp_create(
  p_event_id uuid,
  p_status text  -- one of 'going','maybe','not_going'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event events%ROWTYPE;
  v_going_count integer;
  v_assigned_status text;
  v_waitlist_position integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('going','maybe','not_going') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;

  -- Lock the events row for the duration of this transaction.
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002';
  END IF;

  -- Visibility check (inherited from community_spaces RLS — belt-and-braces).
  IF NOT EXISTS (
    SELECT 1 FROM public.community_spaces s
     WHERE s.id = v_event.space_id
       AND public.can_see_community_space(s.id, v_user_id)  -- helper from Phase 44
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Capacity check for 'going' requests only.
  IF p_status = 'going' THEN
    SELECT count(*) INTO v_going_count
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going' AND user_id <> v_user_id;
    IF v_event.capacity = 0 OR v_going_count < v_event.capacity THEN
      v_assigned_status := 'going';
    ELSE
      -- Waitlist branch.
      v_assigned_status := 'waitlist';
      SELECT coalesce(max(waitlist_position), 0) + 1 INTO v_waitlist_position
        FROM public.event_rsvps
       WHERE event_id = p_event_id AND status = 'waitlist';
    END IF;
  ELSE
    v_assigned_status := p_status;
  END IF;

  -- Branch INSERT vs UPDATE (idempotent on (event_id, user_id)).
  INSERT INTO public.event_rsvps (event_id, user_id, status, waitlist_position)
    VALUES (p_event_id, v_user_id, v_assigned_status, v_waitlist_position)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET status = excluded.status,
        waitlist_position = excluded.waitlist_position,
        updated_at = now();

  RETURN jsonb_build_object(
    'status', v_assigned_status,
    'waitlist_position', v_waitlist_position
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_rsvp_create(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.event_rsvp_create(uuid, text) TO authenticated;
```

### Example 2: AFTER UPDATE/DELETE trigger function `promote_waitlist_on_rsvp_change()` (skeleton)

```sql
-- Source pattern: Phase 24 events_mirror trigger + Phase 44 mention-notification trigger
-- Per D-03: FOR UPDATE SKIP LOCKED for FIFO promotion
CREATE OR REPLACE FUNCTION public.promote_waitlist_on_rsvp_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event_id uuid;
  v_capacity integer;
  v_going_count integer;
  v_head_user_id uuid;
  v_head_rsvp_id uuid;
BEGIN
  -- Determine which event was affected.
  v_event_id := COALESCE(OLD.event_id, NEW.event_id);

  -- Only promote when a 'going' slot was vacated.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'going' AND NEW.status <> 'going' THEN
      -- proceed
      NULL;
    ELSE
      RETURN COALESCE(NEW, OLD);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'going' THEN
      RETURN OLD;  -- non-going row deleted: nothing to promote
    END IF;
  END IF;

  -- Read capacity (lock event row briefly).
  SELECT capacity INTO v_capacity FROM public.events WHERE id = v_event_id FOR UPDATE;
  SELECT count(*) INTO v_going_count
    FROM public.event_rsvps
   WHERE event_id = v_event_id AND status = 'going';

  -- Only promote if capacity now permits (handles capacity=0 unlimited case correctly).
  IF v_capacity <> 0 AND v_going_count >= v_capacity THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Promote head of waitlist (FOR UPDATE SKIP LOCKED: concurrent triggers skip the row this one locks).
  SELECT id, user_id INTO v_head_rsvp_id, v_head_user_id
    FROM public.event_rsvps
   WHERE event_id = v_event_id AND status = 'waitlist'
   ORDER BY waitlist_position ASC NULLS LAST
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_head_rsvp_id IS NOT NULL THEN
    UPDATE public.event_rsvps
       SET status = 'going',
           waitlist_position = NULL,
           updated_at = now()
     WHERE id = v_head_rsvp_id;

    INSERT INTO public.event_promotion_queue (event_id, user_id, promoted_at)
      VALUES (v_event_id, v_head_user_id, now())
      ON CONFLICT (event_id, user_id) DO NOTHING;  -- defensive
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_promote_waitlist_on_rsvp_change
  AFTER UPDATE OR DELETE ON public.event_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_waitlist_on_rsvp_change();
```

### Example 3: `event-reminders-fanout` Edge Fn skeleton (mirrors Phase 38 weekly-digest)

```typescript
// supabase/functions/event-reminders-fanout/index.ts
// Per D-10: per-user-TZ scan; idempotent via event_reminder_sent UNIQUE
// Per reference_supabase_service_role_key_format_divergence — bearer = sb_secret_*
import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkServiceRoleBearer, jsonError, jsonResponse } from '../_shared/lifecycle-utils.ts';
import { sendEmail } from '../_shared/email-router.ts';  // PHI router

export async function handler(req: Request): Promise<Response> {
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Phase 38 pattern: a single SQL JOIN does the per-user-TZ window math.
  // Mirror weekly-digest's predicate, swap dow=0/hour=9 for event-time windowing.
  const { data: targets } = await admin.rpc('select_event_reminder_targets');
  // RPC returns: [{ event_id, user_id, kind: '1d'|'1h'|'promotion', phi, email, event_title, local_start_at }, …]

  for (const t of targets ?? []) {
    // Idempotent insert; on conflict skip the send.
    const { error: dupe } = await admin
      .from('event_reminder_sent')
      .insert({ event_id: t.event_id, user_id: t.user_id, kind: t.kind });
    if (dupe) continue;  // already sent

    await sendEmail({
      to: t.email,
      template: t.kind === 'promotion' ? 'event_promotion' :
                t.kind === '1d'        ? 'event_reminder_1d'  : 'event_reminder_1h',
      phi: t.phi,    // PHI flag derived in the RPC from community_spaces.org_id IS NOT NULL
      vars: { event_title: t.event_title, local_start_at: t.local_start_at },
    });
  }

  return jsonResponse({ ok: true, sent: targets?.length ?? 0 });
}

const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
```

### Example 4: `phase47-event-reminders-hourly` cron migration (copy of Phase 38 verbatim)

```sql
-- supabase/migrations/20270801000010_p47_pg_cron_schedules.sql
-- Mirror phase38-weekly-digest-hourly-fanout (supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql).
-- Per reference_supabase_pg_cron_vault_service_role_pattern: vault.decrypted_secrets row.
-- Per reference_postgres_dollar_quote_nesting_in_cron_body: outer $cron$ + inner $reminders$ (UNIQUE).
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $unschedule$
begin
  perform cron.unschedule('phase47-event-reminders-hourly');
exception when others then null;
end $unschedule$;

select cron.schedule(
  'phase47-event-reminders-hourly',
  '0 * * * *',
  $cron$
  do $reminders$
  declare
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/event-reminders-fanout';
    service_key text;
  begin
    select decrypted_secret
      into service_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if service_key is null then
      raise notice 'phase47-event-reminders-hourly: service_role_key vault entry missing — skipping';
      return;
    end if;

    perform net.http_post(
      url := fn_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 60000
    );
  end;
  $reminders$;
  $cron$
);
```

### Example 5: `zoom-create-meeting` Edge Fn (direct fetch — no SDK)

```typescript
// supabase/functions/zoom-create-meeting/index.ts
// Server-to-Server OAuth: POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=<id>
// Basic auth: Base64(client_id:client_secret). TTL=3600s. Scope meeting:write:admin.
// Source: developers.zoom.us/docs/internal-apps/s2s-oauth + Zoom Meetings API ref (web search 2026-05-23).
import { createClient } from 'npm:@supabase/supabase-js@2';

let _cachedToken: { value: string; expiresAt: number } | null = null;

async function getZoomToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) return _cachedToken.value;

  const accountId    = Deno.env.get('ZOOM_S2S_ACCOUNT_ID')!;
  const clientId     = Deno.env.get('ZOOM_S2S_CLIENT_ID')!;
  const clientSecret = Deno.env.get('ZOOM_S2S_CLIENT_SECRET')!;
  const basic = btoa(`${clientId}:${clientSecret}`);

  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } }
  );
  if (!r.ok) throw new Error(`zoom_oauth_${r.status}`);
  const json = await r.json() as { access_token: string; expires_in: number };
  _cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in - 60) * 1000 };
  return _cachedToken.value;
}

interface CreateMeetingBody { event_id: string; }
interface ZoomMeetingResponse { id: number | string; join_url: string; password?: string; }

export async function handler(req: Request): Promise<Response> {
  // Auth: caller passes the user JWT; verify admin role server-side.
  const auth = req.headers.get('Authorization') ?? '';
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return new Response('unauthorized', { status: 401 });
  const { data: isAdmin } = await supa.rpc('is_staff');  // Phase 28/44 helper
  if (!isAdmin) return new Response('forbidden', { status: 403 });

  const body = await req.json() as CreateMeetingBody;
  const { data: ev } = await supa.from('events').select('title, start_at, end_at').eq('id', body.event_id).single();
  if (!ev) return new Response('event_not_found', { status: 404 });

  let token = await getZoomToken();
  const meetingReq = {
    topic: ev.title,
    type: 2,  // scheduled meeting
    start_time: ev.start_at,  // ISO 8601
    duration: Math.ceil((Date.parse(ev.end_at) - Date.parse(ev.start_at)) / 60_000),
    timezone: 'UTC',
    settings: { join_before_host: false, waiting_room: true },
  };
  let zr = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(meetingReq),
  });
  if (zr.status === 401) {
    // Token may have expired race; refetch once.
    _cachedToken = null;
    token = await getZoomToken();
    zr = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(meetingReq),
    });
  }
  if (!zr.ok) return new Response(`zoom_create_${zr.status}`, { status: 502 });
  const meeting = await zr.json() as ZoomMeetingResponse;

  // Service-role write-back of zoom_meeting_id + join_url to events row.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  await admin.from('events').update({
    zoom_meeting_id: String(meeting.id),
    join_url: meeting.join_url,
    zoom_managed: true,
  }).eq('id', body.event_id);

  return new Response(JSON.stringify({ ok: true, meeting_id: meeting.id, join_url: meeting.join_url }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
```

### Example 6: `mux-webhook` extension — new `event-recording` branch

```typescript
// Add to supabase/functions/mux-webhook/index.ts (after existing community_posts branch).
// passthrough shape: { kind: 'event-recording', event_id: '<uuid>' }
// Phase 46 introduces passthrough.kind for course-lesson; Phase 47 adds event-recording.

if (event.type === 'video.asset.ready' && passthrough?.kind === 'event-recording' && passthrough.event_id) {
  const playbackId = event.data.playback_ids?.[0]?.id ?? null;
  const durationSec = Math.round(event.data.duration ?? 0);

  // Read attach target from events row.
  const { data: ev } = await admin.from('events')
    .select('id, title, attach_to_module_id')
    .eq('id', passthrough.event_id)
    .single();

  if (ev?.attach_to_module_id) {
    // Phase 46 schema: course_lessons (module_id, title, mux_asset_id, mux_playback_id, duration_seconds, is_required, order_index, …)
    const { data: maxOrder } = await admin.from('course_lessons')
      .select('order_index')
      .eq('module_id', ev.attach_to_module_id)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (maxOrder?.order_index ?? 0) + 1;

    await admin.from('course_lessons').insert({
      module_id:        ev.attach_to_module_id,
      title:            `${ev.title} recording`,
      mux_asset_id:     event.data.id,
      mux_playback_id:  playbackId,
      duration_seconds: durationSec,
      is_required:      false,                                // D-15: don't break completion math
      is_free_preview:  false,
      order_index:      nextOrder,
    });
  } else {
    // Inline recording on the event card (no lesson attachment).
    await admin.from('events').update({
      recording_mux_asset_id: event.data.id,
      recording_playback_id:  playbackId,
    }).eq('id', passthrough.event_id);
  }
  return new Response('ok', { status: 200 });
}
```

### Example 7: `event-join-url` Edge Fn (RSVP gate)

```typescript
// supabase/functions/event-join-url/index.ts
// Per D-09: mirrors mux-sign-playback access-check shape.
import { createClient } from 'npm:@supabase/supabase-js@2';

export async function handler(req: Request): Promise<Response> {
  const auth = req.headers.get('Authorization') ?? '';
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

  const { event_id } = await req.json() as { event_id: string };

  // RLS-respecting read of (rsvp_status, join_url, start_at). The user-context
  // client filters out join_url when the user isn't 'going' (column RLS).
  // We use a SECDEF helper RPC to fetch the URL only when the gate passes:
  const { data, error } = await supa.rpc('event_get_join_url', { p_event_id: event_id });
  if (error) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  if (!data?.url) return new Response(JSON.stringify({ error: 'rsvp_required' }), { status: 403 });

  // Optional: enforce "not before 15 minutes pre-start" to prevent pre-event link sharing.
  // (CONTEXT D-09 doesn't require this; planner picks.)

  return new Response(JSON.stringify({ url: data.url }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
```

### Example 8: `lucide-react` icon for TabId `'events'`

Both `Calendar` and `CalendarDays` exist in `lucide-react@0.460`. `CalendarDays` shows numbered days inside the calendar grid (more visually distinct from a generic "schedule" icon); `Calendar` is a plain bordered grid. **Recommendation: `CalendarDays`** — better distinguishability from the `Home` icon and matches Skool's events-tab affordance.

```tsx
// src/types/index.ts
export type TabId =
  | 'home' | 'medication' | 'symptoms' | 'body' | 'nutrition'
  | 'activity' | 'supplements' | 'mood' | 'insights'
  | 'classroom'    // Phase 46 widens TabId here
  | 'events'       // Phase 47 — between classroom and community
  | 'community';

// src/components/layout/Sidebar.tsx (illustrative)
import { CalendarDays } from 'lucide-react';
// nav entry: { id: 'events', label: 'Events', icon: <CalendarDays /> }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zoom JWT App credentials | Server-to-Server OAuth | Zoom deprecated JWT apps Sep 2023 | All net-new Zoom integrations MUST use S2S OAuth. JWT app docs are archived. |
| `current_setting('app.service_role_key')` GUC | `vault.decrypted_secrets` row | LeanShot Phase 22 [VERIFIED: reference_supabase_pg_cron_vault_service_role_pattern] | GUC does NOT exist on this project; vault lookup is the only path |
| `supabase functions deploy --import-map` | Per-Fn `deno.json` | Supabase CLI v2.101.0 silently ignores `--import-map` [VERIFIED: reference_supabase_functions_deploy_import_map_flag] | All new Edge Fns ship a sibling `deno.json` |
| Legacy HS256 JWT service-role-key | `sb_secret_*` token [VERIFIED: reference_supabase_service_role_key_format_divergence] | Supabase 2025 rollover | Edge Fn constant-time bearer compare expects new format |
| `video.view` Mux webhook for anti-skip | Does NOT EXIST [VERIFIED: reference_mux_video_view_event_for_antiskip + Phase 46 RESEARCH] | Confirmed 2026-05-23 | Phase 46 (and any future) anti-skip is client-side. Not relevant to Phase 47. |

**Deprecated / outdated:**

- Zoom JWT apps — replaced by S2S OAuth.
- `ON CONFLICT DO DELETE` syntax — does not exist; use SECDEF + branch.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Dangling Zoom meetings on event delete cost nothing on standard Zoom accounts | Pitfall 7 | LOW — if wrong, planner adds a cleanup Edge Fn in v2; no v1 impact |
| A2 | Zoom S2S scope `meeting:write:admin` is sufficient for `POST /users/me/meetings` | §Standard Stack + Example 5 | MEDIUM — if scope is narrower (e.g., `meeting:write`), the create call 403s. Operator action: confirm the Zoom S2S app has the right scope checked in Zoom Marketplace during pre-flight. |
| A3 | Mux passthrough JSON shape `{kind, ref_ids}` is established by Phase 46 (not yet pushed) and Phase 47 inherits it as a contract | §Architecture Pattern 5 + Example 6 | MEDIUM — if Phase 46 ships a different passthrough shape, Phase 47 webhook branch must match. **Plan-time guard:** Phase 47 planner reads Phase 46's mux-create-upload + mux-webhook extension PLAN file before writing the event-recording branch. |
| A4 | `qrcode` / `qrcode.react` not consumed by Phase 47 | §Don't Hand-Roll | NONE — Phase 47 does not generate QR codes. Phase 46 owns that dep. |
| A5 | Phase 46 ships `course_modules` migration with timestamp ≤ `20270801` so Phase 47's `attach_to_module_id` FK can land at `20270801000001` | Pitfall 1 | MEDIUM — if Phase 46 reserves timestamps ≥ `20270801`, Phase 47 must shift to `20270802` to maintain ordering. **Plan-time guard:** Phase 47 planner verifies Phase 46's PLAN file timestamp window. |
| A6 | Phase 28 / 44 ships a `public.is_staff()` helper SECDEF that returns `boolean` for admin/staff checks (used in `zoom-create-meeting` Example 5) | Example 5 | LOW — verified via memory `reference_supabase_is_staff_helper` (canonical at `supabase/migrations/20261101000006_is_staff_helper.sql`). |

**Total assumptions:** 6. All MEDIUM-or-lower risk. All are pre-flight checks the planner can resolve at the start of Wave 0 by reading Phase 46's PLANs.

---

## Open Questions

1. **Should past events with recordings appear on the events tab as a "video archive" section?**
   - What we know: CONTEXT Claude's Discretion suggests "YES for engagement".
   - What's unclear: bundle impact — if recordings autoplay or use Mux Player inline, the `events` chunk drags `@mux/mux-player-react` (~170 kB gz) → likely overshoots the 25 kB target.
   - Recommendation: Past events with recordings show as cards with a "View recording" CTA that **navigates to the classroom tab** (which already loaded Mux Player). Keeps `events` chunk lean. Planner picks UX flow.

2. **Should `event-join-url` enforce a "not before 15 minutes pre-start" rule?**
   - What we know: CONTEXT D-09 only requires `rsvp_status='going'`.
   - What's unclear: whether returning the URL hours/days before the event enables link sharing outside the RSVP'd set.
   - Recommendation: Add the 15-min pre-window check as a quiet defense-in-depth. Planner decides if this is a hard reject (403) or a "meeting hasn't opened" UX state.

3. **Should `events` widen the `notification_settings` row with new toggles for `event_reminders` / `event_promotion`?**
   - What we know: CONTEXT doesn't mandate per-user opt-out for event reminders.
   - What's unclear: if users get spammed by reminders for events they RSVP'd long ago.
   - Recommendation: ADD toggles `event_reminders_1d` (default true), `event_reminders_1h` (default true), `event_promotion` (default true). Cheap to add at schema time, expensive to retrofit. Per memory `feedback_planner_missed_status_enum_widening` — widen `VALID_CATEGORIES` in `_shared/notification-send` SAME COMMIT as adding columns.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | `supabase db push` + `supabase functions deploy` | ✓ | 2.101.0 (verified via `npx -y supabase --version`) | none |
| pg_cron extension | hourly reminder cron | ✓ (live in project) | n/a | none |
| pg_net extension | cron HTTP invoke | ✓ (live in project) | n/a | none |
| Supabase vault | service_role_key lookup in cron | ✓ (`service_role_key` row exists) | n/a | none |
| `@mux/mux-node@14` | mux-webhook signature verify | ✓ (already in mux-webhook Fn) | 14.x | none |
| Resend account + key | non-PHI reminder email | ✓ (`RESEND_API_KEY` + `RESEND_FROM` set) | n/a | none — required |
| AWS SES + BAA | PHI reminder email | ✓ (Phase 25 ships email-router with SES branch) | n/a | none — required for clinic events |
| Zoom S2S app credentials | `zoom-create-meeting` | ✗ (no `ZOOM_S2S_*` secrets set) | n/a | Operator MUST set 3 secrets before Wave 1. Fallback: paste-link still works without OAuth. |
| Mux account + signing keys | recording upload + playback | ✗ (Phase 46 surfaces) | n/a | Phase 46 secrets pre-flight; Phase 47 inherits |
| Phase 46 `course_lessons` / `course_modules` migrations | `events.attach_to_module_id` FK + lesson insert | ✗ (not yet pushed) | n/a | Phase 47 must dispatch AFTER Phase 46 migrations land |

**Missing dependencies with no fallback:**

- Phase 46 schema must be live before Phase 47 push (FK dependency).

**Missing dependencies with fallback:**

- `ZOOM_S2S_*` secrets: paste-link path works without them. `zoom-create-meeting` returns a clear `zoom_not_configured` error until secrets are set.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (TS) for client + shared; Deno test (`deno test --no-check`) for Edge Fns |
| Config file | `leanshot/vite.config.ts` (test block) + per-Fn `deno.json` |
| Quick run command | `cd leanshot && npx vitest run --reporter=dot tests/events/ src/components/events/ src/lib/events/` |
| Full suite command | `cd leanshot && npm test -- --run` + `$HOME/.deno/bin/deno test --no-check supabase/functions/{event-reminders-fanout,event-join-url,zoom-create-meeting}/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVENT-01 | Admin creates event; row visible per RLS to tier-eligible space members | RLS-DB test (cross-tenant impersonation) | `npx vitest run tests/rls/event-visibility.test.ts` | ❌ Wave 0 |
| EVENT-01 | Org-scoped event invisible to non-org users (impersonation proof) | RLS-DB cross-tenant test | `npx vitest run tests/rls/event-visibility-orgscope.test.ts` | ❌ Wave 0 |
| EVENT-01 | Tier-gated event invisible to free-tier user when space.min_tier='pro' | RLS-DB test | `npx vitest run tests/rls/event-visibility-tiergate.test.ts` | ❌ Wave 0 |
| EVENT-02 | `event_rsvp_create` returns 'going' when count < capacity | unit | `deno test supabase/functions/__tests__/event_rsvp_create.test.ts --no-check` | ❌ Wave 0 |
| EVENT-02 | `event_rsvp_create` returns 'waitlist' when count = capacity | unit | same file | ❌ Wave 0 |
| EVENT-02 | Capacity race: 10 concurrent RSVPs at capacity=5 → exactly 5 going + 5 waitlist | integration (Postgres concurrent txn) | `npx vitest run tests/integration/event-rsvp-capacity-race.test.ts` | ❌ Wave 0 |
| EVENT-02 | Waitlist FIFO promotion: cancel #1 promotes head; cancel #2 promotes next | unit (trigger behavior) | `npx vitest run tests/integration/waitlist-fifo-promotion.test.ts` | ❌ Wave 0 |
| EVENT-02 | Concurrent cancels do not double-promote (SKIP LOCKED proof) | integration (concurrent txn) | `npx vitest run tests/integration/waitlist-concurrent-cancel.test.ts` | ❌ Wave 0 |
| EVENT-03 | `event-join-url` returns URL when caller has rsvp_status='going' | unit (Deno) | `deno test supabase/functions/event-join-url/index.test.ts --no-check` | ❌ Wave 0 |
| EVENT-03 | `event-join-url` returns 403 when caller has rsvp_status='maybe' / 'not_going' | unit (Deno) | same file | ❌ Wave 0 |
| EVENT-03 | `event-join-url` returns 403 when caller has no RSVP row | unit (Deno) | same file | ❌ Wave 0 |
| EVENT-03 | `zoom-create-meeting` posts to Zoom OAuth then meetings API; writes back join_url + zoom_meeting_id | unit (Deno + mock fetch) | `deno test supabase/functions/zoom-create-meeting/index.test.ts --no-check` | ❌ Wave 0 |
| EVENT-03 | `zoom-create-meeting` refetches token + retries once on 401 | unit (Deno + mock fetch) | same file | ❌ Wave 0 |
| EVENT-04 | Hourly cron: reminders fire for users whose local_start_at falls in [23h,25h) and [0h,2h) windows | unit (Deno + frozen time) | `deno test supabase/functions/event-reminders-fanout/index.test.ts --no-check` | ❌ Wave 0 |
| EVENT-04 | Reminder dedup: second cron tick on same user/event/kind does NOT send (UNIQUE on event_reminder_sent) | integration | `npx vitest run tests/integration/reminder-dedup.test.ts` | ❌ Wave 0 |
| EVENT-04 | PHI router branch: event in org-scoped space → SES path; event in global space → Resend path | unit (Deno + email-router mock) | `deno test supabase/functions/event-reminders-fanout/phi-routing.test.ts --no-check` | ❌ Wave 0 |
| EVENT-04 | Per-user-TZ predicate: user with timezone='America/Los_Angeles' fires at correct UTC tick | unit (Deno + frozen time, multiple TZs) | same file as above | ❌ Wave 0 |
| EVENT-05 | `mux-webhook` `event-recording` branch with `attach_to_module_id` NOT NULL → inserts course_lessons row | unit (Deno + mock @mux + admin) | `deno test supabase/functions/mux-webhook/event-recording.test.ts --no-check` | ❌ Wave 0 |
| EVENT-05 | `mux-webhook` `event-recording` branch with `attach_to_module_id` NULL → writes events.recording_* and does NOT insert course_lessons | unit (Deno) | same file | ❌ Wave 0 |
| EVENT-05 | `mux-webhook` `event-recording` branch with missing event_id passthrough → log + 200 (no retry loop) | unit (Deno) | same file | ❌ Wave 0 |
| Bundle | `events` chunk ≤25 kB gz | CI bundle gate | `npm run build && bash scripts/assert-bundle-budget.sh` | ❌ Wave 2 |

### Sampling Rate

- **Per task commit:** `cd leanshot && npx vitest run --reporter=dot tests/events/ src/components/events/` (~5s once tests exist)
- **Per wave merge:** `cd leanshot && npm test -- --run` + `$HOME/.deno/bin/deno test --no-check supabase/functions/event-*/` (~60-90s)
- **Phase gate:** Full suite green before `/gsd-verify-work` + bundle budget assertion + cross-tenant RLS impersonation proof + capacity race proof.

### Wave 0 Gaps

- [ ] `tests/rls/event-visibility.test.ts` — cross-space RLS visibility (EVENT-01)
- [ ] `tests/rls/event-visibility-orgscope.test.ts` — cross-tenant impersonation proof for org-scoped events (EVENT-01)
- [ ] `tests/rls/event-visibility-tiergate.test.ts` — min_tier RLS gate (EVENT-01)
- [ ] `supabase/functions/__tests__/event_rsvp_create.test.ts` — SECDEF RPC unit tests (EVENT-02)
- [ ] `tests/integration/event-rsvp-capacity-race.test.ts` — concurrent RSVP race test (EVENT-02)
- [ ] `tests/integration/waitlist-fifo-promotion.test.ts` — FIFO promotion (EVENT-02)
- [ ] `tests/integration/waitlist-concurrent-cancel.test.ts` — SKIP LOCKED proof (EVENT-02)
- [ ] `supabase/functions/event-join-url/index.test.ts` — RSVP-gate access check (EVENT-03)
- [ ] `supabase/functions/zoom-create-meeting/index.test.ts` — S2S OAuth + retry-on-401 (EVENT-03)
- [ ] `supabase/functions/event-reminders-fanout/index.test.ts` — windowing + dedup (EVENT-04)
- [ ] `supabase/functions/event-reminders-fanout/phi-routing.test.ts` — Resend vs SES branch (EVENT-04)
- [ ] `tests/integration/reminder-dedup.test.ts` — UNIQUE constraint dedup (EVENT-04)
- [ ] `supabase/functions/mux-webhook/event-recording.test.ts` — kind discriminator + attach_to_module_id branching (EVENT-05)
- [ ] `scripts/assert-bundle-budget.sh` — extend with `events` chunk 25 kB gz ceiling (Wave 2)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (existing); `event_rsvp_create` requires `auth.uid()`; `zoom-create-meeting` requires admin role via `is_staff()` helper; `event-reminders-fanout` requires service-role bearer (`checkServiceRoleBearer`). |
| V3 Session Management | yes (inherited) | Supabase session cookies + JWT (existing). No new session surface. |
| V4 Access Control | yes | RLS on `events` inherits from `community_spaces` (org_id + min_tier); RLS hides `join_url` + `zoom_meeting_id` columns from non-attendees + non-creators; `event-join-url` Edge Fn enforces RSVP gate. |
| V5 Input Validation | yes | RPC parameters CHECKed against enum; Storage bucket MIME whitelist (jpeg/png/webp) + 2MB cap; markdown rendered via Phase 44 dompurify policy; Zoom API response validated against expected shape before write-back. |
| V6 Cryptography | partial | NO new HMAC / token-mint code in Phase 47 (cert-verify-token is Phase 46). Zoom OAuth client secret stored in Supabase Function Secrets (encrypted at rest). |
| V9 Communications | yes | All Zoom + Mux + Supabase calls over HTTPS. Mux webhook HMAC-verified via `mux.webhooks.verifySignature()`. |
| V10 Malicious Code | yes | dompurify on markdown; Storage MIME whitelist on cover uploads. |
| V12 File Upload | yes | `event-covers` bucket — admin-only write, MIME whitelist (3 types), 2MB cap, path-prefixed by event_id. |

### Known Threat Patterns for `events` / `event_rsvps` / `event_reminder_sent`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Non-attendee retrieves meeting URL | Info Disclosure | RLS column policy hides `join_url`; Edge Fn double-checks `rsvp_status='going'` |
| Capacity race (TOCTOU between count and INSERT) | Tampering | `SELECT … FOR UPDATE` on events row inside SECDEF RPC serializes the read-then-write |
| Waitlist double-promotion under concurrent cancels | Tampering | `FOR UPDATE SKIP LOCKED` on waitlist head |
| Direct DB write of `event_rsvps.status='waitlist'` | Tampering | Client can only request via RPC; RPC enforces "client cannot ask for waitlist" |
| Cross-tenant probe of org-scoped event existence | Info Disclosure | RLS predicate `community_spaces.org_id IS NULL OR org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())` |
| Spoofed Mux webhook → fake recording attachment | Spoofing | `mux.webhooks.verifySignature()` HMAC verify before any DB write |
| PHI leak to Resend (non-BAA vendor) | Repudiation / HIPAA breach | `_shared/email-router.ts` `phi:true` branches to SES; never falls back to Resend on SES failure |
| Zoom S2S token theft from logs | Info Disclosure | NEVER log Authorization header; NEVER log token; constant-time-compare for any future bearer check |
| RSVP enumeration of org-scoped events via timing | Info Disclosure | RLS at SELECT time hides rows; consistent response shape from `event-join-url` (always 403 vs 401 for non-RSVP'd) |
| Pre-event meeting URL sharing | Info Disclosure | Optional: `event-join-url` rejects until `now() >= start_at - 15min` (planner picks) |
| Storage bucket directory traversal | Tampering | Path-prefix RLS `event-covers/{event_id}/*`; admin-write only |
| Cron HTTP-invoke replay from arbitrary caller | Spoofing | `event-reminders-fanout` requires `Bearer <sb_secret_*>` via `checkServiceRoleBearer` |

---

## Sources

### Primary (HIGH confidence)

- Phase 47 CONTEXT.md (D-01..D-16) — `.planning/phases/47-m4-events-calendar-zoom-reminders-recording/47-CONTEXT.md`
- Phase 38 weekly-digest cron migration — `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` (read directly)
- Phase 44 `community_spaces` schema — `supabase/migrations/20270720000001_p44_community_schema.sql` (referenced by CONTEXT)
- Phase 44 `mux-webhook` — `supabase/functions/mux-webhook/index.ts` (read directly — passthrough shape + signature verify pattern)
- Phase 44 `mux-create-upload` — `supabase/functions/mux-create-upload/index.ts` (read passthrough write pattern)
- Phase 25 `email-router.ts` — `supabase/functions/_shared/email-router.ts` (read directly — PHI flag handling + SES-no-fallback rule)
- `_shared/lifecycle-utils.ts` — `checkServiceRoleBearer`, `constantTimeEqual`, `bearerFromReq` (grepped)
- Phase 44 tier-gate — `leanshot/src/lib/community/tier-gate.ts` (read directly)
- Live DB pre-check via `npx -y supabase db query --linked` (verified 2026-05-23)
- Live secrets list via `npx -y supabase secrets list` (verified 2026-05-23)
- Phase 46 RESEARCH.md (precedent for Mux pipeline extension + Mux passthrough `kind`) — `.planning/phases/46-m4-courses-classroom/46-RESEARCH.md`
- Memory: `reference_supabase_pg_cron_vault_service_role_pattern`
- Memory: `reference_postgres_dollar_quote_nesting_in_cron_body`
- Memory: `reference_postgres_no_insert_on_conflict_do_delete`
- Memory: `reference_supabase_service_role_key_format_divergence`
- Memory: `reference_mux_video_view_event_for_antiskip` (2026-05-23 — video.view does NOT exist)
- Memory: `feedback_rpc_auth_uid_vs_service_role_mismatch`
- Memory: `reference_supabase_functions_deploy_import_map_flag` (CLI v2.101.0 silently ignores `--import-map`)
- Memory: `reference_supabase_migration_filename_regex` (14-digit strict)
- Memory: `feedback_live_db_precheck_inverts_research_grep`
- Memory: `feedback_vendor_secret_preflight_surface`
- Memory: `reference_react_router_consumer_admin_split`
- Memory: `reference_supabase_is_staff_helper`
- Zoom S2S OAuth official docs — https://developers.zoom.us/docs/internal-apps/s2s-oauth/ (token endpoint, TTL, Basic auth)

### Secondary (MEDIUM confidence)

- Zoom Meeting API web search (2026-05-23) — confirmed `meeting:write:admin` scope + `join_url` in create response. Multiple devforum + medium articles cross-referenced.
- `lucide-react` icon names `Calendar` vs `CalendarDays` — verified visually known both exist in package; recommended `CalendarDays` based on UX rationale (not from current docs lookup; package is well-established).

### Tertiary (LOW confidence)

- Zoom standard-account dangling-meeting cost — A1 assumption; not directly verified. Flag for v2.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every library/module is already in production; no new npm deps.
- Architecture: HIGH — every pattern has a direct precedent in Phase 25/35/38/44/46.
- Pitfalls: HIGH — six of seven pitfalls are direct memory references with documented incidents; pitfall 7 is the only LOW.
- Validation Architecture: HIGH — Vitest + Deno test frameworks already wired; Wave 0 gaps are concrete file paths.
- Security: HIGH — ASVS categories mapped to inherited controls; threat patterns map to existing mitigations.
- Live-DB pre-check: HIGH — directly verified 2026-05-23 against the linked project.

**Research date:** 2026-05-23
**Valid until:** 2026-06-23 for stable claims (schema, RLS patterns, Phase 38 cron template); 2026-05-30 for Zoom API specifics (rate limits / scopes can shift) and Supabase CLI behavior.
