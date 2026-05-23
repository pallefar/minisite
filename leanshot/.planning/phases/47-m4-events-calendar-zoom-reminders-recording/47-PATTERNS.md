# Phase 47: M4 Events Calendar + Zoom + Reminders + Recording — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 38 net-new / 2 EXTEND
**Analogs found:** 38 / 38 (100% coverage)

> **Critical correction from CONTEXT D-13 / RESEARCH §Architectural Responsibility Map:** The CONTEXT note that "admin uses react-router-dom" is **incorrect for THIS codebase.** Live audit (2026-05-23) of `src/admin/modules/community/CommunityAdminLayout.tsx`, `src/admin/modules/reviews/ReviewsLayout.tsx`, and `src/admin/AdminShell.tsx` confirms admin modules use **pathname-based routing only** (per `leanshot/CLAUDE.md` "No router" rule applied to the entire SPA). The memory `reference_react_router_consumer_admin_split` notes react-router exists in admin surfaces (AdminShell, admin/rag, admin/reviews) but in practice admin/community + admin/reviews use pathname-string switching, NOT `<Route>` syntax. Phase 47 admin module **MUST follow the pathname-based pattern** to match recent precedent (Phase 44 plan 44-09).
>
> Planner: copy the `CommunityAdminLayout` pattern verbatim; do **not** introduce `<Routes>`/`<Route>` JSX.

> **Phase 46 dependency:** Live-DB pre-check confirms `course_modules` + `course_lessons` are NOT in production. Phase 47 migrations referencing `course_modules(id)` MUST use timestamps `>` Phase 46's. Phase 46 migrations land in `20270720*..20270730*` window; Phase 47 uses `20270801*` per RESEARCH §Recommended Project Structure.

---

## File Classification

### Database (migrations)

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `supabase/migrations/20270801000001_p47_events_schema.sql` | schema | CRUD | `supabase/migrations/20270720000001_p44_community_schema.sql` | exact | FORK |
| `supabase/migrations/20270801000002_p47_events_rls.sql` | RLS | request-response | `supabase/migrations/20270720000002_p44_community_rls.sql` | exact | FORK |
| `supabase/migrations/20270801000003_p47_event_rsvp_secdef.sql` | SECDEF RPC | CRUD | `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` + `20270708000005_p35_freeze_tokens_ledger.sql` | exact (combined) | FORK |
| `supabase/migrations/20270801000004_p47_waitlist_promotion_trigger.sql` | trigger fn | event-driven | `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` (SECDEF pattern) + Phase 24 events_mirror trigger | role-match | FORK |
| `supabase/migrations/20270801000005_p47_event_covers_bucket.sql` | storage bucket | file-I/O | `supabase/migrations/20270720000003_p44_community_media_bucket.sql` | exact | FORK |
| `supabase/migrations/20270801000006_p47_notification_event.sql` | CHECK widening | schema | `supabase/migrations/20270720000004_p44_notification_community.sql` | exact | FORK (verbatim recipe — drop+add CHECK on 4 tables in one txn) |
| `supabase/migrations/20270801000010_p47_pg_cron_schedules.sql` | cron | event-driven | `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` (job 1: weekly-digest-hourly-fanout) | exact | VERBATIM (copy single-job block; swap tags) |

### Edge Functions

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|---------------------|------|-----------|----------------|---------------|------------|
| `supabase/functions/event-reminders-fanout/index.ts` | service | event-driven | `supabase/functions/notify-community/index.ts` + Phase 38 weekly-digest pattern in `_shared/lifecycle-utils.ts` | role-match | FORK |
| `supabase/functions/event-reminders-fanout/deno.json` | config | — | `supabase/functions/mux-webhook/deno.json` | exact | VERBATIM |
| `supabase/functions/event-join-url/index.ts` | service | request-response | `supabase/functions/mux-create-upload/index.ts` (auth+tier gate shape) — researcher cites `mux-sign-playback` but it does NOT exist in repo yet (Phase 46 ships it) | partial — best available | FORK |
| `supabase/functions/event-join-url/deno.json` | config | — | `supabase/functions/mux-webhook/deno.json` | exact | VERBATIM |
| `supabase/functions/zoom-create-meeting/index.ts` | service | request-response | `supabase/functions/mux-create-upload/index.ts` (auth + admin gate + service-role write-back) | role-match | FORK |
| `supabase/functions/zoom-create-meeting/deno.json` | config | — | `supabase/functions/mux-webhook/deno.json` | exact | VERBATIM |
| `supabase/functions/mux-create-upload/index.ts` | service | request-response | (self) | — | **EXTEND** — add `kind === 'event-recording'` branch + `passthrough.event_id` |
| `supabase/functions/mux-webhook/index.ts` | service | event-driven | (self) | — | **EXTEND** — add `passthrough.kind === 'event-recording'` dispatch branch |

### Client (consumer)

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `leanshot/src/components/events/EventsTab.tsx` | component | request-response | `leanshot/src/components/community/CommunityTabShell.tsx` | exact | FORK (Zustand `activeEventId` mirrors `activeCommunitySpaceId`) |
| `leanshot/src/components/events/EventCard.tsx` | component | request-response | `leanshot/src/components/community/CommunityPost.tsx` | role-match | FORK (Card + body + media-strip layout idiom) |
| `leanshot/src/components/events/EventDetailSheet.tsx` (RESEARCH calls it `EventDrillIn.tsx` — pick one) | component | request-response | `leanshot/src/components/community/CommunitySpaceView.tsx` | role-match | FORK |
| `leanshot/src/components/events/RsvpPills.tsx` | component | request-response | `leanshot/src/components/community/ReactionBar.tsx` | exact (pill-toggle idiom) | FORK |
| `leanshot/src/components/events/JoinMeetingButton.tsx` | component | request-response | `leanshot/src/components/community/media/CommunityVideoPlayer.tsx` (signed-URL fetch pattern) | partial | FORK (use `supabase.functions.invoke('event-join-url')` instead of storage signed URL) |
| `leanshot/src/lib/events/event-types.ts` | types | — | `leanshot/src/lib/community/community-types.ts` | exact | FORK (LOCKED type module idiom) |
| `leanshot/src/lib/events/rsvp-client.ts` | client lib | request-response | `leanshot/src/lib/community/community-storage.ts` (RPC wrapper shape) | role-match | FORK |
| `leanshot/src/types/index.ts` (MODIFY) | types | — | (self) | — | **EXTEND** — add `'events'` to `TabId` union |
| `leanshot/src/App.tsx` (MODIFY) | router | — | (self, current Community case) | — | **EXTEND** — add `case 'events':` with `<Suspense>` lazy import |
| `leanshot/src/lib/store.ts` (MODIFY) | state | — | (self, `activeCommunitySpaceId`) | — | **EXTEND** — add `activeEventId: string\|null` + `setActiveEvent` action |

### Client (admin) — **pathname-based, NOT react-router**

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `leanshot/src/admin/modules/events/AdminEventsLayout.tsx` | layout | request-response | `leanshot/src/admin/modules/community/CommunityAdminLayout.tsx` | exact | FORK |
| `leanshot/src/admin/modules/events/EventListPage.tsx` | component | request-response | `CommunityAdminLayout.tsx` `SpacesListPage` (inner subcomponent) | exact | FORK (extract to sibling file) |
| `leanshot/src/admin/modules/events/EventEditPage.tsx` | component | request-response | `leanshot/src/admin/modules/community/SpaceEditor.tsx` | exact | FORK (richer form: title/description/start_at/end_at/capacity + Zoom radio + attach-to-module picker + cover upload) |
| `leanshot/src/admin/modules/events/EventAttendeesPane.tsx` | component | request-response | `CommunityAdminLayout.tsx` `SpacesListPage` list-rendering idiom | partial | FORK (renders RSVP roster with capacity/waitlist counts) |
| `leanshot/src/admin/modules/events/EventRecordingUploader.tsx` | component | file-I/O | `leanshot/src/components/community/media/CommunityMediaUploader.tsx` (Mux uploader pattern) | exact | FORK (pass `kind: 'event-recording', event_id` to `mux-create-upload`) |
| `leanshot/src/admin/modules/events/manifest.ts` | config | — | `leanshot/src/admin/modules/community/` registration in `src/lib/admin/modules.ts` | role-match | FORK (per memory `feedback_admin_module_manifest_vs_router_branch_drift` — also add the URL-prefix catch-all branch in `AdminShell` if not generic) |

### Tests (Wave 0 contract per RESEARCH §Validation Architecture)

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `leanshot/tests/rls/event-visibility-tier-gating.test.ts` | RLS test | request-response | `leanshot/tests/rls/community-tier-gating-rls.test.ts` | exact | FORK |
| `leanshot/tests/rls/event-visibility-org-isolation.test.ts` | RLS test | request-response | `leanshot/tests/rls/community-spaces-rls.test.ts` | exact | FORK |
| `leanshot/tests/rls/event-join-url-column-hidden.test.ts` | RLS test | request-response | `leanshot/tests/rls/community-spaces-rls.test.ts` | role-match | FORK (column-RLS variant) |
| `leanshot/tests/rls/fixtures-events.ts` | fixtures | — | `leanshot/tests/rls/fixtures-community.ts` | exact | FORK (add event/event_rsvp seed helpers) |
| `leanshot/tests/integration/event-rsvp-capacity-race.test.ts` | integration | event-driven | `leanshot/tests/integration/community-mention-notification.test.ts` (env+admin+JWT idiom) + Phase 35 freeze-token-race test if present | role-match | FORK |
| `leanshot/tests/integration/waitlist-fifo-promotion.test.ts` | integration | event-driven | `leanshot/tests/integration/community-mention-notification.test.ts` | role-match | FORK |
| `leanshot/tests/integration/waitlist-concurrent-cancel.test.ts` | integration | event-driven | same | role-match | FORK |
| `leanshot/tests/integration/reminder-dedup.test.ts` | integration | event-driven | `leanshot/tests/integration/notification-frequency-cap.test.ts` (UNIQUE-constraint idempotency idiom) | role-match | FORK |
| `supabase/functions/__tests__/event_rsvp_create.test.ts` | RPC test | request-response | `supabase/functions/__tests__/community-mention-notification.test.ts` | role-match | FORK |
| `supabase/functions/event-join-url/index.test.ts` | Fn test | request-response | `supabase/functions/mux-create-upload/index.test.ts` | exact | FORK |
| `supabase/functions/zoom-create-meeting/index.test.ts` | Fn test | request-response | `supabase/functions/mux-create-upload/index.test.ts` | exact | FORK |
| `supabase/functions/event-reminders-fanout/index.test.ts` | Fn test | event-driven | `supabase/functions/notify-community/index.test.ts` | exact | FORK |
| `supabase/functions/event-reminders-fanout/phi-routing.test.ts` | Fn test | event-driven | `supabase/functions/_shared/email-router.test.ts` | role-match | FORK |
| `supabase/functions/mux-webhook/event-recording.test.ts` | Fn test (extension) | event-driven | `supabase/functions/mux-webhook/index.test.ts` (extend pattern) | exact | FORK |

### Build config

| Modified File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|---------------|------|-----------|----------------|---------------|------------|
| `leanshot/vite.config.ts` (MODIFY) | config | — | (self, Phase 44 Plan 09 community chunk rule) | — | **EXTEND** — insert `events` chunk rule **before** the catch-all, sibling to community chunk rule (lines around the `/src/components/community/` test) |

---

## Pattern Assignments

### A. Database: `events` schema migration

**New file:** `supabase/migrations/20270801000001_p47_events_schema.sql`
**Analog:** `supabase/migrations/20270720000001_p44_community_schema.sql`
**Reuse mode:** FORK

**Header pattern to inherit (lines 1-22 of analog):**
```sql
-- Phase 47 Plan 01 — Events schema: events + event_rsvps + event_reminder_sent + event_promotion_queue.
--
-- Decisions implemented:
--   D-01: events.space_id NOT NULL → community_spaces(id) ON DELETE CASCADE
--   D-02: capacity integer NOT NULL DEFAULT 0 (0=unlimited)
--   D-05: event_rsvps.status text CHECK ('going','maybe','not_going','waitlist')
--   D-10: event_reminder_sent UNIQUE(event_id, user_id, kind) with kind CHECK ('1d','1h','promotion')
--   D-15: events.attach_to_module_id uuid REFERENCES course_modules(id)
--   D-16: events.cover_url text (path in event-covers bucket)
--
-- Per reference_supabase_migration_filename_regex: strict 14-digit timestamp.
-- FK to course_modules(id): Phase 46 must be applied first.

begin;
```

**Table declaration idiom (lines 28-50 of analog):**
```sql
create table if not exists public.events (
  id          uuid        primary key default gen_random_uuid(),
  space_id    uuid        not null references public.community_spaces(id) on delete cascade,
  title       text        not null,
  -- … (per CONTEXT D-01 column list)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint events_time_chk check (end_at > start_at)
);

comment on table public.events is 'P47 D-01: Events live in a community space; visibility + tier-gate inherited from space.';
```

**Indexes** (D-01): `create index events_space_start_idx on events (space_id, start_at);` and `create index events_start_idx on events (start_at);` — mirror Phase 44 `community_posts_space_created_idx` shape (lines 75-77 of analog).

**Transaction wrap:** `begin; … commit;` (analog line 24 / file end).

---

### B. Database: SECDEF RPC `event_rsvp_create`

**New file:** `supabase/migrations/20270801000003_p47_event_rsvp_secdef.sql`
**Primary analog:** `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` (function shell, `auth.uid()` guard, ERRCODE pattern)
**Secondary analog:** RESEARCH §Code Examples Example 1 (RPC body — already pinned by researcher)
**Reuse mode:** FORK

**Function shell pattern (lines 30-50 of analog):**
```sql
create or replace function public.event_rsvp_create(
  p_event_id uuid,
  p_status   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  -- … body per RESEARCH Example 1 (SELECT FOR UPDATE + branch INSERT/UPDATE)
end;
$fn$;

revoke all on function public.event_rsvp_create(uuid, text) from public;
grant execute on function public.event_rsvp_create(uuid, text) to authenticated;
```

**Conventions to inherit verbatim:**
1. `language plpgsql security definer set search_path = public, extensions` (per memory `reference_supabase_migration_gotchas`).
2. `raise exception '<code>' using errcode = '<sqlstate>'` — use `42501` (unauthenticated), `22023` (invalid_argument), `P0002` (not_found).
3. `revoke all from public` + `grant execute to authenticated` (NEVER service_role per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
4. Use `INSERT … ON CONFLICT (event_id, user_id) DO UPDATE SET …` per RESEARCH Example 1 — UPDATE branch is fine; **never use `ON CONFLICT DO DELETE`** (per memory `reference_postgres_no_insert_on_conflict_do_delete`).

---

### C. Database: waitlist promotion trigger

**New file:** `supabase/migrations/20270801000004_p47_waitlist_promotion_trigger.sql`
**Analog:** RESEARCH §Code Examples Example 2 (skeleton) + SECDEF shell from Phase 44 SECDEF RPC migration
**Reuse mode:** FORK (RESEARCH skeleton lands verbatim)

**Key conventions:**
1. `SELECT … FOR UPDATE SKIP LOCKED` — load-bearing for concurrent-cancel safety (per RESEARCH Pitfall 5).
2. `SET app.suppress_audit = 'true'` GUC inside the trigger if the promotion UPDATE would trigger audit cascade (per memory `reference_supabase_migration_gotchas`).
3. Insert into `event_promotion_queue` with `on conflict (event_id, user_id) do nothing` (defensive; fan-out drains).
4. **No `$$ … $$` dollar-quoting if nested with cron migration** — this file is standalone so `as $fn$ … $fn$` is safe.

---

### D. Database: pg_cron migration

**New file:** `supabase/migrations/20270801000010_p47_pg_cron_schedules.sql`
**Analog:** `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` — copy ONLY job 1 (`phase38-weekly-digest-hourly-fanout`)
**Reuse mode:** VERBATIM (only fn URL + tag names change)

**Excerpt to copy (lines 30-86 of analog, plus 49-end of analog for the schedule body):**
```sql
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
  do $reminders$    -- ← UNIQUE inner tag per reference_postgres_dollar_quote_nesting_in_cron_body
  declare
    fn_url      constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/event-reminders-fanout';
    service_key text;
  begin
    select decrypted_secret
      into service_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if service_key is null then
      raise notice 'phase47-event-reminders-hourly: service_role_key vault entry missing — skipping fan-out';
      return;
    end if;

    perform net.http_post(
      url := fn_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type',  'application/json'
      ),
      timeout_milliseconds := 60000
    );
  end;
  $reminders$;
  $cron$
);
```

**Critical**: inner tag MUST be `$reminders$` (NOT `$digest$` — that's Phase 38; collision risk). Project ref `ytnsipxxmzgaebkqmokp` hardcoded per memory `reference_supabase_pg_cron_vault_service_role_pattern`.

---

### E. Database: notification CHECK widening

**New file:** `supabase/migrations/20270801000006_p47_notification_event.sql`
**Analog:** `supabase/migrations/20270720000004_p44_notification_community.sql`
**Reuse mode:** FORK (verbatim recipe — drop+add CHECK on the same 4 tables in one transaction)

**Excerpt to copy and extend (lines 17-49 of analog):**
```sql
begin;

-- D-19: add 3 categories: event_reminders_1d, event_reminders_1h, event_promotion.
alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add  constraint notification_settings_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'event_reminders_1d','event_reminders_1h','event_promotion'   -- ← P47 additions
    ));
-- Repeat for: notification_category_config, user_notifications, notification_dismissal_state.

-- Default ON for existing users:
insert into public.notification_settings (user_id, category, in_app, email)
select id, c.category, true, true
  from public.profiles, (values ('event_reminders_1d'),('event_reminders_1h'),('event_promotion')) as c(category)
on conflict (user_id, category) do nothing;

commit;
```

**Critical:** all 4 tables MUST land in ONE transaction (per memory `feedback_planner_missed_status_enum_widening`). Naming: use underscores (`event_reminders_1d`) — matches D-19 explicit choice.

---

### F. Database: event-covers Storage bucket

**New file:** `supabase/migrations/20270801000005_p47_event_covers_bucket.sql`
**Analog:** `supabase/migrations/20270720000003_p44_community_media_bucket.sql`
**Reuse mode:** FORK

**Excerpt (lines 25-40 of analog):**
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-covers',
  'event-covers',
  true,                                              -- public read (D-16) — diverges from community-media which is private
  2097152,                                           -- 2 MB cap per D-16 (vs 10 MB community-media)
  array['image/jpeg','image/png','image/webp']      -- NO svg per T-44-04 idiom
)
on conflict (id) do nothing;
```

**Divergences from analog:** `public=true` (not false); 2 MB (not 10 MB). RLS INSERT path-check still uses `(storage.foldername(name))[1] = '<event_id>'` BUT admin-only — wrap in `auth.uid() in (select user_id from event admin staff…)` OR simpler: `public.is_staff()` check (per memory `reference_supabase_is_staff_helper`).

---

### G. Edge Fn: `event-reminders-fanout`

**New file:** `supabase/functions/event-reminders-fanout/index.ts`
**Primary analog:** `supabase/functions/notify-community/index.ts` (HMAC + service-role-bearer dual auth + fan-out loop)
**Secondary analog:** RESEARCH §Code Examples Example 3 (skeleton already pinned)
**Reuse mode:** FORK

**Imports + CORS pattern (lines 30-50 of analog):**
```typescript
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function jsonError(status: number, code: string): Response { return jsonResponse(status, { error: code }); }
function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}
```

**Service-role-bearer auth** (per memory `reference_supabase_service_role_key_format_divergence`): use `checkServiceRoleBearer` from `_shared/lifecycle-utils.ts` (NOT a raw `===` compare — the helper handles `sb_secret_*` vs legacy JWT formats and uses `constantTimeEqual`).

**Email send call** (per Phase 25 D-03): `await sendEmail({ to, template, phi: <space.org_id IS NOT NULL>, vars })` — `phi` MUST be derived from the event's space `org_id` at template-render time. Helper file recommendation: `supabase/functions/_shared/event-phi.ts` (NEW, per RESEARCH Pitfall 6).

**Deno.serve guard** (per memory `reference_deno_test_top_level_serve_trap`):
```typescript
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
```

---

### H. Edge Fn: `event-join-url`

**New file:** `supabase/functions/event-join-url/index.ts`
**Primary analog:** `supabase/functions/mux-create-upload/index.ts` (auth+admin gate + RPC return)
**Reuse mode:** FORK

**User-JWT auth pattern (lines 28-50 of analog):**
```typescript
const auth = req.headers.get('Authorization') ?? '';
const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { global: { headers: { Authorization: auth } } }
);
const { data: { user } } = await supa.auth.getUser();
if (!user) return jsonError(401, 'unauthorized');
```

**RSVP gate** (per CONTEXT D-09): use a SECDEF helper RPC `event_get_join_url(p_event_id uuid) returns jsonb` that internally checks `(rsvp_status='going') AND (now() BETWEEN start_at - interval '15 minutes' AND end_at)` per D-18. Return shape: `{ url: text }` or `{ error: 'too_early', opens_at: <iso> }` or `{ error: 'rsvp_required' }`. SECDEF body lives in the same migration as `event_rsvp_create` (item B above) OR a sibling migration.

---

### I. Edge Fn: `zoom-create-meeting`

**New file:** `supabase/functions/zoom-create-meeting/index.ts`
**Primary analog:** `supabase/functions/mux-create-upload/index.ts` (admin gate + service-role write-back)
**Secondary analog:** RESEARCH §Code Examples Example 5 (skeleton pinned)
**Reuse mode:** FORK

**Admin gate pattern (lines 50-75 of mux-create-upload — adapted from `is_staff()` precedent):**
```typescript
const { data: isAdmin } = await supa.rpc('is_staff');   // helper from migration 20261101000006
if (!isAdmin) return jsonError(403, 'forbidden');
```

**In-memory token cache** (per RESEARCH Pitfall 2): per-instance module-level `let _cachedToken: { value: string; expiresAt: number } | null = null;` — refresh 60s before expiry; on `401 from Zoom`, null the cache + retry once.

**Service-role write-back** (RESEARCH Example 5 lines 802-811):
```typescript
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
await admin.from('events').update({
  zoom_meeting_id: String(meeting.id),
  join_url:        meeting.join_url,
  zoom_managed:    true,
}).eq('id', body.event_id);
```

---

### J. Edge Fn extension: `mux-webhook`

**Modified file:** `supabase/functions/mux-webhook/index.ts`
**Reuse mode:** EXTEND (add branch)

**Insert AFTER the existing `community_posts` UPDATE branch.** New code pinned in RESEARCH §Code Examples Example 6 — lands verbatim. Key inheritance:
1. `passthrough` already parsed earlier in the existing handler; just dispatch on `passthrough?.kind === 'event-recording'`.
2. Uses the `admin` Proxy singleton already wired up in the file (lines 41-66 of existing index.ts).
3. Reads `course_lessons.order_index` max — Phase 46 schema. Phase 47 migration MUST land AFTER Phase 46 (per timestamps).

**Sibling-collision note (per memory `feedback_stub_then_replace_sibling_collision`):** Phase 46 and Phase 47 both EXTEND `mux-webhook/index.ts`. Plan ordering:
- Phase 46 ships the `passthrough.kind` dispatch shape (introduces the `kind === 'course-lesson'` branch).
- Phase 47 adds the third branch `'event-recording'`.
- **Stub-then-replace not needed** because phases are serial (Phase 47 starts after Phase 46 merges to main).

---

### K. Edge Fn extension: `mux-create-upload`

**Modified file:** `supabase/functions/mux-create-upload/index.ts`
**Reuse mode:** EXTEND

**Add the `kind` field to passthrough.** Today the file writes `passthrough: JSON.stringify({ user_id, post_id })` (line 30 in current file). Phase 46 widens this to also support `{ kind: 'course-lesson', lesson_id, course_id }`. Phase 47 adds the third caller:
```typescript
// caller can now pass body = { kind: 'event-recording', event_id }
// passthrough = { kind: 'event-recording', event_id, user_id }
```
**Tier gate** (existing line 24-26): keep — admin uploading event recording still needs Pro/Lifetime tier; OR add explicit `is_staff()` bypass. Plan-decision.

---

### L. Consumer: `EventsTab.tsx` (tab shell)

**New file:** `leanshot/src/components/events/EventsTab.tsx`
**Analog:** `leanshot/src/components/community/CommunityTabShell.tsx`
**Reuse mode:** FORK

**File preamble pattern (lines 1-15 of analog):**
```typescript
/**
 * Phase 47 Plan NN — EventsTab (consumer surface).
 *
 * Consumer-surface tab shell for the Events section.
 * Uses Zustand store for list-vs-detail navigation (per CLAUDE.md no-router rule).
 * NO react-router-dom usage here — consumer surface is entirely Zustand-tab-driven.
 *
 * list view  (activeEventId === null) → <EventList>
 * detail view (activeEventId !== null) → <EventDetailSheet>
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { useStore } from '@/lib/store';
```

**Lazy sub-imports + dispatch idiom (lines 22-35 of analog):**
```typescript
const EventList         = lazy(() => import('./EventList').then((m) => ({ default: m.EventList })));
const EventDetailSheet  = lazy(() => import('./EventDetailSheet').then((m) => ({ default: m.EventDetailSheet })));

export default function EventsTab() {
  const activeEventId = useStore((s) => s.activeEventId);
  const setActiveEvent = useStore((s) => s.setActiveEvent);
  // … list-vs-detail render switch
}
```

---

### M. Consumer: `EventCard.tsx`

**New file:** `leanshot/src/components/events/EventCard.tsx`
**Analog:** `leanshot/src/components/community/CommunityPost.tsx` (Card composition idiom)
**Reuse mode:** FORK

**Conventions to inherit:**
1. `import { Card, CardHeader } from '@/components/ui/Card';` — span={6}/{8} for the 12-col bento grid.
2. `import { Pill } from '@/components/ui/Pill';` for RSVP toggle pills with `aria-pressed`.
3. Lucide icons via `import { CalendarDays, Users, MapPin } from 'lucide-react';` — `aria-hidden` on decorative icons per CLAUDE.md a11y rules.
4. Format dates via existing `helpers.ts` (do NOT introduce new date lib).

---

### N. Consumer: `RsvpPills.tsx`

**New file:** `leanshot/src/components/events/RsvpPills.tsx`
**Analog:** `leanshot/src/components/community/ReactionBar.tsx` (toggle-pill array idiom)
**Reuse mode:** FORK

**Inherit pattern:** call SECDEF RPC via `supabase.rpc('event_rsvp_create', { p_event_id, p_status })` (analog calls `toggle_community_reaction`). Optimistic update + revert on error (per ReactionBar). Show capacity bar + "X going / Y waitlist" badge inline.

---

### O. Consumer: `lib/events/event-types.ts`

**New file:** `leanshot/src/lib/events/event-types.ts`
**Analog:** `leanshot/src/lib/community/community-types.ts`
**Reuse mode:** FORK

**Preamble pattern (lines 1-9 of analog):**
```typescript
/**
 * Phase 47 Plan NN — Events: Shared TypeScript domain types.
 *
 * These types are LOCKED for all downstream events components.
 * Pure types, no runtime code, no imports.
 */
export type RsvpStatus = 'going' | 'maybe' | 'not_going' | 'waitlist';

export interface Event {
  id: string;
  space_id: string;
  title: string;
  // … per CONTEXT D-01 column list
}
```

---

### P. Consumer: `App.tsx` + `types/index.ts` + `store.ts` modifications

**Modified file:** `leanshot/src/types/index.ts`
**Action:** widen `TabId` union — add `'events'` between `'classroom'` and `'community'` (per D-13 nav order).

**Modified file:** `leanshot/src/App.tsx`
**Pattern:** add a new `case 'events':` in the existing tab switch, lazy-importing `EventsTab`. Mirror the existing `case 'community':` block verbatim.

**Modified file:** `leanshot/src/lib/store.ts`
**Pattern:** add `activeEventId: string | null` + `setActiveEvent: (id: string | null) => void` — mirror lines for `activeCommunitySpaceId`/`setActiveCommunitySpace` (already confirmed in store.ts). NOT persisted (lives in ephemeral UI slice).

---

### Q. Admin: `AdminEventsLayout.tsx`

**New file:** `leanshot/src/admin/modules/events/AdminEventsLayout.tsx`
**Analog:** `leanshot/src/admin/modules/community/CommunityAdminLayout.tsx`
**Reuse mode:** FORK (pathname-based — NO react-router)

**Preamble pattern (lines 1-22 of analog):**
```typescript
/**
 * Phase 47 Plan NN — AdminEventsLayout.
 *
 * Admin module entry for Events CRUD + Attendees + Recording uploader.
 *
 * Routing model: pathname-based (consistent with other admin modules
 * per ReviewsLayout.tsx, CommunityAdminLayout.tsx — no react-router-dom).
 *
 * Sub-routes (string-prefix match on window.location.pathname):
 *   /admin/events                   → EventListPage
 *   /admin/events/new               → EventEditPage (create)
 *   /admin/events/:id/edit          → EventEditPage (edit)
 *   /admin/events/:id/attendees     → EventAttendeesPane
 *   /admin/events/:id/recording     → EventRecordingUploader
 *
 * Admin surface — react-router-dom NOT required here; pathname-based switching
 * matches the existing project convention for admin modules.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
```

**Manifest registration** (per memory `feedback_admin_module_manifest_vs_router_branch_drift`): add the entry to `src/lib/admin/modules.ts` AND verify `AdminShell.tsx` has the URL-prefix catch-all branch for `/admin/events*` — if drift exists, plan should also patch `AdminShell` to add a generic branch.

---

### R. Admin: `EventEditPage.tsx`

**New file:** `leanshot/src/admin/modules/events/EventEditPage.tsx`
**Analog:** `leanshot/src/admin/modules/community/SpaceEditor.tsx`
**Reuse mode:** FORK

**Preamble pattern (lines 1-22 of analog):**
```typescript
/**
 * Phase 47 Plan NN — EventEditPage (admin surface).
 *
 * Admin CRUD form for events.
 *
 * Fields: title, description (markdown), start_at, end_at, capacity, space_id,
 *         Zoom radio (paste / generate), attach_to_module_id picker, cover image upload.
 *
 * Security:
 *   - UX layer: admin-only (AdminShell minRole gates module visibility)
 *   - DB layer: RLS event_insert_staff / event_update_staff require public.is_staff()
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
```

**Zoom radio choice:** on "Generate" submit, call `supabase.functions.invoke('zoom-create-meeting', { body: { event_id } })` AFTER the INSERT returns the row id.

**Attach-to-module picker:** dropdown populated by `supabase.from('course_modules').select('id, title, course:courses(title)').order('title')` — Phase 46 schema (must be applied first).

---

### S. Admin: `EventRecordingUploader.tsx`

**New file:** `leanshot/src/admin/modules/events/EventRecordingUploader.tsx`
**Analog:** `leanshot/src/components/community/media/CommunityMediaUploader.tsx`
**Reuse mode:** FORK

**Pass to mux-create-upload:** `body: { kind: 'event-recording', event_id }` (vs analog's `{ post_id }`).

---

### T. Tests

**RLS tests** — all forks of `community-spaces-rls.test.ts` (file-scoped `TEST_SLUG_PREFIX` per memory `feedback_rls_per_file_slug_prefix`; `getUserAccessToken` per memory `reference_rls_fixture_gotrueclient_flake`; admin-client teardown).

**Integration tests** — all forks of `community-mention-notification.test.ts` (env block, admin createClient, JWT mint via `helpers/admin-session`).

**Fn tests** — all forks of `mux-create-upload/index.test.ts` and `notify-community/index.test.ts` (`setVerifyForTest`/`setAdminForTest` injection seams; Deno.serve guard).

**Required file header for tests that hit live DB** (line 1 of analog `community-mention-notification.test.ts`):
```typescript
// REQUIRES: 47-NN supabase db push --linked + supabase functions deploy + ZOOM_S2S_* set in Function Secrets
```

---

### U. Build config: `vite.config.ts` events chunk rule

**Modified file:** `leanshot/vite.config.ts`
**Insertion point:** immediately AFTER the line `if (id.includes('/src/components/community/')) return 'community-feed';` and BEFORE `if (id.includes('/src/components/course/')) return 'course-player';`.

**Rule to add:**
```typescript
// Phase 47 Plan NN — events chunk (target ≤ 25 kB gz per CONTEXT bundle ceiling).
// Media/uploader NOT routed here — events tab uses no inline Mux Player v1 (D-17 link-out
// to classroom for recording playback). If Plan adds inline player, route '@mux/' to
// 'community-media' (already shared).
if (id.includes('/src/components/events/')) return 'events';
```

**Ordering matters** (per existing comment in analog). Do NOT route admin events files into `events` — admin path goes to `admin-shell` chunk via the earlier `/src/lib/admin/` rule (events admin module is under `src/admin/modules/events/`, so plan must verify the `/src/admin/` rule catches it — if not, add a sibling `if (id.includes('/src/admin/modules/events/')) return 'admin-shell';` rule).

---

## Shared Patterns (cross-cutting)

### Authentication / Authorization

**For SECDEF RPCs (event_rsvp_create, event_get_join_url):**
- `auth.uid()` guard; raise `'42501'` if NULL.
- `revoke all from public; grant execute to authenticated;` — **never** `service_role` (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
- `set search_path = public, extensions` (per memory `reference_supabase_migration_gotchas`).

**For service-role Edge Fns (event-reminders-fanout):**
- `checkServiceRoleBearer(req)` from `_shared/lifecycle-utils.ts` — handles `sb_secret_*` vs JWT formats (per memory `reference_supabase_service_role_key_format_divergence`).
- HMAC dual-auth optional (researcher Discretion); reuse Phase 38 winback pattern if planner picks.

**For user-JWT Edge Fns (event-join-url, zoom-create-meeting):**
- `createClient(URL, ANON_KEY, { global: { headers: { Authorization: auth } } })` + `supa.auth.getUser()`.
- For admin-only Fns (zoom-create-meeting): additional `supa.rpc('is_staff')` check returning 403 on false (per memory `reference_supabase_is_staff_helper`).

### RLS predicates (events table)

**Apply to:** `20270801000002_p47_events_rls.sql`

Reuse the **community_spaces** policy shape verbatim — events inherit visibility from their space:

```sql
-- SELECT: visible if the parent space is visible to the caller.
create policy event_select_via_space
  on public.events for select to authenticated
  using (
    exists (
      select 1 from public.community_spaces s
      where s.id = events.space_id
        and (
          -- global: org_id null AND user passes min_tier gate (mirror cpost_select_tier)
          (s.org_id is null and …tier-check…)
          or
          -- org-private: caller is org member
          (s.org_id is not null and exists (
            select 1 from public.org_members om
            where om.org_id = s.org_id and om.user_id = auth.uid()
          ))
        )
    )
  );

-- Column RLS: hide join_url + zoom_meeting_id from non-attendees + non-staff.
-- Use a SECDEF helper view OR a SECDEF RPC for the gated columns (per D-09).
```

### Error handling / response shape

**All Edge Fns:** use `jsonError(status, code)` helper — codes are snake_case strings (`'unauthorized'`, `'forbidden'`, `'rsvp_required'`, `'too_early'`, `'event_not_found'`). NEVER include stack traces or PII in body.

**All SECDEF RPCs:** `raise exception '<error_string>' using errcode = '<sqlstate>'` — caller `.rpc()` returns `{ error: { message, code, … } }`.

### PHI routing (load-bearing)

**Apply to:** every email/SMS send in `event-reminders-fanout/index.ts` and any new event-send Fn.

```typescript
// REQUIRED helper file: supabase/functions/_shared/event-phi.ts (NEW)
export async function getEventPhiFlag(admin: SupabaseClient, event_id: string): Promise<boolean> {
  const { data } = await admin
    .from('events')
    .select('community_spaces!inner(org_id)')
    .eq('id', event_id)
    .single();
  return (data?.community_spaces?.org_id ?? null) !== null;
}

// Usage:
await sendEmail({ to, template, phi: await getEventPhiFlag(admin, event_id), vars });
```

**Plan-checker grep guard:** every `sendEmail(` call in event-related Fns must have `phi: <expr-that-reads-org_id>` — bare `phi: false` is a HARD BLOCKER (per RESEARCH Pitfall 6).

### Deno.serve guard (test trap mitigation)

**Apply to:** every new Edge Fn `index.ts`.

```typescript
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
```

Per memory `reference_deno_test_top_level_serve_trap` — bare `Deno.serve(handler)` triggers HTTP server on `deno test` import.

### Migration timestamp ordering

- Phase 46 lands `course_modules` + `course_lessons` in `20270720*..20270730*` window (per Phase 46 plans).
- Phase 47 MUST use `20270801*` for ALL migrations to guarantee `course_modules` exists when `events.attach_to_module_id` FK is declared.
- Per memory `reference_migration_timestamp_collision_precheck` — pre-merge glob `20270801*.sql` to confirm no collision before push.

### Vendor secret pre-flight (Wave 0 dispatch)

**Per memory `feedback_vendor_secret_preflight_surface`** — orchestrator dispatch confirmation MUST surface:
```bash
supabase secrets set \
  ZOOM_S2S_ACCOUNT_ID=<account_id> \
  ZOOM_S2S_CLIENT_ID=<client_id> \
  ZOOM_S2S_CLIENT_SECRET=<client_secret>
```
Operator runs in parallel with Wave 0 execute. Mux secrets (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`) inherited from Phase 46 — Phase 47 does NOT re-surface.

---

## Sibling-collision Matrix (parallel-wave overlap detection)

Per memory `feedback_executor_tdd_scaffolds_sibling_plan_files` + `feedback_stub_then_replace_sibling_collision` — flag any new file touched by ≥2 plans in the same wave:

| File | Risk | Mitigation |
|------|------|------------|
| `supabase/functions/mux-webhook/index.ts` | Phase 46 + Phase 47 both EXTEND | **Serial phases** — Phase 47 starts after Phase 46 merges. NO same-wave overlap. |
| `supabase/functions/mux-create-upload/index.ts` | Phase 46 + Phase 47 both EXTEND | Same — serial phases. |
| `leanshot/src/types/index.ts` (TabId union) | Phase 46 widens to `'classroom'`; Phase 47 widens to `'events'` | Serial phases. |
| `leanshot/src/App.tsx` (tab switch) | Same as above | Serial phases. |
| `leanshot/src/lib/store.ts` (active selectors) | Same — Phase 46 adds `activeCourseId`; Phase 47 adds `activeEventId` | Serial phases. |
| `leanshot/vite.config.ts` (manualChunks) | Phase 46 adds `course-player` chunk rule; Phase 47 adds `events` chunk rule | Serial phases — Phase 47 inserts AFTER Phase 46's rule (rules are order-sensitive). |
| Within Phase 47 Wave 0: `event_rsvp_create` SECDEF + `events` schema | Both touch event_rsvps table | Migration timestamps enforce serial apply; Plan-A ships schema, Plan-B's RPC `depends_on: schema` plan. |

**No same-wave sibling collisions within Phase 47 itself** based on this map (each new file owned by exactly one plan).

---

## No Analog Found

Files where the closest match is partial — planner should rely on RESEARCH §Code Examples directly:

| File | Role | Reason | Fallback |
|------|------|--------|----------|
| `supabase/functions/event-join-url/index.ts` | RSVP-gated URL fetch | `mux-sign-playback` (researcher's named analog) does NOT yet exist in repo — Phase 46 ships it | RESEARCH §Code Examples Example 7 + `mux-create-upload` auth shell |
| `supabase/functions/_shared/event-phi.ts` (NEW shared helper) | PHI flag derivation | Net-new utility module | Single short helper — pattern from RESEARCH Pitfall 6 inline |
| `supabase/functions/zoom-create-meeting/index.ts` Zoom OAuth flow | Zoom S2S auth | No prior Zoom Fn in repo | RESEARCH §Code Examples Example 5 (skeleton pinned — direct fetch, no SDK) |

---

## Metadata

**Analog search scope:**
- `supabase/migrations/` (Phase 25, 35, 38, 44 migrations as canonical)
- `supabase/functions/` (`mux-webhook`, `mux-create-upload`, `notify-community`, `_shared/` helpers)
- `leanshot/src/components/community/` (CommunityTabShell, CommunityFeed, ReactionBar, media uploader)
- `leanshot/src/admin/modules/community/` and `reviews/` (admin pathname-based pattern)
- `leanshot/tests/rls/` (community-spaces-rls, fixtures-community)
- `leanshot/tests/integration/` (community-mention-notification)
- `leanshot/vite.config.ts` manualChunks rules

**Files scanned:** ~30 source files + 7 migrations + 4 Edge Fns + 6 test patterns
**Pattern extraction date:** 2026-05-23
**Coverage:** 100% — every net-new Phase 47 file has a pinpointed analog
