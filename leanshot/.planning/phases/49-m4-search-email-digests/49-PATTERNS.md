# Phase 49: M4 Search + Email Digests — Pattern Map

**Mapped:** 2026-05-24
**Files analyzed:** 28 net-new / 4 EXTEND
**Analogs found:** 32 / 32 (100% coverage)

> **CRITICAL inheritance carry-forward:**
>
> - **Consumer surface = Zustand-driven, NOT react-router** (per CORRECTED memory `reference_react_router_consumer_admin_split`). Phase 49 ships NO admin surface; SearchModal is a global overlay lazy-mounted in `App.tsx` keyed on `useStore((s) => s.searchOpen)`. Do NOT introduce `<Routes>`/`<Route>` JSX anywhere in Phase 49.
> - **Migration timestamp ordering:** Phase 44 = `20270720*`; Phase 45 = `20270727*`; Phase 46 = `20270720*..20270730*`; Phase 47 = `20270801*`; Phase 48 = `20270901*`. Phase 49 uses **`20271001*`** to land AFTER all dependencies. Per memory `reference_migration_timestamp_collision_precheck` — pre-merge glob `supabase/migrations/20271001*.sql >1` to verify no internal collision before push.
> - **Phase 46 + 47 + 48 EXECUTE must merge first** (per CONTEXT D-24 + RESEARCH Pitfall 2). `course_lessons`, `events`, `event_rsvps`, mute-RLS predicate all live-dep on those phases shipping.
> - **Vendor secret pre-flight (per memory `feedback_vendor_secret_preflight_surface`):** orchestrator dispatch confirmation MUST surface ONE new secret — `UNSUBSCRIBE_SECRET` — via:
>   ```bash
>   supabase secrets set UNSUBSCRIBE_SECRET=$(openssl rand -base64 32) --project-ref ytnsipxxmzgaebkqmokp
>   ```
>   Run `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp` BEFORE Wave 0 dispatch. All other secrets (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`) inherited.
> - **Dollar-quote tag uniqueness** (per memory `reference_postgres_dollar_quote_nesting_in_cron_body`): outer `$cron$`; inner `$daily$` + `$weekly$` + `$unschedule$`. NEVER reuse `$digest$` (Phase 38), `$reminders$` (Phase 47), `$restore$` (Phase 48), `$cleanup$` (Phase 38).
> - **Per-Fn `deno.json`** (per memory `reference_supabase_functions_deploy_import_map_flag`) — every new Edge Fn ships its own `deno.json`.
> - **Deno.serve env-var disable guards** (per memory `reference_deno_test_top_level_serve_trap`): every new Edge Fn wraps `Deno.serve()` in `if (Deno.env.get('<NAME>_DISABLE_SERVE') !== '1') { Deno.serve(handler); }`.

---

## File Classification

### Database (migrations) — all timestamps `20271001*`

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `supabase/migrations/20271001000001_p49_community_posts_fts.sql` | schema (ALTER) | CRUD | `supabase/migrations/20270707000005_helpdesk_fts_index.sql` | exact | FORK (adapt for body-only — see Pattern A1) |
| `supabase/migrations/20271001000002_p49_course_lessons_fts.sql` | schema (ALTER) | CRUD | Same | exact | FORK (title=A + content_md=B) |
| `supabase/migrations/20271001000003_p49_events_fts.sql` | schema (ALTER) | CRUD | Same | exact | FORK (title=A + description=B) |
| `supabase/migrations/20271001000004_p49_search_content_rpc.sql` | SECDEF RPC (INVOKER) | request-response | `supabase/migrations/20270707000006_helpdesk_search_kb_fn.sql` | role-match | FORK (SECURITY INVOKER + UNION ALL + CTE-per-type LIMIT-before-ts_headline) |
| `supabase/migrations/20271001000005_p49_notification_digest_widening.sql` | CHECK widening + seed | schema | `supabase/migrations/20270720000004_p44_notification_community.sql` | **EXACT** | FORK (verbatim 4-table drop+add CHECK + 2-row `notification_category_config` seed; NO per-user backfill per D-19) |
| `supabase/migrations/20271001000006_p49_digest_send_log.sql` | schema | CRUD | `supabase/migrations/20270702000004_phi_access_log.sql` (table + RLS + REVOKE) | role-match | FORK |
| `supabase/migrations/20271001000007_p49_digest_helper_rpcs.sql` | SECDEF RPCs | CRUD | `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` | exact | FORK (6 SECDEF helper RPCs: top_posts_24h, comments_on_my_posts_24h, mentions_24h, course_progress_delta_7d, upcoming_events_7d_rsvpd, community_top3_7d) |
| `supabase/migrations/20271001000008_p49_pg_cron_schedules.sql` | cron | event-driven | `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` | **EXACT** | VERBATIM (2 job blocks; outer `$cron$` + inner `$daily$`/`$weekly$`; minute offsets 5 + 15) |

### Edge Functions

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|---------------------|------|-----------|----------------|---------------|------------|
| `supabase/functions/community-daily-digest/index.ts` | service | event-driven | `supabase/functions/weekly-digest/index.ts` | role-match | FORK (drop Anthropic + BAA + HITL + 6h-dedup branches; replace dedup with `digest_send_log` UPSERT) |
| `supabase/functions/community-daily-digest/deno.json` | config | — | `supabase/functions/mux-webhook/deno.json` | exact | VERBATIM |
| `supabase/functions/community-daily-digest/index.test.ts` | Fn test | event-driven | `supabase/functions/notify-community/index.test.ts` (HMAC + Deno.serve guard + setVerifyForTest seam) | exact | FORK |
| `supabase/functions/community-weekly-digest/index.ts` | service | event-driven | `supabase/functions/weekly-digest/index.ts` | role-match | FORK (same shape as daily; different bucket helper RPCs) |
| `supabase/functions/community-weekly-digest/deno.json` | config | — | `supabase/functions/mux-webhook/deno.json` | exact | VERBATIM |
| `supabase/functions/community-weekly-digest/index.test.ts` | Fn test | event-driven | `supabase/functions/notify-community/index.test.ts` | exact | FORK |
| `supabase/functions/unsubscribe-handler/index.ts` | service | request-response | `supabase/functions/weekly-digest/index.ts` (Edge Fn shell only) + `supabase/functions/_shared/nps-token.ts` (verify pattern) | partial | FORK (NO Bearer auth — token-gated GET endpoint; renders confirmation HTML with `<meta name="robots" content="noindex">`) |
| `supabase/functions/unsubscribe-handler/deno.json` | config | — | `supabase/functions/mux-webhook/deno.json` | exact | VERBATIM |
| `supabase/functions/unsubscribe-handler/index.test.ts` | Fn test | request-response | `supabase/functions/notify-community/index.test.ts` (Deno.serve guard idiom) + nps-token.test patterns | role-match | FORK (happy-path + tampered HMAC + expired token + nonexistent user → 200) |
| `supabase/functions/_shared/unsubscribe-token.ts` | utility | — | `supabase/functions/_shared/nps-token.ts` | **EXACT** | FORK (HMAC-SHA256 + base64url replace-chain; swap payload shape to `{user_id, category, exp}`; KEY_ENV = `UNSUBSCRIBE_SECRET`) |
| `supabase/functions/_shared/unsubscribe-token.test.ts` | unit test | — | `supabase/functions/_shared/anthropic-baa-allowlist.test.ts` (shared-helper Deno-test idiom) | role-match | FORK (mint+verify roundtrip; tamper; expiry; missing env) |
| `supabase/functions/_shared/email-router.ts` | utility | — | (self) | — | **EXTEND** — add 2 `EmailTemplate` union variants: `'community_daily_digest'` + `'community_weekly_digest'`; widen `subjectFor` + `renderTemplate` switch arms |
| `supabase/functions/_shared/email-templates/community-daily-digest.ts` | utility | — | `supabase/functions/_shared/digest-email-template.ts` (Phase 38 weekly-digest HTML render) | role-match | FORK (3 sections: Top Posts / New Comments / Mentions; inline-styled table layout) |
| `supabase/functions/_shared/email-templates/community-weekly-digest.ts` | utility | — | Same | role-match | FORK (3 sections: Course Progress / Upcoming Events / Community Top 3) |

### Wave 0 Tests (DB-side)

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `supabase/functions/_shared/__tests__/fts-schema.test.ts` | DB unit | CRUD | `supabase/functions/_shared/digest-schema.test.ts` (shared-helper schema test idiom) | role-match | FORK (assert `search_en` GENERATED column populates on INSERT; GIN index lookup) |
| `supabase/functions/_shared/__tests__/search-content-rpc.test.ts` | RPC test | request-response | Same | role-match | FORK (EN + ES fixtures; ts_headline `<b>` assert; UNION ALL contract) |
| `supabase/functions/_shared/__tests__/digest-helpers.test.ts` | RPC test | CRUD | Same | role-match | FORK (6 helper RPCs; per-user filtering) |
| `supabase/tests/p49_search_content_rls.sql` | SQL test | request-response | (no exact analog — net-new pgTAP-style SQL test) | partial | NEW (skeleton from RESEARCH §Validation; live cross-tenant impersonation proof) |
| `supabase/tests/p49_digest_send_log_idempotency.sql` | SQL test | CRUD | Same | partial | NEW (UPSERT conflict on `(user_id, kind, sent_date)`) |

### Client (consumer search modal) — NEW `search` chunk

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `leanshot/src/components/search/SearchModal.tsx` | component | request-response | `leanshot/src/components/admin/palette/AdminCommandPalette.tsx` | **EXACT** | FORK (cmdk `<Command.Dialog>` wrapper; consumer Zustand `searchOpen` drives `open` prop) |
| `leanshot/src/components/search/SearchResultsList.tsx` | component | request-response | `leanshot/src/components/admin/palette/AdminCommandPalette.tsx` (inner `<Command.Group>` idiom) | role-match | FORK (3 grouped sections: Posts / Lessons / Events) |
| `leanshot/src/components/search/SearchResultRow.tsx` | component | request-response | `leanshot/src/components/community/CommunityPost.tsx` (Card composition + Lucide icons) | partial | FORK (3 type-variants: PostResult / LessonResult / EventResult; `<b>` snippet via `dangerouslySetInnerHTML` after sanitization) |
| `leanshot/src/lib/search/api.ts` | client lib | request-response | `leanshot/src/lib/community/community-storage.ts` (`supabase.rpc(...)` wrapper shape) | role-match | FORK (`searchContent(query, lang)` → `supabase.rpc('search_content', {p_query, p_lang})`; zod-validate return shape) |
| `leanshot/src/lib/search/types.ts` | types | — | `leanshot/src/lib/community/community-types.ts` | exact | FORK (LOCKED type module idiom; `SearchResultType`, `SearchResult` discriminated union by `type`) |
| `leanshot/src/lib/search/use-debounced-search.ts` | hook | — | (no exact analog — net-new custom hook) | partial | NEW (300ms `useDeferredValue` or `setTimeout`; min 3 chars; abort-controller cancel-in-flight) |
| `leanshot/src/components/search/__tests__/SearchModal.test.tsx` | component test | — | `leanshot/src/components/admin/palette/AdminCommandPalette.test.tsx` if extant; else `leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx` | role-match | FORK (cmd+k open; esc close; min-3-chars no-fire; debounce assertion) |

### Client (consumer settings widen)

| Modified File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|---------------|------|-----------|----------------|---------------|------------|
| `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx` | component | CRUD | (self) | — | **EXTEND** — widen `CATEGORIES` + `CATEGORY_LABEL` + `DEFAULT_ENABLED` maps to include `'daily_community_digest'` + `'weekly_community_digest'`; add NEW "Email digests" section with 2 toggles + "last sent X days ago" transparency text (read from `digest_send_log`) |
| `leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx` | component test | — | (self) | — | **EXTEND** — assert 2 new toggles render; toggle off → opt-out RPC fires; "last sent" text renders |
| `leanshot/src/App.tsx` | router | — | (self) | — | **EXTEND** — add `useEffect` cmd+k keydown listener + `lazy(() => import('@/components/search/SearchModal'))` + `<Suspense fallback={null}>` mount when `searchOpen===true`. Mirror existing pattern from Phase 27 admin palette (Zustand selector + Suspense gate). |
| `leanshot/src/lib/store.ts` | state | — | (self, `searchOpen` mirrors existing UI flags like `aiPanelOpen`) | — | **EXTEND** — add `searchOpen: boolean` + `setSearchOpen: (open: boolean) => void` action. NOT persisted (ephemeral UI slice; `partialize` excludes). |

### Build config

| Modified File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|---------------|------|-----------|----------------|---------------|------------|
| `leanshot/vite.config.ts` | config | — | (self, Phase 24 `admin-shell` chunk rule + Phase 44 `community-feed` chunk rule) | — | **EXTEND** — add `if (id.includes('/src/components/search/')) return 'search';` AFTER `community-mentions` rule and BEFORE the `admin-shell` catch-all. **Audit cmdk routing** per D-22: if `npm run build` shows cmdk in two chunks, either route cmdk to a shared chunk OR pin cmdk to the chunk that loads first. |

---

## Pattern Assignments

### A1. Migration: `community_posts` FTS (NO title column — D-17)

**New file:** `supabase/migrations/20271001000001_p49_community_posts_fts.sql`
**Analog:** `supabase/migrations/20270707000005_helpdesk_fts_index.sql`
**Reuse mode:** FORK (D-17 adaptation — whole body at weight A; NO setweight concat)

**Header pattern to inherit:**
```sql
-- Phase 49 Plan 01 — community_posts FTS columns + GIN indexes.
--
-- Decisions implemented:
--   D-01: per-table tsvector GENERATED columns; EN + ES; GIN per language.
--   D-17 (CORRECTS D-02): community_posts has NO title column — whole body at weight A.
--
-- Live DB pre-check (memory feedback_live_db_precheck_inverts_research_grep):
--   `community_posts` columns = (id, space_id, author_id, body, mux_upload_id, mux_playback_id,
--    video_status, created_at, edited_at, deleted_at) — NO title.
--
-- Per reference_supabase_migration_filename_regex: strict 14-digit timestamp.

begin;
```

**ALTER pattern (body-only, weight A — adapted from RESEARCH Example 1):**
```sql
alter table public.community_posts
  add column if not exists search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(body, '')), 'A')
  ) stored,
  add column if not exists search_es tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(body, '')), 'A')
  ) stored;

create index if not exists community_posts_search_en_gin
  on public.community_posts using gin (search_en);
create index if not exists community_posts_search_es_gin
  on public.community_posts using gin (search_es);

commit;
```

**Conventions to inherit verbatim:**
1. `add column if not exists` (idempotent re-apply).
2. `GENERATED ALWAYS AS … STORED` (per memory `reference_supabase_migration_gotchas` — IMMUTABLE expression; `coalesce` to handle NULLs).
3. GIN index per `tsvector` column (one EN + one ES; separate indexes — NOT a single multi-column index).
4. `create extension if not exists pg_trgm` NOT required — tsvector is built-in.
5. **NEVER reference `title`** — plan-checker greps for `setweight\(.*title` in this file; BLOCK if matched.

---

### A2. Migration: `course_lessons` FTS (title=A + content_md=B)

**New file:** `supabase/migrations/20271001000002_p49_course_lessons_fts.sql`
**Analog:** `supabase/migrations/20270707000005_helpdesk_fts_index.sql` + Phase 46 schema (PENDING — see hard-dep note)
**Reuse mode:** FORK

**ALTER pattern (per RESEARCH Example 1):**
```sql
alter table public.course_lessons
  add column if not exists search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_md, '')), 'B')
  ) stored,
  add column if not exists search_es tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(content_md, '')), 'B')
  ) stored;

create index if not exists course_lessons_search_en_gin
  on public.course_lessons using gin (search_en);
create index if not exists course_lessons_search_es_gin
  on public.course_lessons using gin (search_es);
```

**Hard dep:** Phase 46 must apply first (live DB confirms `course_lessons` does NOT exist as of 2026-05-24 per RESEARCH Pitfall 2). Plan-checker re-runs live schema audit at iter-1 after Phase 46 lands.

---

### A3. Migration: `events` FTS (title=A + description=B)

**New file:** `supabase/migrations/20271001000003_p49_events_fts.sql`
**Analog:** Same as A2.
**Reuse mode:** FORK (swap `content_md` → `description`)

**Hard dep:** Phase 47 must apply first (live DB confirms `events` does NOT exist as of 2026-05-24).

---

### B. Migration: `search_content` SECURITY INVOKER RPC (D-04 + D-21 CTE-per-type)

**New file:** `supabase/migrations/20271001000004_p49_search_content_rpc.sql`
**Primary analog:** `supabase/migrations/20270707000006_helpdesk_search_kb_fn.sql` (websearch_to_tsquery + ts_rank_cd structure)
**Secondary analog:** RESEARCH §Code Examples Example 2 (full skeleton — lands verbatim)
**Reuse mode:** FORK

**Function shell pattern (RESEARCH Example 2 lines 513-599 — pinned):**
```sql
create or replace function public.search_content(
  p_query text,
  p_lang  text default 'english'
)
returns table (
  type      text,
  id        uuid,
  title     text,
  snippet   text,
  rank      real,
  space_id  uuid,
  course_id uuid,
  module_id uuid,
  start_at  timestamptz
)
language sql
security invoker  -- D-04: RLS on community_posts / course_lessons / events applies as caller
set search_path = public
as $fn$
with q as (
  select case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end as cfg,
         websearch_to_tsquery(
           case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end,
           coalesce(p_query, '')
         ) as tsq
),
posts as (  -- D-21: LIMIT 5 BEFORE ts_headline
  select p.id, p.space_id, p.body,
         case when p_lang = 'spanish' then ts_rank_cd(p.search_es, q.tsq)
              else ts_rank_cd(p.search_en, q.tsq) end as rank
  from public.community_posts p, q
  where p.deleted_at is null
    and (case when p_lang = 'spanish' then p.search_es else p.search_en end) @@ q.tsq
  order by rank desc
  limit 5
),
lessons as ( … ),
upcoming_events as ( … )
select 'post'::text as type, p.id, left(p.body, 60) as title,
       ts_headline(…, 'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false')
       …
$fn$;

revoke execute on function public.search_content(text, text) from public;
grant  execute on function public.search_content(text, text) to authenticated;
```

**Conventions to inherit verbatim:**
1. **`security invoker`** (D-04 locked) — NOT `security definer`. Plan-checker greps RPC body; `security definer` is HARD BLOCKER.
2. **`language sql`** (NOT plpgsql) — pure SELECT body; planner optimizer pushes LIMIT through CTE.
3. **`websearch_to_tsquery`** (NOT `to_tsquery` or `plainto_tsquery`) — handles user-input syntax robustly.
4. **CTE-per-type with LIMIT 5 BEFORE ts_headline** (D-21) — ts_headline does NOT use GIN; must filter first.
5. **`revoke execute from public; grant execute to authenticated`** — NEVER `service_role` (RLS bypass would defeat INVOKER contract per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
6. **Mute-RLS inheritance** (Phase 48 D-14) — search_content inherits transparently; no extra predicate needed.

---

### C. Migration: notification_settings 4-table widening + category_config seed (D-14, D-15, D-19)

**New file:** `supabase/migrations/20271001000005_p49_notification_digest_widening.sql`
**Analog:** `supabase/migrations/20270720000004_p44_notification_community.sql` + Phase 47/48 widening precedent
**Reuse mode:** FORK (verbatim recipe per RESEARCH Example 3)

**Excerpt (RESEARCH Example 3 lines 607-657 — pinned):**
```sql
begin;

alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add constraint notification_settings_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      -- Plan-checker MUST union all categories live at apply-time (A10):
      -- Phase 47 may add: event_reminders_1d, event_reminders_1h, event_promotion
      -- Phase 48 may add: <moderation categories>
      'daily_community_digest','weekly_community_digest'
    ));

-- Repeat drop+add CHECK on notification_category_config, user_notifications,
-- notification_dismissal_state (all 4 in one txn).

insert into public.notification_category_config
  (category, daily_cap, weekly_cap, urgent_escalation,
   push_enabled_default, email_enabled_default, in_app_enabled_default)
values
  ('daily_community_digest',  1, 7,  false, false, true, true),
  ('weekly_community_digest', 1, 1,  false, false, true, true)
on conflict (category) do nothing;

commit;
```

**Conventions to inherit verbatim:**
1. **All 4 tables in ONE transaction** (per memory `feedback_planner_missed_status_enum_widening`).
2. **`email_enabled_default=true` + `in_app_enabled_default=true`** for both new categories (D-15 default opt-IN).
3. **NO per-user backfill INSERT** (D-19 supersedes — runtime falls through `notification_category_config` per `notification-fire-decision.ts`).
4. **`on conflict (category) do nothing`** — idempotent re-apply.
5. **A10 union-with-live**: plan-checker queries live CHECK at iter-1 (after Phase 47/48 land); CHECK list must include ALL live categories, not just Phase 49 additions.

---

### D. Migration: `digest_send_log` table (UPSERT idempotency)

**New file:** `supabase/migrations/20271001000006_p49_digest_send_log.sql`
**Analog:** `supabase/migrations/20270702000004_phi_access_log.sql` (table + enable RLS + REVOKE pattern)
**Reuse mode:** FORK

**Table declaration (per CONTEXT D-12 + Claude-discretion):**
```sql
create table if not exists public.digest_send_log (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  kind        text        not null check (kind in ('daily','weekly')),
  sent_at     timestamptz not null default now(),
  -- Generated column for UPSERT key — enables (user_id, kind, sent_date) uniqueness:
  sent_date   date        generated always as ((sent_at at time zone 'UTC')::date) stored,
  status      text        not null check (status in ('sent','skipped:no-content','skipped:opted_out','error')),
  error_message text
);

create unique index if not exists digest_send_log_user_kind_date_uniq
  on public.digest_send_log (user_id, kind, sent_date);

alter table public.digest_send_log enable row level security;

-- SELECT: user reads own rows; staff reads all (per is_staff()).
create policy dsl_select_own
  on public.digest_send_log for select to authenticated
  using (auth.uid() = user_id);
create policy dsl_select_staff
  on public.digest_send_log for select to authenticated
  using (public.is_staff());

-- NO INSERT/UPDATE/DELETE policies — writes ONLY via service-role Edge Fn UPSERT.
revoke insert, update, delete on public.digest_send_log from authenticated;
```

**Conventions to inherit:**
1. **Generated `sent_date` column** enables UPSERT on `(user_id, kind, sent_date)` per memory `feedback_state_counter_table_needs_upsert_on_event`.
2. **Default-deny writes** — service-role bypasses RLS (Edge Fn writes); no `apply_user_moderation`-style SECDEF RPC needed because writes are from Edge Fn fan-out only.
3. **`public.is_staff()`** (per memory `reference_supabase_is_staff_helper`) — staff read for support ops + admin "last sent" probe.

---

### E. Migration: `digest_helper_rpcs` (6 SECDEF helpers — D-18 corrected)

**New file:** `supabase/migrations/20271001000007_p49_digest_helper_rpcs.sql`
**Analog:** `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql`
**Reuse mode:** FORK

**RPC list (all `security definer`, `set search_path = public, extensions`, granted to `service_role` only):**

1. `digest_top_posts_in_spaces(p_user_id, p_since_hours, p_limit)` → top 5 posts in user's joined spaces last 24h, score = `reactions_count + comments_count`.
2. `digest_new_comments_on_my_posts(p_user_id, p_since_hours, p_limit)` → new comments on user's own posts last 24h.
3. `digest_recent_mentions(p_user_id, p_since_hours, p_limit)` → **D-18 CORRECTED**: mentions tagging user — JOIN `community_post_mentions` to `community_posts.created_at` (mentions table has NO timestamp).
4. `digest_course_progress_delta_7d(p_user_id)` → per enrolled course, (this_week - last_week) completed lessons + total + current %.
5. `digest_upcoming_events_7d_rsvpd(p_user_id)` → events with `event_rsvps.status='going'` AND `start_at` in next 7d.
6. `digest_community_top3_7d(p_user_id)` → per user's spaces, top 3 posts by `posts×3 + (reactions+comments)×1` rolling-7d (Phase 45 leaderboard formula reuse per RESEARCH Pitfall 6).

**D-18 corrected mentions filter (pinned excerpt):**
```sql
create or replace function public.digest_recent_mentions(
  p_user_id uuid,
  p_since_hours int default 24,
  p_limit int default 10
)
returns table (post_id uuid, post_body text, mentioner_id uuid, mention_kind text)
language sql security definer set search_path = public, extensions
stable
as $fn$
  -- D-18: community_post_mentions has NO timestamp; JOIN to community_posts.created_at
  (select p.id, p.body, p.author_id, 'post'::text
     from community_post_mentions m
     join community_posts p on p.id = m.post_id
    where m.user_id = p_user_id
      and p.created_at >= now() - make_interval(hours => p_since_hours)
      and p.deleted_at is null
    order by p.created_at desc
    limit p_limit)
  union all
  (select c.post_id, c.body, c.author_id, 'comment'::text
     from community_comment_mentions m
     join community_comments c on c.id = m.comment_id
    where m.user_id = p_user_id
      and c.created_at >= now() - make_interval(hours => p_since_hours)
    order by c.created_at desc
    limit p_limit);
$fn$;

revoke execute on function public.digest_recent_mentions(uuid, int, int) from public;
grant  execute on function public.digest_recent_mentions(uuid, int, int) to service_role;
```

**Conventions to inherit verbatim:**
1. **`security definer` + `set search_path = public, extensions`** (per memory `reference_supabase_migration_gotchas`).
2. **`stable`** (read-only RPCs — enables query planner caching).
3. **`grant execute to service_role`** (NOT `authenticated`) — called only from Edge Fn fan-out with service-role bearer.
4. **NO `auth.uid()` reference** — these RPCs are called from service-role Edge Fns; `auth.uid()` would return NULL (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`). Caller passes `p_user_id` explicitly.
5. **`make_interval(hours => p_since_hours)`** — safer than string concat into `interval '24 hours'`.

---

### F. Migration: pg_cron schedules (D-10 + D-11 + D-20)

**New file:** `supabase/migrations/20271001000008_p49_pg_cron_schedules.sql`
**Analog:** `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql`
**Reuse mode:** VERBATIM (RESEARCH Example 5 — pinned full block)

**Excerpt (RESEARCH Example 5 lines 777-876 — pinned):**
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $unschedule$
declare job_name text;
begin
  for job_name in
    select jobname from cron.job
     where jobname in (
       'phase49-community-daily-digest-hourly-fanout',
       'phase49-community-weekly-digest-hourly-fanout'
     )
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then null;
end $unschedule$;

select cron.schedule(
  'phase49-community-daily-digest-hourly-fanout',
  '5 * * * *',                            -- D-20: stagger from Phase 38's 0 * * * *
  $cron$
  do $daily$                              -- UNIQUE inner tag per reference_postgres_dollar_quote_nesting_in_cron_body
  declare
    rec record;
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-daily-digest';
    service_key text;
  begin
    select decrypted_secret into service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    if service_key is null then
      raise notice 'phase49-community-daily-digest-hourly-fanout: service_role_key missing — skipping';
      return;
    end if;

    for rec in
      select p.id as user_id
        from public.profiles p
       where extract(hour from (now() at time zone coalesce(p.timezone, 'UTC'))) = 9
         and not exists (
           select 1 from public.digest_send_log dsl
            where dsl.user_id = p.id and dsl.kind = 'daily'
              and dsl.sent_at > now() - interval '20 hours'
         )
    loop
      perform net.http_post(
        url := fn_url,
        body := jsonb_build_object('user_id', rec.user_id),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || service_key,
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 60000
      );
    end loop;
  end;
  $daily$;
  $cron$
);

-- Weekly fan-out: identical shape; jobname `phase49-community-weekly-digest-hourly-fanout`;
-- minute offset `15 * * * *`; inner tag `$weekly$`; predicate `extract(dow)=0 AND extract(hour)=9`;
-- dedup window 6 days; fn_url …/community-weekly-digest.
```

**Conventions to inherit verbatim:**
1. **Outer `$cron$` + inner `$daily$`/`$weekly$`/`$unschedule$`** — ALL distinct from Phase 38 `$digest$`, Phase 47 `$reminders$`, Phase 48 `$restore$`, Phase 38 `$cleanup$`.
2. **Hardcoded project URL** `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<fn>` per memory `reference_supabase_pg_cron_vault_service_role_pattern`. NEVER `current_setting('app.service_role_key')` GUC.
3. **`vault.decrypted_secrets WHERE name='service_role_key'`** — same vault read shape as Phase 38.
4. **Pre-flight `do $unschedule$` block** — idempotent re-apply on migration replay.
5. **Minute offsets `5` + `15`** (D-20) — NOT `0`. Phase 38 owns minute 0; Phase 47/48 reserve their own offsets in their respective cron migrations.
6. **In-cron dedup window** (`20 hours` daily; `6 days` weekly) — short-circuits before Edge Fn invocation; complements `digest_send_log` UPSERT idempotency.

---

### G. Edge Fn: `community-daily-digest`

**New file:** `supabase/functions/community-daily-digest/index.ts`
**Primary analog:** `supabase/functions/weekly-digest/index.ts`
**Secondary analog:** RESEARCH §Code Examples Example 4 (full skeleton pinned)
**Reuse mode:** FORK

**Imports + Edge Fn shell (RESEARCH Example 4 lines 663-674):**
```typescript
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { sendEmail } from '../_shared/email-router.ts';
import { mintUnsubscribeToken } from '../_shared/unsubscribe-token.ts';

const { admin } = makeLazyAdmin();
```

**handleRun shape (Example 4 lines 709-750):**
```typescript
async function handleRun(userId: string): Promise<{ status: string }> {
  const content = await computeDailyDigest(admin, userId);
  if (isEmpty(content)) {
    await upsertDigestLog(admin, userId, 'skipped:no-content');
    return { status: 'skipped:no-content' };
  }
  // Opt-out check (notification_settings.enabled for category, channel='email'):
  const { data: pref } = await admin
    .from('notification_settings')
    .select('enabled')
    .eq('user_id', userId)
    .eq('category', 'daily_community_digest')
    .eq('channel', 'email')
    .maybeSingle();
  if (pref && pref.enabled === false) {
    await upsertDigestLog(admin, userId, 'skipped:opted_out');
    return { status: 'skipped:opted_out' };
  }
  const { data: userRow } = await admin.auth.admin.getUserById(userId);
  const email = userRow?.user?.email;
  if (!email) { await upsertDigestLog(admin, userId, 'error', 'no_email'); return { status: 'error' }; }

  const unsubUrl = `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/unsubscribe-handler?t=${mintUnsubscribeToken({
    user_id: userId,
    category: 'daily_community_digest',
    exp: Math.floor(Date.now() / 1000) + 90 * 86400,
  })}`;

  await sendEmail({
    template: 'community_daily_digest',
    phi: false,                                       // Phase 25 D-03 — non-PHI
    to: email,
    vars: { content, unsubUrl },
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,            // RFC 2369 + 8058
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  await upsertDigestLog(admin, userId, 'sent');
  return { status: 'sent' };
}
```

**Deno.serve guard (Example 4 lines 752-766; per memory `reference_deno_test_top_level_serve_trap`):**
```typescript
if (Deno.env.get('COMMUNITY_DAILY_DIGEST_DISABLE_SERVE') !== '1') {
  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
    if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
    const body = await req.json().catch(() => ({}));
    if (!body?.user_id) return jsonError(400, 'missing_user_id');
    try {
      const res = await handleRun(body.user_id);
      return jsonResponse(200, res);
    } catch (e) {
      return jsonError(500, 'internal');
    }
  });
}

export const __internal = { handleRun, computeDailyDigest, isEmpty };
```

**Conventions to inherit verbatim:**
1. **`checkServiceRoleBearer(req)`** from `_shared/lifecycle-utils.ts` — handles `sb_secret_*` vs legacy JWT formats (per memory `reference_supabase_service_role_key_format_divergence`). NEVER raw `===`.
2. **`makeLazyAdmin()`** — Proxy singleton; test seam `setAdminForTest`.
3. **`phi: false`** — non-PHI route per Phase 25 D-03.
4. **`Deno.env.get('COMMUNITY_DAILY_DIGEST_DISABLE_SERVE') !== '1'`** guard — test orchestration disables port bind.
5. **`export const __internal`** — exposes `handleRun` for Deno.test direct invocation.
6. **Token URL uses direct functions URL** (Open Question 4 — researcher recommendation; avoids Vercel rewrite).
7. **3 parallel SECDEF helper RPC calls** via `Promise.all` (Example 4 lines 684-689) — avoids serial latency.

---

### H. Edge Fn: `community-weekly-digest`

**New file:** `supabase/functions/community-weekly-digest/index.ts`
**Analog:** Same as G; near-identical structure.
**Reuse mode:** FORK

**Deltas from G:**
- `computeWeeklyDigest` calls `digest_course_progress_delta_7d`, `digest_upcoming_events_7d_rsvpd`, `digest_community_top3_7d`.
- `isEmpty` predicate: course_progress_delta=0 AND no upcoming events AND community top-3 empty.
- `template: 'community_weekly_digest'`.
- `category: 'weekly_community_digest'` for opt-out check + unsubscribe token payload.
- Disable env var: `COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE`.
- `digest_send_log` kind = `'weekly'`.

---

### I. Edge Fn: `unsubscribe-handler` (GET, no Bearer)

**New file:** `supabase/functions/unsubscribe-handler/index.ts`
**Primary analog:** `supabase/functions/_shared/nps-token.ts` (verify pattern)
**Secondary analog:** RESEARCH §Code Examples Example 7 (token verify shell)
**Reuse mode:** FORK

**Handler skeleton:**
```typescript
import { corsHeaders, jsonError, makeLazyAdmin } from '../_shared/lifecycle-utils.ts';
import { verifyUnsubscribeToken } from '../_shared/unsubscribe-token.ts';

const { admin } = makeLazyAdmin();

const CONFIRMATION_HTML = (category: string) => `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex">
  <title>Unsubscribed — LeanShot</title>
  <style>body { font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 80px auto; padding: 24px; }</style>
</head><body>
  <h1>You've unsubscribed</h1>
  <p>You will no longer receive <strong>${category.replace('_', ' ')}</strong> emails.</p>
  <p><a href="https://leanshot.app/settings/notifications">Manage all preferences</a></p>
</body></html>`;

async function handler(req: Request): Promise<Response> {
  // RFC 8058: in-inbox one-click MAY use either GET (link click) or POST (one-click button)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }
  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  if (!token) return jsonError(400, 'missing_token');

  const payload = verifyUnsubscribeToken(token);
  if (!payload) return jsonError(401, 'invalid_token');

  // Idempotent UPDATE: 0-rows-affected is OK (email enumeration mitigation).
  await admin
    .from('notification_settings')
    .upsert(
      { user_id: payload.user_id, category: payload.category, channel: 'email', enabled: false },
      { onConflict: 'user_id,category,channel' }
    );

  return new Response(CONFIRMATION_HTML(payload.category), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

if (Deno.env.get('UNSUBSCRIBE_HANDLER_DISABLE_SERVE') !== '1') {
  Deno.serve(handler);
}

export const __internal = { handler };
```

**Conventions to inherit:**
1. **NO `checkServiceRoleBearer`** — token-gated; URL signature IS the auth.
2. **Accepts BOTH GET (link click) and POST (RFC 8058 One-Click)** — Gmail/Outlook POST to the URL when user clicks the in-inbox button.
3. **`verifyUnsubscribeToken` is constant-time** (per nps-token analog — uses `timingSafeEqual`).
4. **`UPSERT` not UPDATE** — handles users with no existing `notification_settings` row gracefully.
5. **0-rows-affected = 200 OK** — email enumeration mitigation; never reveal whether user_id exists.
6. **`<meta name="robots" content="noindex">`** — prevent search indexing.
7. **`Cache-Control: no-store`** — token reuse via cached page must not occur.
8. **`UNSUBSCRIBE_HANDLER_DISABLE_SERVE`** disable env var.

---

### J. Shared: `unsubscribe-token.ts` (HMAC mint/verify)

**New file:** `supabase/functions/_shared/unsubscribe-token.ts`
**Analog:** `supabase/functions/_shared/nps-token.ts`
**Secondary analog:** RESEARCH §Code Examples Example 7 (lines 911-961 — pinned in full)
**Reuse mode:** FORK

**Mint/verify shape (Example 7 — pinned):**
```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface UnsubscribeTokenPayload {
  user_id: string;
  category: 'daily_community_digest' | 'weekly_community_digest';
  exp: number; // unix seconds
}

const KEY_ENV = 'UNSUBSCRIBE_SECRET';

function readSigningKey(): string {
  const v = (globalThis as any).Deno?.env?.get?.(KEY_ENV);
  if (!v) throw new Error(`unsubscribe-token: ${KEY_ENV} not set`);
  return v;
}

function toBase64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Buffer {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function mintUnsubscribeToken(payload: UnsubscribeTokenPayload, key?: string): string {
  const signingKey = key ?? readSigningKey();
  const json = JSON.stringify(payload);
  const payloadEncoded = toBase64Url(Buffer.from(json, 'utf8'));
  const mac = createHmac('sha256', signingKey).update(payloadEncoded).digest();
  return `${payloadEncoded}.${toBase64Url(mac)}`;
}

export function verifyUnsubscribeToken(token: string, key?: string): UnsubscribeTokenPayload | null {
  if (!token) return null;
  const [payloadEncoded, macEncoded] = token.split('.');
  if (!payloadEncoded || !macEncoded) return null;
  const signingKey = key ?? readSigningKey();
  const expectedMac = createHmac('sha256', signingKey).update(payloadEncoded).digest();
  let providedMac: Buffer;
  try { providedMac = fromBase64Url(macEncoded); } catch { return null; }
  if (providedMac.length !== expectedMac.length) return null;
  if (!timingSafeEqual(providedMac, expectedMac)) return null;
  let payload: UnsubscribeTokenPayload;
  try { payload = JSON.parse(fromBase64Url(payloadEncoded).toString('utf8')); } catch { return null; }
  if (!payload?.user_id || !payload?.category || typeof payload?.exp !== 'number') return null;
  if (payload.category !== 'daily_community_digest' && payload.category !== 'weekly_community_digest') return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}
```

**Conventions to inherit verbatim:**
1. **`node:crypto.createHmac` + `timingSafeEqual`** (NEVER `===`) — Phase 42 precedent.
2. **`toBase64Url` replace-chain** matches Postgres `translate('+/=', '-_')` per memory `reference_base64url_postgres_vercel_mint_verify` (though Phase 49 token is mint-only-from-TS — Postgres parity not load-bearing here).
3. **`KEY_ENV = 'UNSUBSCRIBE_SECRET'`** — readable from `Deno.env.get` (Supabase Function Secret), NOT vault (per RESEARCH Pitfall 8).
4. **Single `t=<token>` URL param** (Open Question 4 — researcher recommendation; matches Phase 42 NPS shape).
5. **Whitelist category enum** — verify rejects unknown categories at parse time.
6. **`exp` check inside verify** — never trust client-side expiry.
7. **Test seam:** `key?` parameter in both mint + verify allows test fixtures without setting env.

---

### K. Shared: `email-router.ts` extension (2 new templates)

**Modified file:** `supabase/functions/_shared/email-router.ts`
**Reuse mode:** EXTEND

**Add to `EmailTemplate` union:** `'community_daily_digest' | 'community_weekly_digest'`.

**Add to `subjectFor` + `renderTemplate` switch arms** (per RESEARCH Example 6 lines 886-887 — pinned):
```typescript
case 'community_daily_digest':  return communityDailyDigest.subject(vars);
case 'community_weekly_digest': return communityWeeklyDigest.subject(vars);
```

**Conventions to inherit:**
1. **`headers?: Record<string, string>`** already exists in `SendEmailArgs` — no signature widening needed for List-Unsubscribe pass-through (per Assumption A7 — confirm in Wave 0 spike: send 1 digest to Gmail; verify in-inbox unsubscribe button shows).
2. **`phi: false`** path → Resend (Phase 25 D-03). NEVER `phi: true` for digest sends (community content is not PHI even when clinic_org_id present per CONTEXT canonical_refs).

---

### L. Email templates: `community-daily-digest.ts` + `community-weekly-digest.ts`

**New files:** `supabase/functions/_shared/email-templates/community-{daily,weekly}-digest.ts`
**Analog:** `supabase/functions/_shared/digest-email-template.ts` (Phase 38 weekly-digest HTML)
**Reuse mode:** FORK

**Conventions to inherit:**
1. **`subject(vars): string`** + **`render(vars): { html, text }`** exports — `email-router.ts` switch arms call these.
2. **Inline-styled table layout** (email clients strip `<style>` and class-based CSS) — Phase 38 idiom.
3. **HTML-escape user content** (post body, comment body, mention author display_name) — Phase 38 template uses an `escape()` helper; reuse it. ts_headline output already has safe `<b>...</b>` but caller MUST escape the rest.
4. **`unsubUrl` injected by handleRun** → renders to `List-Unsubscribe` header + visible footer link.
5. **Reduced-motion fallback** — email templates have no animations; not relevant.
6. **3-section layout per RESEARCH §Specifics** (daily: Top Posts / New Comments / Mentions; weekly: Course Progress / Upcoming Events / Community Top 3).

---

### M. Consumer: `SearchModal.tsx` (cmd+k modal)

**New file:** `leanshot/src/components/search/SearchModal.tsx`
**Analog:** `leanshot/src/components/admin/palette/AdminCommandPalette.tsx`
**Secondary analog:** RESEARCH §Code Examples Example 8 (lazy + Zustand pattern — pinned)
**Reuse mode:** FORK

**Preamble pattern:**
```typescript
/**
 * Phase 49 Plan NN — SearchModal (consumer surface).
 *
 * Global cmd+k Spotlight modal for cross-content search.
 * Uses Zustand `searchOpen` (NOT local useState in App.tsx — per CLAUDE.md
 * "minimize App.tsx bloat" + memory feedback_planner_prompt_explicit_reuse_targets).
 *
 * Routing model: NO react-router (consumer surface is Zustand-driven per
 * CORRECTED memory reference_react_router_consumer_admin_split).
 *
 * Lazy-mounted: this entire component lives in the `search` chunk via vite.config.ts
 * manualChunks rule (~20 kB gz target excluding shared cmdk).
 */
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { searchContent } from '@/lib/search/api';
import { useDebouncedSearch } from '@/lib/search/use-debounced-search';
import { SearchResultsList } from './SearchResultsList';
```

**Conventions to inherit verbatim (from Phase 27 AdminCommandPalette):**
1. **`<Command.Dialog open={open} onOpenChange={setOpen}>`** — cmdk's controlled component.
2. **`role="dialog"` + `aria-modal="true"`** — already provided by cmdk; verify via attribute spread (per CLAUDE.md a11y rule).
3. **`<Command.Input>`** with `placeholder` — debounce via `useDebouncedSearch` (300ms; min 3 chars).
4. **`<Command.List>`** wraps results; `<Command.Empty>` for no-results state; `<Command.Loading>` for in-flight.
5. **Keyboard nav free** — cmdk handles arrow keys + enter + esc.
6. **Phase 32 i18n locale** — pass `i18n.language` to `searchContent(query, lang)`.

---

### N. Consumer: `App.tsx` + `store.ts` extensions

**Modified file:** `leanshot/src/App.tsx`
**Pattern (RESEARCH Example 8 lines 967-1004 — pinned):**
```typescript
const SearchModal = lazy(() => import('@/components/search/SearchModal'));

function App() {
  const searchOpen = useStore((s) => s.searchOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [searchOpen, setSearchOpen]);

  return (
    <>
      {/* existing tree */}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchModal onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
```

**Modified file:** `leanshot/src/lib/store.ts`
**Pattern:** add `searchOpen: boolean` + `setSearchOpen: (open: boolean) => void` to `AppState`. Mirror existing ephemeral UI flags (e.g., `toast`). Excluded from `partialize` (ephemeral; not persisted to localStorage — see CLAUDE.md `state.complete-phase`-equivalent).

---

### O. Consumer: `lib/search/api.ts` + `types.ts` + `use-debounced-search.ts`

**New file:** `leanshot/src/lib/search/api.ts`
**Analog:** `leanshot/src/lib/community/community-storage.ts` (supabase.rpc wrapper shape)
**Reuse mode:** FORK

```typescript
import { supabase } from '@/lib/supabase';
import { z } from 'zod';
import type { SearchResult } from './types';

const searchRowSchema = z.object({
  type: z.enum(['post', 'lesson', 'event']),
  id: z.string().uuid(),
  title: z.string().nullable(),
  snippet: z.string().nullable(),
  rank: z.number(),
  space_id: z.string().uuid().nullable(),
  course_id: z.string().uuid().nullable(),
  module_id: z.string().uuid().nullable(),
  start_at: z.string().nullable(),
});

export async function searchContent(query: string, lang: 'english' | 'spanish' = 'english'): Promise<SearchResult[]> {
  if (query.length < 3) return [];
  const { data, error } = await supabase.rpc('search_content', { p_query: query, p_lang: lang });
  if (error) throw error;
  return z.array(searchRowSchema).parse(data ?? []);
}
```

**New file:** `leanshot/src/lib/search/types.ts`
**Analog:** `leanshot/src/lib/community/community-types.ts`
**Reuse mode:** FORK (LOCKED type module idiom; pure types only, no runtime imports)

**New file:** `leanshot/src/lib/search/use-debounced-search.ts`
**Reuse mode:** NEW (no exact analog)
```typescript
import { useEffect, useState } from 'react';

export function useDebouncedSearch(query: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    if (query.length < 3) { setDebounced(''); return; }
    const t = setTimeout(() => setDebounced(query), delayMs);
    return () => clearTimeout(t);
  }, [query, delayMs]);
  return debounced;
}
```

---

### P. Consumer: `NotificationsSubtab.tsx` widening (D-16)

**Modified file:** `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx`
**Analog:** (self) + Phase 44/47/48 widening precedent
**Reuse mode:** EXTEND

**Modifications (per CONTEXT D-14 + D-16):**
1. **Widen `CATEGORIES` array** (line ~32 in current file) — add `'daily_community_digest'` + `'weekly_community_digest'`.
2. **Widen `CATEGORY_LABEL` Record** (line ~42) — add human labels: `'Daily community digest'` + `'Weekly community digest'`.
3. **Widen `DEFAULT_ENABLED` Record** (line ~60) — add `{email: true, push: false, in_app: true}` for both (D-15 default opt-IN).
4. **NEW "Email digests" section** below existing toggle grid — render the 2 new categories as standalone toggles with "last sent X days ago" transparency text. Source the "last sent" via `supabase.from('digest_send_log').select('sent_at').eq('user_id', auth.uid()).eq('kind', 'daily').order('sent_at', { ascending: false }).limit(1).maybeSingle()`.

**Conventions to inherit verbatim:**
1. **Existing toggle UX** — pill-toggle idiom with `aria-pressed` (per `Pill.tsx` precedent + CLAUDE.md a11y rule).
2. **Optimistic update + revert on error** — same pattern as existing notification toggles.
3. **`useToast`** for success/error feedback — matches existing call sites.
4. **NO new tab/route** — section lives inline within existing `NotificationsSubtab.tsx`.

---

### Q. Build config: `vite.config.ts` search chunk + cmdk audit (D-22)

**Modified file:** `leanshot/vite.config.ts`
**Insertion point:** AFTER line 196 (community-mentions rule) and BEFORE the `admin-shell` catch-all (line ~255).

**Rule to add:**
```typescript
// Phase 49 Plan NN — search chunk (~20 kB gz target excluding shared cmdk).
// cmdk routing audit per D-22: if `npm run build` shows cmdk in both `admin-shell`
// and `search` chunks, add a higher-priority `if (id.includes('node_modules/cmdk/'))
// return 'cmdk-shared';` rule BEFORE both consumer + admin rules.
if (id.includes('/src/components/search/')) return 'search';
```

**Cmdk audit step (Wave 2 plan):**
1. Run `cd leanshot && npm run build`.
2. Inspect `dist/assets/*.js` for `cmdk` occurrences — `grep -l 'cmdk' dist/assets/*.js | wc -l`.
3. If count > 1: add `cmdk-shared` chunk rule before consumer + admin rules.
4. Re-build; confirm count = 1.

**Conventions to inherit:**
1. **Insertion ordering matters** — rules are first-match-wins in `manualChunks`.
2. **Bundle ceiling ≤ 20 kB gz** for `search` chunk (CONTEXT D-05); enforce via existing bundle-budget script or add a new one mirroring `assert-bundle-budget.sh` if extant.
3. **DO NOT route consumer search files to `admin-shell`** — admin chunk has min-role gate; consumer search must load for all authenticated users.

---

## Shared Patterns (cross-cutting)

### Authentication / Authorization

**For SECURITY INVOKER RPC (`search_content`):**
- **NO `auth.uid()` guard inside body** — RLS on underlying tables enforces visibility.
- `revoke execute from public; grant execute to authenticated;` — NEVER `service_role` (RLS bypass defeats INVOKER contract per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
- `set search_path = public` (per memory `reference_supabase_migration_gotchas`).

**For SECURITY DEFINER digest-helper RPCs:**
- **NO `auth.uid()` reference** — called from service-role Edge Fns; `auth.uid()` returns NULL. Caller passes `p_user_id` explicitly (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
- `grant execute to service_role` (NOT `authenticated`).
- `set search_path = public, extensions`; `stable` for read-only.

**For service-role Edge Fns (`community-daily-digest`, `community-weekly-digest`):**
- `checkServiceRoleBearer(req)` from `_shared/lifecycle-utils.ts` — handles `sb_secret_*` vs JWT formats (per memory `reference_supabase_service_role_key_format_divergence`).
- POST-only; 405 on GET/PUT/DELETE.

**For unauthenticated token-gated Edge Fn (`unsubscribe-handler`):**
- **NO `Authorization` header check** — URL signature IS the auth.
- Accepts BOTH GET (link click) and POST (RFC 8058 One-Click).
- `verifyUnsubscribeToken` constant-time HMAC compare + exp check.

### Error handling / response shape

**All Edge Fns:** use `jsonError(status, code)` helper from `_shared/lifecycle-utils.ts` — codes are snake_case strings (`'unauthorized'`, `'invalid_token'`, `'missing_user_id'`, `'missing_token'`, `'method_not_allowed'`, `'internal'`). NEVER include stack traces or PII in body.

**`unsubscribe-handler`:** returns HTML (not JSON) on success — `Content-Type: text/html; charset=utf-8` + `Cache-Control: no-store` + `<meta name="robots" content="noindex">`.

**Digest Fns:** return `{ status: 'sent' | 'skipped:no-content' | 'skipped:opted_out' | 'error' }` JSON for service-role caller introspection.

### PHI routing

**All digest sends:** `sendEmail({ template, phi: false, … })` — community content is non-PHI per CONTEXT canonical_refs even when `community_spaces.org_id IS NOT NULL`. Plan-checker greps `sendEmail(` calls in Phase 49 Fns; bare `phi: true` is a HARD BLOCKER (digests should NEVER route via SES).

### Deno.serve guard (test trap mitigation)

**Apply to:** every new Edge Fn `index.ts`.

```typescript
if (Deno.env.get('<FN_NAME>_DISABLE_SERVE') !== '1') {
  Deno.serve(handler);
}
```

Env var names:
- `COMMUNITY_DAILY_DIGEST_DISABLE_SERVE`
- `COMMUNITY_WEEKLY_DIGEST_DISABLE_SERVE`
- `UNSUBSCRIBE_HANDLER_DISABLE_SERVE`

Per memory `reference_deno_test_top_level_serve_trap`. Test runner sets env var; production deploys don't.

### Migration timestamp ordering

- Phase 46 lands course tables in `20270720*..20270730*` window (per Phase 46 plans).
- Phase 47 lands events in `20270801*`.
- Phase 48 lands moderation in `20270901*`.
- Phase 49 uses **`20271001*`** for ALL migrations to guarantee dependencies exist when FTS ALTER + helper RPCs run.
- Per memory `reference_migration_timestamp_collision_precheck` — pre-merge glob `supabase/migrations/20271001*.sql >1` to confirm no internal Phase 49 collision before push.
- **Plan-checker iter-1 BLOCKER:** verify Phase 46 + 47 + 48 EXECUTE merged BEFORE Phase 49 dispatch (per RESEARCH §Environment Availability — currently both are PENDING).

### Vendor secret pre-flight (Wave 0 dispatch)

**Per memory `feedback_vendor_secret_preflight_surface`** — orchestrator dispatch confirmation MUST surface:
```bash
# NEW for Phase 49:
supabase secrets set UNSUBSCRIBE_SECRET=$(openssl rand -base64 32) --project-ref ytnsipxxmzgaebkqmokp

# Verify:
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep UNSUBSCRIBE_SECRET
```

Operator runs in parallel with Wave 0 execute. Other secrets (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `SUPABASE_URL`) inherited from prior phases — Phase 49 does NOT re-surface.

**NOTE:** `UNSUBSCRIBE_SECRET` is a **Supabase Function Secret** (`Deno.env.get`), NOT a `vault.secrets` entry. Per RESEARCH Pitfall 8 — if any plpgsql code attempts to mint tokens (none should in v1), would need ALSO `INSERT INTO vault.secrets`. Plan-checker greps plpgsql functions for `unsubscribe_secret`; if matched, BLOCKER.

### Rejected-alternative names in committed code

**Per memory `feedback_negation_grep_defeated_by_comment_string`:**
- Do NOT write `-- chose websearch_to_tsquery over to_tsquery` in committed SQL comments.
- Do NOT write `-- chose SECURITY INVOKER over DEFINER` in committed SQL.
- Do NOT write `// chose cmdk over react-cmdk` in committed TS comments.
- Document rejections in PLAN.md / SUMMARY.md / commit message ONLY.

---

## Sibling-collision Matrix (parallel-wave overlap detection)

Per memory `feedback_executor_tdd_scaffolds_sibling_plan_files` + `feedback_stub_then_replace_sibling_collision` — flag any new file touched by ≥2 plans in the same wave:

| File | Risk | Mitigation |
|------|------|------------|
| `supabase/functions/_shared/email-router.ts` | Phase 49 EXTEND — 1 plan widens template union | Single-plan ownership; no collision within Phase 49. |
| `supabase/migrations/20271001000005_p49_notification_digest_widening.sql` | Plan A ships CHECK widening AND category_config seed | Single-plan ownership; both in same migration file. |
| `supabase/functions/_shared/unsubscribe-token.ts` | Used by digest Fns (mint) + unsubscribe-handler (verify) | Shared helper; single-plan ownership. Digest-Fn plans `depends_on: <shared-helper plan>`. |
| `leanshot/vite.config.ts` (manualChunks) | Phase 49 single rule addition | Serial within phase; insertion point fixed (after community-mentions, before admin-shell). |
| `leanshot/src/lib/store.ts` (`searchOpen` flag) | Phase 49 single-flag addition | Single-plan ownership. |
| `leanshot/src/App.tsx` (cmd+k useEffect + lazy mount) | Phase 49 single edit | Single-plan ownership. |
| `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx` | CATEGORIES + CATEGORY_LABEL + DEFAULT_ENABLED widening + NEW "Email digests" section | Single-plan ownership within Phase 49 (settings widen plan); no collision. |
| `supabase/migrations/20271001*` filename prefix | Multiple Phase 49 migrations share prefix | Distinct 14-digit timestamps; pre-push glob check per memory `reference_migration_timestamp_collision_precheck`. |
| Cross-phase: `notification_settings_category_chk` CHECK constraint | Phase 47 + 48 + 49 ALL widen | Serial-by-phase ordering enforced by migration timestamps. Phase 49 CHECK list MUST union all live categories at apply-time (A10 — plan-checker re-runs live audit at iter-1). |

**No same-wave sibling collisions within Phase 49 itself** based on this map (each new file owned by exactly one plan).

---

## No Analog Found

Files where the closest match is partial — planner should rely on RESEARCH §Code Examples directly:

| File | Role | Reason | Fallback |
|------|------|--------|----------|
| `supabase/functions/unsubscribe-handler/index.ts` | unauthenticated token-gated GET endpoint | No prior Fn in repo runs WITHOUT Bearer auth (all existing Fns gate on either user-JWT or service-role) | Compose from `_shared/lifecycle-utils.ts` shell + `nps-token.ts` verify pattern; RESEARCH skeleton in section I above |
| `leanshot/src/lib/search/use-debounced-search.ts` | custom 300ms debounce hook | No prior debounce hook in `leanshot/src/hooks/` | Short 10-line custom hook; pattern in section O above |
| `supabase/functions/_shared/email-templates/community-{daily,weekly}-digest.ts` | non-AI digest HTML render | Phase 38 `digest-email-template.ts` is AI-narrative-heavy; Phase 49 is pure-data tables | FORK Phase 38 layout shell; replace AI prose blocks with structured data tables. Single-pass review for HTML-escape correctness. |
| `supabase/tests/p49_*.sql` cross-tenant RLS impersonation | net-new pgTAP-style SQL test | Phase 44/47/48 use `leanshot/tests/rls/*.test.ts` (Vitest+TS) — no in-repo SQL test framework analog | Use `leanshot/tests/rls/community-spaces-rls.test.ts` as analog instead; write Vitest-TS tests not pgTAP SQL. |

---

## Metadata

**Analog search scope:**
- `supabase/migrations/` — Phase 37 (KB FTS), Phase 38 (cron), Phase 42 (NPS HMAC), Phase 44 (notification widening, community SECDEF), Phase 48 (audit log shape) as canonical
- `supabase/functions/` — `weekly-digest`, `notify-community`, `_shared/lifecycle-utils.ts`, `_shared/nps-token.ts`, `_shared/email-router.ts`, `_shared/digest-email-template.ts`
- `leanshot/src/components/admin/palette/` — `AdminCommandPalette.tsx` (cmdk + cmd+k precedent)
- `leanshot/src/components/dashboard/settings/` — `NotificationsSubtab.tsx` (CATEGORIES/CATEGORY_LABEL/DEFAULT_ENABLED widening point)
- `leanshot/src/components/community/` — `CommunityPost.tsx`, `CommunityTabShell.tsx` (Card composition idiom)
- `leanshot/src/lib/community/` — `community-storage.ts`, `community-types.ts` (RPC wrapper + LOCKED-types module idiom)
- `leanshot/vite.config.ts` — manualChunks rules (community-feed, community-media, admin-shell ordering)
- `leanshot/tests/rls/` — `community-spaces-rls.test.ts`, `fixtures-community.ts` (cross-tenant impersonation idiom)

**Files scanned:** ~25 source files + 8 migrations + 4 Edge Fns + 5 test patterns
**Pattern extraction date:** 2026-05-24
**Coverage:** 100% — every net-new Phase 49 file has a pinpointed analog (4 partial-match files documented in §No Analog Found with RESEARCH §Code Examples skeleton fallback).
