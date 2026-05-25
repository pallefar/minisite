# Phase 48: M4 Moderation — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 28 net-new / 4 EXTEND
**Analogs found:** 32 / 32 (100% coverage)

> **CRITICAL inheritance from Phase 47 PATTERNS.md:** admin surface is **pathname-based, NOT react-router** (per CORRECTED memory `reference_react_router_consumer_admin_split` — live audit 2026-05-23 of `src/admin/modules/community/CommunityAdminLayout.tsx`, `src/admin/modules/reviews/ReviewsLayout.tsx`, `src/components/admin/AdminShell.tsx`). Planner: copy the `CommunityAdminLayout` pattern verbatim; do NOT introduce `<Routes>`/`<Route>` JSX in `ModerationLayout.tsx`. Phase 47 plan 47-NN (admin events) shipped this pattern clean — Phase 48 mirrors it.
>
> **Migration timestamp ordering:** Phase 45 ships `community_reports` in `20270727*`; Phase 46 ships course tables in `20270720*..20270730*`; Phase 47 ships events in `20270801*`. Phase 48 uses **`20270901*`** to land AFTER all dependencies. Per memory `reference_migration_timestamp_collision_precheck` — pre-merge glob `supabase/migrations/20270901*.sql >1` to verify no internal collision before push.
>
> **Vendor secret pre-flight (per memory `feedback_vendor_secret_preflight_surface`):** orchestrator dispatch confirmation MUST surface `ANTHROPIC_API_KEY_CONSUMER` (Phase 25 D-14 consumer credential — already set; Phase 48 reuses, no new secret) and HMAC secret `MODERATION_HMAC_SECRET` for `banned-words-sweep` + `ban-enforcement` Fns (NEW). Run `supabase secrets list` BEFORE Wave 0 dispatch.

---

## File Classification

### Database (migrations) — all timestamps `20270901*`

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `supabase/migrations/20270901000001_p48_community_reports_extend.sql` | schema (ALTER) | CRUD | `supabase/migrations/20270720000004_p44_notification_community.sql` (drop-then-add CHECK + same-txn pattern) | exact | FORK |
| `supabase/migrations/20270901000002_p48_can_moderate_report_org_helper.sql` | SECDEF helper fn | request-response | `supabase/migrations/20261101000006_is_staff_helper.sql` | exact | FORK |
| `supabase/migrations/20270901000003_p48_report_content_rpc.sql` | SECDEF RPC | CRUD | `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` (SECDEF shell + auth.uid() guard + ERRCODE) | exact | FORK |
| `supabase/migrations/20270901000004_p48_user_moderation_state.sql` | schema + RLS | CRUD | `supabase/migrations/20270702000004_phi_access_log.sql` (table + enable RLS + REVOKE pattern) + Phase 44 RLS predicate idiom | role-match | FORK |
| `supabase/migrations/20270901000005_p48_mute_rls_widen.sql` | RLS (ALTER policies) | request-response | `supabase/migrations/20270720000002_p44_community_rls.sql` (drop+recreate SELECT policies) | exact | FORK |
| `supabase/migrations/20270901000006_p48_ban_write_deny_widen.sql` | RLS (ALTER policies) | request-response | `supabase/migrations/20270720000002_p44_community_rls.sql` (INSERT/UPDATE/DELETE WITH CHECK widening) | exact | FORK |
| `supabase/migrations/20270901000007_p48_banned_words.sql` | schema + SECDEF RPC | CRUD | `supabase/migrations/20270720000001_p44_community_schema.sql` (table+RLS) + `20270720000005_p44_community_secdef_rpcs.sql` (upsert RPC) | exact | FORK |
| `supabase/migrations/20270901000008_p48_banned_words_trigger.sql` | trigger fn | event-driven | `supabase/migrations/20270703000013_fix_trigger_ad_etl_backfill_is_admin.sql` (pg_net.http_post from trigger, vault.decrypted_secrets bearer) | role-match | FORK |
| `supabase/migrations/20270901000009_p48_auto_flag_trigger.sql` | trigger fn | event-driven | Same as 0008 + Phase 38 weekly-digest fire-and-forget pattern | role-match | FORK |
| `supabase/migrations/20270901000010_p48_moderation_audit_log.sql` | schema + RLS + RPC | CRUD | `supabase/migrations/20270702000004_phi_access_log.sql` + `20270702000005_log_phi_access_rpc.sql` | **EXACT — verbatim recipe** | VERBATIM (copy + rename) |
| `supabase/migrations/20270901000011_p48_notification_settings_widen.sql` | CHECK widening | schema | `supabase/migrations/20270720000004_p44_notification_community.sql` | **EXACT** | FORK (verbatim recipe — drop+add CHECK on all 4 tables in one txn) |
| `supabase/migrations/20270901000012_p48_temp_suspended_restore_cron.sql` | cron | event-driven | `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` (single-job block) + Phase 47 D-pg_cron pattern | exact | VERBATIM (copy single-job block; swap fn URL + tag names) |

### Edge Functions

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|---------------------|------|-----------|----------------|---------------|------------|
| `supabase/functions/claude-moderation/index.ts` | service | request-response | `supabase/functions/weekly-digest/index.ts` (Anthropic + structured output) + `_shared/anthropic-summarize.ts` (consumer creds; messages API call) | role-match | FORK |
| `supabase/functions/claude-moderation/deno.json` | config | — | `supabase/functions/notify-community/deno.json` | exact | VERBATIM |
| `supabase/functions/claude-moderation/index.test.ts` | Fn test | request-response | `supabase/functions/notify-community/index.test.ts` (HMAC + Deno.serve guard + setVerifyForTest seam) | exact | FORK |
| `supabase/functions/banned-words-sweep/index.ts` | service | batch | `supabase/functions/notify-community/index.ts` (HMAC dual-auth + service-role bearer fan-out loop) + `audit-archive/index.ts` (cursored batch iterate) | role-match | FORK |
| `supabase/functions/banned-words-sweep/deno.json` | config | — | `supabase/functions/notify-community/deno.json` | exact | VERBATIM |
| `supabase/functions/banned-words-sweep/index.test.ts` | Fn test | batch | `supabase/functions/notify-community/index.test.ts` | exact | FORK |
| `supabase/functions/ban-enforcement/index.ts` | service | event-driven | `supabase/functions/notify-community/index.ts` (HMAC + service-role bearer auth shell) + RESEARCH §spike pinned `auth.sessions` DELETE body | role-match | FORK |
| `supabase/functions/ban-enforcement/deno.json` | config | — | `supabase/functions/notify-community/deno.json` | exact | VERBATIM |
| `supabase/functions/ban-enforcement/index.test.ts` | Fn test | event-driven | `supabase/functions/notify-community/index.test.ts` | exact | FORK |
| `supabase/functions/audit-archive/index.ts` | service | batch | (self) | — | **EXTEND** — widen Parquet cold archive table list to include `moderation_audit_log` (mirror existing `phi_access_log` branch) |

### Client (admin) — pathname-based, NO react-router

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `leanshot/src/admin/modules/moderation/ModerationLayout.tsx` | layout | request-response | `leanshot/src/admin/modules/community/CommunityAdminLayout.tsx` | **EXACT** | FORK (resolveView regex + sub-page lazy imports) |
| `leanshot/src/admin/modules/moderation/ReportsQueue.tsx` | component | CRUD | `CommunityAdminLayout.tsx::SpacesListPage` (inner subcomponent — list + filters + claim button) | role-match | FORK (extract to sibling file; filter chips + claim RPC button) |
| `leanshot/src/admin/modules/moderation/BannedWordsEditor.tsx` | component | CRUD | `leanshot/src/admin/modules/community/SpaceEditor.tsx` (CRUD form idiom + supabase.rpc) | role-match | FORK (textarea-rows + severity dropdown + bulk paste; calls `banned_word_upsert`) |
| `leanshot/src/admin/modules/moderation/UserBansRoster.tsx` | component | CRUD | `CommunityAdminLayout.tsx::SpacesListPage` (list + row-actions idiom) | role-match | FORK |
| `leanshot/src/admin/modules/moderation/ApplyModerationForm.tsx` | component | request-response | `leanshot/src/admin/modules/community/SpaceEditor.tsx` (Modal form + Button submit + useToast) | role-match | FORK |
| `leanshot/src/admin/modules/moderation/AuditLogViewer.tsx` | component | CRUD (read-only) | `leanshot/src/components/admin/AuditLogModule.tsx` | **EXACT** | FORK (swap table name + filter columns; same CSV export idiom) |
| `leanshot/src/lib/admin/modules.ts` (MODIFY) | config | — | (self) | — | **EXTEND** — add `'moderation'` manifest entry with `route: 'moderation'`, `minRole: 'staff'`, `lazy: () => import('@/admin/modules/moderation/ModerationLayout').then(m => ({ default: m.default }))` (per memory `feedback_admin_module_manifest_vs_router_branch_drift`) |
| `leanshot/src/components/admin/AdminShell.tsx` (MODIFY — IF DRIFT) | router | — | (self) | — | **EXTEND IF NEEDED** — verify URL-prefix catch-all branch covers `/admin/moderation/*` paths (per memory `feedback_admin_module_manifest_vs_router_branch_drift` — Phase 42-10 caught 6 pre-existing broken admin routes via this). If `AdminShell` has a switch keyed on first-segment, add `moderation` branch. |

### Client (consumer) — minimal surface (ban blocker only)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|---------------------|------|-----------|----------------|---------------|------------|
| `leanshot/src/components/AccountSuspended.tsx` | component | request-response | `leanshot/src/components/admin/ClinicianMfaGuard.tsx` (full-page blocker idiom) OR `leanshot/src/components/onboarding/OnboardingFlow.tsx` (pre-dashboard route gate) | role-match | FORK (read `user_moderation_state` on mount; render appeal contact `support@leanshot.app`; NO in-app appeal form per CONTEXT D-deferred) |
| `leanshot/src/components/AccountSuspended.test.tsx` | test | — | `leanshot/src/components/admin/QuarterlyNPSDashboard.test.tsx` (component test pattern) | role-match | FORK |
| `leanshot/src/App.tsx` (MODIFY) | router | — | (self, marketing/onboarding/dashboard switch) | — | **EXTEND** — at the top-level view selector, **BEFORE** dispatching to dashboard, read `useStore((s) => s.userModerationStatus)`. If `'banned'` or `'temp_suspended'`, render `<AccountSuspended />` instead of `<AppShell>`. Mirror the existing marketing/onboarding gating idiom. NO new tab — admin module owns the moderation surface. |
| `leanshot/src/lib/store.ts` (MODIFY) | state | — | (self, ephemeral UI slice) | — | **EXTEND** — add `userModerationStatus: 'active' \| 'muted' \| 'banned' \| 'temp_suspended' \| null` + hydration helper `fetchUserModerationStatus()` (calls `supabase.from('user_moderation_state').select('status, expires_at').eq('user_id', auth.uid()).maybeSingle()`). NOT persisted (server is source of truth; re-fetch on login). |
| `leanshot/src/lib/moderation/types.ts` | types | — | `leanshot/src/lib/community/community-types.ts` | exact | FORK (LOCKED type module idiom; `interface ModerationReport`, `interface BannedWord`, `type ModerationStatus`) |
| `leanshot/src/lib/moderation/api.ts` | client lib | request-response | `leanshot/src/lib/community/community-storage.ts` (supabase.rpc wrapper shape) | role-match | FORK (wrappers for `report_content`, `triage_report`, `banned_word_upsert`, `apply_user_moderation`, `log_moderation_action`) |

### Build config

| Modified File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|---------------|------|-----------|----------------|---------------|------------|
| `leanshot/vite.config.ts` (MODIFY) | config | — | (self, Phase 44 community chunk rule + Phase 47 events chunk rule) | — | **EXTEND** — add `if (id.includes('/src/admin/modules/moderation/')) return 'admin-moderation';` rule. **Insertion ordering matters** — insert AFTER the existing `community-admin` chunk rule and BEFORE the `/src/admin/` catch-all. Target ≤ 30 kB gz. |
| `leanshot/scripts/assert-bundle-budget.sh` (MODIFY — IF EXTANT) | script | — | `leanshot/scripts/assert-helpdesk-bundle-budget.sh` + `assert-clinic-bundle-budget.sh` | role-match | FORK (new `scripts/assert-moderation-bundle-budget.sh` checking `admin-moderation*.js` ≤30 kB gz) OR extend existing `assert-bundle-budget.sh` table — plan-time inspect file structure. |

### Tests (Wave 0 contract per CONTEXT Validation Architecture)

| New File | Role | Data Flow | Closest Analog | Match Quality | Reuse Mode |
|----------|------|-----------|----------------|---------------|------------|
| `supabase/tests/p48_report_cooldown_unique.sql` | RLS/SQL | CRUD | `leanshot/tests/rls/community-spaces-rls.test.ts` (pattern) — but raw SQL test goes under `supabase/tests/` | role-match | FORK |
| `supabase/tests/p48_cross_org_isolation.sql` | RLS/SQL | request-response | Same | role-match | FORK |
| `supabase/tests/p48_mute_rls_predicate.sql` | RLS/SQL | request-response | `leanshot/tests/rls/community-spaces-rls.test.ts` | exact | FORK |
| `supabase/tests/p48_ban_write_deny.sql` | RLS/SQL | request-response | Same | exact | FORK |
| `supabase/tests/p48_audit_log_immutability.sql` | RLS/SQL | request-response | `leanshot/tests/rls/community-spaces-rls.test.ts` + `phi_access_log` REVOKE assertion idiom | role-match | FORK |
| `supabase/tests/p48_banned_words_trigger.sql` | trigger test | event-driven | Direct pgTAP-style test — no exact analog (Phase 24 events_mirror tests if present) | partial | NEW (skeleton from RESEARCH) |
| `supabase/tests/p48_auto_flag_phi_skip.sql` | trigger test | event-driven | Same | partial | NEW (skeleton from RESEARCH; assert no pg_net call when `community_spaces.org_id IS NOT NULL`) |
| `supabase/tests/p48_temp_suspended_cron.sql` | cron test | event-driven | Phase 38 cron test if present | partial | NEW |
| `leanshot/tests/rls/moderation-reports-rls.test.ts` | RLS | request-response | `leanshot/tests/rls/community-spaces-rls.test.ts` | exact | FORK (cross-tenant impersonation proof per project Rule 2) |
| `leanshot/tests/rls/moderation-audit-immutability.test.ts` | RLS | request-response | `leanshot/tests/rls/community-spaces-rls.test.ts` | exact | FORK (assert UPDATE/DELETE rejected even for service-role) |
| `leanshot/tests/rls/fixtures-moderation.ts` | fixtures | — | `leanshot/tests/rls/fixtures-community.ts` | exact | FORK (add report + moderation-state + banned-word seed helpers) |
| `leanshot/tests/integration/auto-flag-pipeline.test.ts` | integration | event-driven | `leanshot/tests/integration/community-mention-notification.test.ts` (env+admin+JWT idiom + Edge Fn invoke) | role-match | FORK |
| `leanshot/tests/integration/banned-words-sweep.test.ts` | integration | batch | Same | role-match | FORK |
| `leanshot/tests/integration/ban-enforcement.test.ts` | integration | event-driven | Same | role-match | FORK |
| `leanshot/src/admin/modules/moderation/__tests__/ModerationLayout.test.tsx` | component test | — | `leanshot/src/components/admin/QuarterlyNPSDashboard.test.tsx` | role-match | FORK |
| `leanshot/src/admin/modules/moderation/__tests__/ReportsQueue.test.tsx` | component test | — | Same | role-match | FORK |
| `leanshot/src/admin/modules/moderation/__tests__/BannedWordsEditor.test.tsx` | component test | — | Same | role-match | FORK |
| `leanshot/src/admin/modules/moderation/__tests__/UserBansRoster.test.tsx` | component test | — | Same | role-match | FORK |
| `leanshot/src/admin/modules/moderation/__tests__/AuditLogViewer.test.tsx` | component test | — | Same | role-match | FORK |

---

## Pattern Assignments

### A. Migration: `community_reports` extend (D-01, D-02)

**New file:** `supabase/migrations/20270901000001_p48_community_reports_extend.sql`
**Analog:** `supabase/migrations/20270720000004_p44_notification_community.sql` (drop+add CHECK in same txn)
**Reuse mode:** FORK

**Header pattern to inherit:**
```sql
-- Phase 48 Plan 01 — community_reports triage workflow widening.
--
-- Decisions implemented:
--   D-01: status enum widens from CHECK ('open') to CHECK ('open','triaged','resolved','dismissed').
--         + ADD COLUMN triaged_by uuid references auth.users(id), triaged_at timestamptz, dismissed_reason text.
--   D-02: partial UNIQUE on (reporter_user_id, target_type, target_id)
--         WHERE status IN ('open','triaged') — duplicate-active-report cooldown.
--
-- Per reference_supabase_migration_filename_regex: strict 14-digit timestamp.
-- Phase 45 (20270727*) ships community_reports; Phase 48 (20270901*) ALTERs.

begin;
```

**ALTER + CHECK widen idiom (lines 17-30 of analog):**
```sql
alter table public.community_reports
  drop constraint if exists community_reports_status_chk,
  add  constraint community_reports_status_chk
    check (status in ('open','triaged','resolved','dismissed'));

alter table public.community_reports
  add column if not exists triaged_by uuid references auth.users(id),
  add column if not exists triaged_at timestamptz,
  add column if not exists dismissed_reason text;

create unique index if not exists community_reports_active_dedup_uniq
  on public.community_reports (reporter_user_id, target_type, target_id)
  where status in ('open','triaged');

commit;
```

**Critical conventions:**
1. **Single transaction** — DROP+ADD CHECK in same txn (per memory `feedback_planner_missed_status_enum_widening`).
2. **`add column if not exists`** for the 3 new triage columns (safe re-run; per memory `feedback_live_db_precheck_inverts_research_grep` — confirmed via `npx supabase db query --linked` at plan-time).
3. **Partial UNIQUE** allows reporter to file a new report once admin resolves/dismisses (per CONTEXT D-02 explicit UX).
4. Partial-index predicate is IMMUTABLE (constants only — per memory `reference_supabase_migration_gotchas`).

---

### B. Migration: `can_moderate_report_org` SECDEF helper (D-04 corrected)

**New file:** `supabase/migrations/20270901000002_p48_can_moderate_report_org_helper.sql`
**Analog:** `supabase/migrations/20261101000006_is_staff_helper.sql`
**Reuse mode:** FORK

**Function shell pattern:**
```sql
-- Phase 48 Plan 02 — public.can_moderate_report_org(p_report_id uuid) returns boolean.
--
-- D-04 CORRECTED 2026-05-23: org_member_role enum values are
--   owner | clinician | staff | support_admin | support_lead — NO 'admin' value.
-- Moderation tier = owner + support_admin (clinicians focus on patient care; staff/support_lead
-- NOT granted mod authority by default).
--
-- Phase 28 org_members is source of truth.

create or replace function public.can_moderate_report_org(p_report_id uuid)
returns boolean
language sql
security definer
set search_path = public, extensions
stable
as $fn$
  select exists (
    select 1
    from public.community_reports r
    join public.community_posts p on p.id = r.target_id and r.target_type = 'post'   -- repeat for comment/dm_message branches
    join public.community_spaces s on s.id = p.space_id
    join public.org_members om     on om.org_id = s.org_id and om.user_id = auth.uid()
    where r.id = p_report_id
      and s.org_id is not null
      and om.role in ('owner','support_admin')        -- CORRECTED enum
  );
$fn$;

revoke all on function public.can_moderate_report_org(uuid) from public;
grant execute on function public.can_moderate_report_org(uuid) to authenticated;
```

**Conventions to inherit:**
1. `language sql security definer set search_path = public, extensions stable` (per `is_staff_helper` precedent + memory `reference_supabase_migration_gotchas`).
2. **NEVER reference `auth.uid()` directly** in a fn meant to be called from cron — but this fn is called from RLS (authenticated context only), so `auth.uid()` is safe (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
3. `revoke all from public; grant execute to authenticated` — NEVER grant to `service_role` here (RLS bypass would render the helper meaningless).
4. **Rejected-alternative names MUST NOT appear in committed file** (per memory `feedback_negation_grep_defeated_by_comment_string`) — do NOT write `-- chose support_admin over admin` in a comment; document the rejection in the PLAN.md/SUMMARY only.

---

### C. Migration: `report_content` SECDEF RPC (D-02)

**New file:** `supabase/migrations/20270901000003_p48_report_content_rpc.sql`
**Analog:** `supabase/migrations/20270720000005_p44_community_secdef_rpcs.sql` (function shell + auth.uid() guard + ERRCODE)
**Reuse mode:** FORK

**Function shell pattern:**
```sql
create or replace function public.report_content(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_target_type not in ('post','comment','dm_message','profile') then
    raise exception 'invalid_target_type' using errcode = '22023';
  end if;

  insert into public.community_reports (reporter_user_id, target_type, target_id, reason, status)
  values (v_user_id, p_target_type, p_target_id, p_reason, 'open')
  returning id into v_report_id;

  return jsonb_build_object('report_id', v_report_id, 'status', 'open');
exception
  when unique_violation then
    raise exception 'already_reported' using errcode = '23505',
      detail = 'You''ve already reported this; admin is reviewing.';
end;
$fn$;

revoke all on function public.report_content(text, uuid, text) from public;
grant execute on function public.report_content(text, uuid, text) to authenticated;
```

**Conventions to inherit verbatim:**
1. `language plpgsql security definer set search_path = public, extensions`.
2. `raise exception '<code>' using errcode = '<sqlstate>'` — codes: `42501` (unauthenticated), `22023` (invalid_argument), `23505` (unique_violation — clean error message on cooldown hit).
3. `revoke all from public; grant execute to authenticated` (NEVER `service_role` per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
4. **Catch `unique_violation` explicitly** and re-raise with friendly message — UI surfaces the `detail` field.

---

### D. Migration: `user_moderation_state` table + RLS (D-13)

**New file:** `supabase/migrations/20270901000004_p48_user_moderation_state.sql`
**Analog:** `supabase/migrations/20270702000004_phi_access_log.sql` (RLS enable + SELECT policy shape) + Phase 44 community schema (PK + FK idiom)
**Reuse mode:** FORK

**Table declaration (per CONTEXT D-13 verbatim):**
```sql
create table if not exists public.user_moderation_state (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  status      text        not null check (status in ('active','muted','banned','temp_suspended')),
  applied_by  uuid        not null references auth.users(id),
  reason      text,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_moderation_expires_chk check (
    (status = 'temp_suspended' and expires_at is not null) or
    (status <> 'temp_suspended' and expires_at is null)
  )
);

alter table public.user_moderation_state enable row level security;

-- SELECT: user reads own row; staff reads all.
create policy ums_select_own
  on public.user_moderation_state for select to authenticated
  using (auth.uid() = user_id);

create policy ums_select_staff
  on public.user_moderation_state for select to authenticated
  using (public.is_staff());

-- NO INSERT/UPDATE/DELETE policies for authenticated.
-- Writes ONLY via apply_user_moderation SECDEF RPC (separate migration or co-located).
```

**Critical:** mirror Phase 25 `phi_access_log` shape — **no INSERT/UPDATE/DELETE policies** = default-deny. Writes go through a co-located SECDEF RPC `apply_user_moderation(p_user_id, p_status, p_reason, p_expires_at)`. The RPC also calls `log_moderation_action(...)` and (when status='banned') fires `pg_net.http_post` to `ban-enforcement` Fn.

---

### E. Migration: mute RLS predicate widen (D-14)

**New file:** `supabase/migrations/20270901000005_p48_mute_rls_widen.sql`
**Analog:** `supabase/migrations/20270720000002_p44_community_rls.sql` (DROP+CREATE SELECT policies in same txn)
**Reuse mode:** FORK

**Pattern (apply to `community_posts`, `community_comments`, `community_reactions`, `direct_messages`):**
```sql
begin;

drop policy if exists cpost_select_tier on public.community_posts;

create policy cpost_select_tier_with_mute_hide
  on public.community_posts for select to authenticated
  using (
    -- existing tier-gate predicate copied verbatim from Phase 44
    exists (select 1 from public.community_spaces s where s.id = community_posts.space_id and …tier-check…)
    and (
      -- mute hide: author sees own; staff sees all; everyone else hidden if author muted
      author_id = auth.uid()
      or public.is_staff()
      or not exists (
        select 1 from public.user_moderation_state ums
        where ums.user_id = community_posts.author_id
          and ums.status = 'muted'
      )
    )
  );

-- Repeat for community_comments (author_id), community_reactions (user_id),
-- direct_messages (sender_user_id) — same predicate shape.

commit;
```

**Critical:** all 4 tables MUST land in ONE transaction. Document the predicate in `leanshot/src/lib/moderation/rls-predicates.ts` (per CONTEXT integration point) so future content-table RLS edits preserve the invariant.

---

### F. Migration: ban write-deny RLS widen (D-15)

**New file:** `supabase/migrations/20270901000006_p48_ban_write_deny_widen.sql`
**Analog:** Same as E (`p44_community_rls.sql` INSERT/UPDATE/DELETE policies)
**Reuse mode:** FORK

**Pattern** (apply to all user-owned write tables — posts, comments, reactions, direct_messages, ...):
```sql
drop policy if exists cpost_insert_self on public.community_posts;
create policy cpost_insert_self_unless_banned
  on public.community_posts for insert to authenticated
  with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.user_moderation_state ums
      where ums.user_id = auth.uid()
        and ums.status in ('banned','temp_suspended')
    )
  );
-- Repeat for UPDATE, DELETE policies + sibling tables.
```

**Reads continue** (GDPR portability per CONTEXT D-15 — banned users can still export own data).

---

### G. Migration: `banned_words` table + upsert RPC (D-09, D-12)

**New file:** `supabase/migrations/20270901000007_p48_banned_words.sql`
**Analog:** `supabase/migrations/20270720000001_p44_community_schema.sql` (table+RLS) + `20270720000005_p44_community_secdef_rpcs.sql` (upsert RPC shell)
**Reuse mode:** FORK

**Table declaration:** per CONTEXT D-09 verbatim (already pinned in context). RLS:
```sql
alter table public.banned_words enable row level security;
-- NO read policy for authenticated (only Edge Fn + trigger via SECDEF helper reads).
create policy banned_words_staff_read on public.banned_words for select to authenticated using (public.is_staff());
-- Write ONLY via banned_word_upsert SECDEF RPC.
```

**Co-located SECDEF RPC** `banned_word_upsert(p_word text, p_severity text)`:
```sql
create or replace function public.banned_word_upsert(p_word text, p_severity text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $fn$
declare
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_severity not in ('warn','flag','escalate') then
    raise exception 'invalid_severity' using errcode = '22023';
  end if;
  insert into public.banned_words (word, severity, created_by)
  values (lower(p_word), p_severity, auth.uid())
  on conflict (lower(word)) do update set severity = excluded.severity, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$fn$;
```

**Critical:** **NEVER use `ON CONFLICT DO DELETE`** (per memory `reference_postgres_no_insert_on_conflict_do_delete` — does not exist in Postgres). The companion `banned_word_remove(p_id uuid)` RPC must be a standalone `DELETE … WHERE id = $1` body, NOT a conflict-clause hack.

---

### H. Migration: `banned_words` trigger (D-10)

**New file:** `supabase/migrations/20270901000008_p48_banned_words_trigger.sql`
**Analog:** `supabase/migrations/20270703000013_fix_trigger_ad_etl_backfill_is_admin.sql` (pg_net.http_post from trigger + vault.decrypted_secrets bearer)
**Reuse mode:** FORK

**Trigger body pattern** (already pinned in CONTEXT D-10):
- `AFTER INSERT OR UPDATE ON community_posts, community_comments`
- Iterate `banned_words` (consider 60s cache via session-local var; trade-off in plan)
- On match: INSERT into `community_reports` with `reason = jsonb_build_object('source','banned_word','word',r.word,'severity',r.severity)`
- On `severity='escalate'`: `perform net.http_post(...)` to email-router with `notification_settings.category='banned_word_escalate'`-opted-in staff

**Critical:**
1. NOT applied to `direct_messages` (consistent with D-10).
2. Use `$fn$ … $fn$` dollar-quote tags — this is a standalone migration (no outer cron wrap).
3. **`pg_net.http_post` from trigger** needs vault.decrypted_secrets bearer + hardcoded project URL (per memory `reference_supabase_pg_cron_vault_service_role_pattern`):
```sql
select decrypted_secret into v_service_key from vault.decrypted_secrets where name='service_role_key' limit 1;
perform net.http_post(
  url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/email-router',
  headers := jsonb_build_object('Authorization', 'Bearer '||v_service_key, 'Content-Type', 'application/json'),
  body := jsonb_build_object('template','banned_word_escalate', 'phi', false, …)
);
```
4. **PHI flag:** `phi: false` for moderation emails (admin-to-admin, not patient-facing per CONTEXT canonical_refs).

---

### I. Migration: `auto_flag` trigger (D-05, D-08)

**New file:** `supabase/migrations/20270901000009_p48_auto_flag_trigger.sql`
**Analog:** Same as H + Phase 38 weekly-digest fire-and-forget pattern
**Reuse mode:** FORK

**Critical inheritance:**
1. **WHEN clause** filters PHI per D-08 — `WHEN (exists (select 1 from community_spaces s where s.id = NEW.space_id and s.org_id is null))`. Trigger fires ONLY on global-space content.
2. **DMs uniformly skip** (per D-08) — trigger declared only on `community_posts` + `community_comments`, NOT `direct_messages`.
3. Trigger body fires `pg_net.http_post` to `claude-moderation` Edge Fn with `{ content_type, content_id, body, space_id }` payload. Same vault bearer pattern as H.
4. Fire-and-forget — trigger does NOT wait on the HTTP response (per CONTEXT D-05 explicit "doesn't block on Claude latency").

---

### J. Migration: `moderation_audit_log` (D-16) — **EXACT verbatim from phi_access_log**

**New file:** `supabase/migrations/20270901000010_p48_moderation_audit_log.sql`
**Analog:** `supabase/migrations/20270702000004_phi_access_log.sql` + `20270702000005_log_phi_access_rpc.sql`
**Reuse mode:** **VERBATIM (copy + rename)**

**Excerpt to copy verbatim (lines 60-110 of analog):**
```sql
create table public.moderation_audit_log (
  id bigserial primary key,
  actor_id uuid references auth.users(id) on delete set null,  -- nullable for system actions
  action_type text not null,
  target_type text not null check (target_type in ('post','comment','dm_message','profile','user','space','banned_word')),
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index moderation_audit_log_actor_time_idx on public.moderation_audit_log (actor_id, created_at desc);
create index moderation_audit_log_target_time_idx on public.moderation_audit_log (target_type, target_id, created_at desc);

alter table public.moderation_audit_log enable row level security;

-- SELECT staff only.
create policy mod_audit_select_staff
  on public.moderation_audit_log for select to authenticated
  using (public.is_staff());

-- NO INSERT/UPDATE/DELETE policy for authenticated.
-- Writes flow exclusively through log_moderation_action SECDEF RPC.

-- Per RESEARCH Pitfall 6 (phi_access_log): explicitly REVOKE UPDATE+DELETE from service_role
-- so the append-only invariant holds even for privileged callers.
revoke update, delete on public.moderation_audit_log from service_role;
```

**Co-located RPC** `log_moderation_action(p_action_type, p_target_type, p_target_id, p_before, p_after, p_reason)` — mirror `log_phi_access` shape from migration `20270702000005`. `actor_id` ALWAYS sourced from `auth.uid()` inside the RPC — NEVER from caller args (per phi_access_log "T-25-02-03 Repudiation" comment).

**Critical conventions:**
1. **Append-only invariant:** NO INSERT/UPDATE/DELETE policies for `authenticated` + REVOKE update,delete from `service_role`.
2. **`on delete set null` for `actor_id`** — audit row survives after staff account deletion (the access event is still a fact).
3. **Negative-space tamper comment** (mirror phi_access_log convention) — document the two write paths (SECDEF RPC + service_role INSERT) inline at the top of the file.

---

### K. Migration: `notification_settings` widen (D-12)

**New file:** `supabase/migrations/20270901000011_p48_notification_settings_widen.sql`
**Analog:** `supabase/migrations/20270720000004_p44_notification_community.sql`
**Reuse mode:** **FORK (verbatim recipe — drop+add CHECK on all 4 tables in one txn)**

**Excerpt to copy and extend (lines 22-55 of analog):**
```sql
begin;

-- D-12: add 1 category: banned_word_escalate.
alter table public.notification_settings
  drop constraint if exists notification_settings_category_chk,
  add  constraint notification_settings_category_chk
    check (category in (
      'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
      'community-mentions','community-replies',
      'event_reminders_1d','event_reminders_1h','event_promotion',   -- ← Phase 47 D-19
      'banned_word_escalate'                                          -- ← P48 D-12 addition
    ));
-- Repeat for: notification_category_config, user_notifications, notification_dismissal_state.

-- Default OFF for existing users (admin opt-in only):
insert into public.notification_settings (user_id, category, in_app, email)
select id, 'banned_word_escalate', false, false
  from public.profiles
where exists (select 1 from public.profiles p2 where p2.id = profiles.id and p2.is_staff = true)
on conflict (user_id, category) do nothing;

commit;
```

**Critical:**
1. All 4 tables in ONE txn (per memory `feedback_planner_missed_status_enum_widening`).
2. **Include Phase 47's categories** (`event_reminders_1d`, `event_reminders_1h`, `event_promotion`) in the CHECK union — Phase 47 ships them before Phase 48. Verify at plan-time via `grep "event_reminders_1d" supabase/migrations/2027080*.sql`.
3. Seed defaults OFF (staff opt-in via UI).

---

### L. Migration: `temp_suspended_restore` pg_cron (D-15)

**New file:** `supabase/migrations/20270901000012_p48_temp_suspended_restore_cron.sql`
**Analog:** `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` — copy single-job block; Phase 47 D-cron precedent
**Reuse mode:** **VERBATIM** (only fn URL + tag names change)

**Excerpt to copy:**
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $unschedule$
begin
  perform cron.unschedule('phase48-temp-suspended-restore-hourly');
exception when others then null;
end $unschedule$;

select cron.schedule(
  'phase48-temp-suspended-restore-hourly',
  '0 * * * *',
  $cron$
  do $restore$    -- ← UNIQUE inner tag per reference_postgres_dollar_quote_nesting_in_cron_body
  declare
    v_count int;
  begin
    update public.user_moderation_state
       set status = 'active',
           expires_at = null,
           updated_at = now()
     where status = 'temp_suspended'
       and expires_at < now();
    get diagnostics v_count = row_count;
    if v_count > 0 then
      raise notice 'phase48-temp-suspended-restore: restored % users', v_count;
    end if;
  end;
  $restore$;
  $cron$
);
```

**Critical:**
1. **Inner tag MUST be `$restore$`** — NOT `$digest$` (Phase 38), NOT `$reminders$` (Phase 47). Collision risk per memory `reference_postgres_dollar_quote_nesting_in_cron_body`.
2. **Direct SQL UPDATE** (no Edge Fn call) — restore is a single UPDATE, no need for pg_net round-trip. Simpler than the Phase 38 weekly-digest cron (which DID need pg_net to fan out to an Edge Fn).
3. **Session invalidation on restore is OPTIONAL v1** — operator UX is "user logs in next time and sees normal app" (the `status='active'` row hides the AccountSuspended blocker on next render). If forced sign-out is desired, add a `perform net.http_post(...)` call to a `ban-enforcement` Fn with action='restore' — but defer (per CONTEXT D-15 "Cron also signs the user out" can be loose v1).

---

### M. Edge Fn: `claude-moderation`

**New file:** `supabase/functions/claude-moderation/index.ts`
**Primary analog:** `supabase/functions/weekly-digest/index.ts` (HMAC + Anthropic call + structured output parse)
**Secondary analog:** `supabase/functions/_shared/anthropic-summarize.ts` (consumer Anthropic creds; messages API shape)
**Reuse mode:** FORK

**Imports + CORS pattern:**
```typescript
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { callAnthropicConsumer } from '../_shared/anthropic-summarize.ts';   // verify exact import name at plan-time

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown): Response { /* … */ }
function jsonError(status: number, code: string): Response { return jsonResponse(status, { error: code }); }
```

**Service-role bearer auth** (per memory `reference_supabase_service_role_key_format_divergence`): use `checkServiceRoleBearer` from `_shared/lifecycle-utils.ts` — handles `sb_secret_*` vs legacy JWT formats with `constantTimeEqual`. Reject bare `===` compare.

**Anthropic model pin** (per memory `reference_anthropic_model_id_hyphenated_format`):
```typescript
const MODERATION_MODEL = 'claude-haiku-4-5-20251001';   // HYPHENATED — NEVER dotted 4.5
```

**Structured-output JSON schema** (per CONTEXT D-06 verbatim):
```typescript
const MODERATION_SCHEMA = {
  type: 'object',
  properties: {
    toxicity:               { type: 'number', minimum: 0, maximum: 1 },
    spam:                   { type: 'number', minimum: 0, maximum: 1 },
    medical_misinformation: { type: 'number', minimum: 0, maximum: 1 },
    rationale:              { type: 'string' },
  },
  required: ['toxicity','spam','medical_misinformation','rationale'],
  additionalProperties: false,
};
```

**Flag insertion** (per D-07): on `max(scores) >= 0.7`, INSERT into `community_reports` with `reporter_user_id=NULL` (system reporter), `reason = { source: 'claude_auto_flag', category, confidence, rationale }`, `status='open'`. Use service-role admin client; bypass RLS for the write. **NEVER auto-remove content** (success-criterion-locked).

**Audit log call:** after INSERT, call `supabase.rpc('log_moderation_action', { p_action_type: 'auto_flag', p_target_type, p_target_id, p_before: null, p_after: { scores }, p_reason: rationale })`.

**Deno.serve guard** (per memory `reference_deno_test_top_level_serve_trap`):
```typescript
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
```

---

### N. Edge Fn: `banned-words-sweep`

**New file:** `supabase/functions/banned-words-sweep/index.ts`
**Primary analog:** `supabase/functions/notify-community/index.ts` (HMAC + service-role-bearer dual auth + fan-out loop)
**Secondary analog:** `supabase/functions/audit-archive/index.ts` (cursored batch iterate pattern)
**Reuse mode:** FORK

**Request body shape:** `{ start_cursor: uuid | null, batch_size: 100 }`. Returns `{ next_cursor: uuid | null, matched: number, scanned: number }`. Client (admin UI in `BannedWordsEditor.tsx`) re-invokes until `next_cursor === null`.

**Idempotency:** rely on partial UNIQUE on `community_reports (target_type, target_id) WHERE reason->>'source'='banned_word'` (declare this in the `community_reports` migration A) — re-runs of the sweep do NOT duplicate reports.

**Reuse `checkServiceRoleBearer` + HMAC dual-auth** from Phase 38 winback pattern (per memory `reference_supabase_service_role_key_format_divergence`).

---

### O. Edge Fn: `ban-enforcement`

**New file:** `supabase/functions/ban-enforcement/index.ts`
**Primary analog:** `supabase/functions/notify-community/index.ts` (HMAC + service-role bearer auth shell)
**Secondary analog:** RESEARCH §spike pinned body (already validated 2026-05-23 — service-role can DML `auth.sessions`)
**Reuse mode:** FORK

**Service-role admin client + session DELETE:**
```typescript
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// D-15: spike confirmed service-role can DML auth.sessions.
// Use raw SQL via .rpc('run_admin_sql', { sql: ... }) helper IF available,
// OR direct .from('auth.sessions').delete().eq('user_id', user_id) — verify exact API at plan-time.
// Researcher pinned: DELETE FROM auth.sessions WHERE user_id = $1; DELETE FROM auth.refresh_tokens WHERE user_id = $1;
```

**Audit log on success:** `await admin.rpc('log_moderation_action', { p_action_type: 'session_revoked', p_target_type: 'user', p_target_id: user_id, p_reason: 'ban_applied' });`

**Critical:**
1. **HMAC orchestrator-auth** — Fn called from a pg trigger via pg_net, NOT cron. Use HMAC-payload auth pattern (Phase 38 winback) NOT cron+HS256-JWT (per memory `reference_supabase_service_role_key_format_divergence`).
2. **Idempotent** — DELETE on already-absent rows returns 0 rows (no error).
3. **Deno.serve guard** as per M.

---

### P. Edge Fn extension: `audit-archive`

**Modified file:** `supabase/functions/audit-archive/index.ts`
**Reuse mode:** **EXTEND**

**Add `moderation_audit_log` to the cold-archive table list.** Inspect existing `audit-archive/index.ts` (~339 lines) — there's a `TABLES_TO_ARCHIVE` array or similar. Insert `'moderation_audit_log'` next to `'phi_access_log'` and `'audit_logs'`. Parquet schema columns: mirror moderation_audit_log columns.

**Retention:** 90d hot + Parquet cold (per CONTEXT canonical_refs Phase 24 D-16).

---

### Q. Admin: `ModerationLayout.tsx` — pathname-based

**New file:** `leanshot/src/admin/modules/moderation/ModerationLayout.tsx`
**Analog:** `leanshot/src/admin/modules/community/CommunityAdminLayout.tsx`
**Reuse mode:** **FORK (verbatim — pathname-based, NO react-router)**

**Preamble pattern (lines 1-22 of analog):**
```typescript
/**
 * Phase 48 Plan NN — ModerationLayout.
 *
 * Admin module entry for Moderation queue + Banned words + User bans + Audit log.
 *
 * Routing model: pathname-based (consistent with other admin modules
 * per CommunityAdminLayout.tsx, ReviewsLayout.tsx — NO react-router-dom).
 *
 * Sub-routes (resolveView regex `^/admin/moderation/?([^/]+)?/?([^/]+)?`):
 *   /admin/moderation                → ReportsQueue (default)
 *   /admin/moderation/auto-flags     → ReportsQueue filtered reporter='system'
 *   /admin/moderation/banned-words   → BannedWordsEditor
 *   /admin/moderation/bans           → UserBansRoster
 *   /admin/moderation/bans/:id       → ApplyModerationForm for user :id
 *   /admin/moderation/audit-log      → AuditLogViewer
 *
 * Registers in ADMIN_MODULES manifest via src/lib/admin/modules.ts (separate edit).
 *
 * Admin surface — react-router-dom NOT required here; pathname-based switching
 * matches the existing project convention for admin modules (Phase 47 precedent).
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
```

**Critical conventions to inherit:**
1. **NO `import { Route, Routes } from 'react-router-dom'`** (per memory `reference_react_router_consumer_admin_split` corrected + Phase 47 PATTERNS.md precedent).
2. `useState<string>(window.location.pathname)` + `useEffect` listening on `popstate` to recompute sub-view.
3. Lazy sub-imports: `const ReportsQueue = lazy(() => import('./ReportsQueue').then(m => ({ default: m.ReportsQueue })));`.
4. `<Suspense fallback={<Skeleton />}>` wraps each sub-view render.
5. **Rejected-alternative names MUST NOT appear in committed file** — do NOT write `// chose pathname-based over react-router` (per memory `feedback_negation_grep_defeated_by_comment_string`).

---

### R. Admin: `BannedWordsEditor.tsx`

**New file:** `leanshot/src/admin/modules/moderation/BannedWordsEditor.tsx`
**Analog:** `leanshot/src/admin/modules/community/SpaceEditor.tsx` (CRUD form + supabase.rpc + useToast)
**Reuse mode:** FORK

**Conventions to inherit:**
1. `supabase.rpc('banned_word_upsert', { p_word, p_severity })` for add/update; `supabase.rpc('banned_word_remove', { p_id })` for delete.
2. `useToast` for success/error feedback (per `src/hooks/useToast.ts`).
3. Bulk paste textarea idiom: parse `\n`-separated; iterate `Promise.allSettled` over upsert calls.
4. "Re-run sweep" button calls `supabase.functions.invoke('banned-words-sweep', { body: { start_cursor: null, batch_size: 100 } })` in a loop until `next_cursor === null`; render progress bar.

---

### S. Admin: `AuditLogViewer.tsx`

**New file:** `leanshot/src/admin/modules/moderation/AuditLogViewer.tsx`
**Analog:** `leanshot/src/components/admin/AuditLogModule.tsx`
**Reuse mode:** **FORK (extract pattern verbatim — same filter + CSV export idiom)**

**Conventions:**
1. Same filter shape (actor / action_type / target_type / created_after) — copy the filter state model.
2. CSV export: same `Blob`+`URL.createObjectURL` idiom (per analog).
3. Read-only: NO inline edit UI (audit table is append-only per D-16).

---

### T. Admin manifest entry — load-bearing

**Modified file:** `leanshot/src/lib/admin/modules.ts`
**Reuse mode:** **EXTEND**

**Per memory `feedback_admin_module_manifest_vs_router_branch_drift`:** insert new entry alongside existing entries (Users, Membership, Analytics, Audit Log, etc.):
```typescript
{
  key:    'moderation',
  label:  'Moderation',
  route:  'moderation',          // /admin/moderation
  icon:   ShieldIcon,            // import from lucide-react
  lazy:   () => import('@/admin/modules/moderation/ModerationLayout').then(m => ({ default: m.default })),
  flagKey: 'admin_moderation',   // PostHog flag — default-on per Phase 48 launch
  minRole: 'staff',              // is_staff() gate
},
```

**Plan-checker grep guard:** after the edit, the manifest entry MUST be reachable via `AdminShell.tsx`'s switch/router-fallthrough. If `AdminShell` has a hardcoded first-segment switch (per memory — Phase 42-10 caught 6 broken routes), the plan MUST also edit `AdminShell.tsx` to add a `case 'moderation'` branch OR confirm a generic URL-prefix branch exists. **Plan-time verify:** `grep -n "case '" leanshot/src/components/admin/AdminShell.tsx | head -20`.

---

### U. Consumer: `AccountSuspended.tsx` + `App.tsx` blocker

**New file:** `leanshot/src/components/AccountSuspended.tsx`
**Analog (partial):** `leanshot/src/components/admin/ClinicianMfaGuard.tsx` (full-page blocker pattern) OR existing onboarding/marketing route-gate idiom in `App.tsx`
**Reuse mode:** FORK

**Component shape:**
```typescript
/**
 * Phase 48 Plan NN — AccountSuspended (consumer surface blocker).
 *
 * Rendered by App.tsx when useStore((s) => s.userModerationStatus) is 'banned' or 'temp_suspended'.
 * Replaces <AppShell> at the top-level view switch (mirrors marketing/onboarding gate idiom).
 *
 * Appeal path: mailto:support@leanshot.app (per CONTEXT D-deferred — NO in-app appeal v1).
 */
export default function AccountSuspended() {
  const status   = useStore((s) => s.userModerationStatus);
  const expires  = useStore((s) => s.userModerationExpiresAt);
  // … full-page Card with status, expires_at (if temp_suspended), appeal mailto
}
```

**Modified file:** `leanshot/src/App.tsx`
**Pattern:** in the existing view-selector (`if (!user) → marketing; else if (!onboarded) → onboarding; else → dashboard`), add a new branch **BEFORE** dashboard:
```typescript
if (userModerationStatus === 'banned' || userModerationStatus === 'temp_suspended') {
  return <Suspense fallback={<Skeleton />}><AccountSuspended /></Suspense>;
}
```

**Modified file:** `leanshot/src/lib/store.ts`
**Pattern:** add ephemeral UI slice (NOT persisted):
```typescript
userModerationStatus: 'active' | 'muted' | 'banned' | 'temp_suspended' | null,
userModerationExpiresAt: string | null,
fetchUserModerationStatus: async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data } = await supabase.from('user_moderation_state')
    .select('status, expires_at')
    .eq('user_id', user.id)
    .maybeSingle();
  set({ userModerationStatus: data?.status ?? 'active', userModerationExpiresAt: data?.expires_at ?? null });
},
```

**Hydration trigger:** call `fetchUserModerationStatus()` on `main.tsx` post-hydrate (similar to existing `hydrate()` flow) AND on Supabase auth state change (`onAuthStateChange`). NOT persisted (server is source of truth).

---

### V. Consumer: `lib/moderation/types.ts` + `api.ts`

**New files:**
- `leanshot/src/lib/moderation/types.ts` — analog: `leanshot/src/lib/community/community-types.ts` — VERBATIM idiom (pure types, no runtime, no imports).
- `leanshot/src/lib/moderation/api.ts` — analog: `leanshot/src/lib/community/community-storage.ts` — FORK (thin `supabase.rpc(...)` wrappers).
- `leanshot/src/lib/moderation/rls-predicates.ts` (NEW per CONTEXT integration-point) — documentation-only module exporting the muted-content-hide predicate string for future-edit reference.

---

### W. Build config: vite chunk rule + bundle budget

**Modified file:** `leanshot/vite.config.ts`
**Pattern:** insert chunk rule:
```typescript
// Phase 48 Plan NN — admin-moderation chunk (target ≤ 30 kB gz per CONTEXT bundle ceiling).
if (id.includes('/src/admin/modules/moderation/')) return 'admin-moderation';
```
**Ordering matters** (per existing comment in `vite.config.ts`). Insert AFTER community-admin chunk rule (Phase 44) and AFTER events chunk rule (Phase 47), BEFORE the catch-all `/src/admin/` fallthrough.

**New script:** `leanshot/scripts/assert-moderation-bundle-budget.sh`
**Analog:** `leanshot/scripts/assert-helpdesk-bundle-budget.sh` (≤30 kB gz check via gzip-size of dist file)
**Reuse mode:** FORK (swap chunk name `helpdesk` → `admin-moderation`, threshold check at 30 kB).

---

### X. Tests

**RLS SQL tests** (`supabase/tests/p48_*.sql`) — fork from `leanshot/tests/rls/community-spaces-rls.test.ts` shape. Per project Rule 2, every RLS surface gets a live cross-tenant impersonation proof.

**Integration tests** — all forks of `leanshot/tests/integration/community-mention-notification.test.ts`:
- env block (SUPABASE_URL, ANON, SERVICE_ROLE, MODERATION_HMAC_SECRET)
- `helpers/admin-session` JWT mint
- file header comment: `// REQUIRES: 48-NN supabase db push --linked + supabase functions deploy + ANTHROPIC_API_KEY_CONSUMER + MODERATION_HMAC_SECRET set in Function Secrets`

**Fn tests** — all forks of `supabase/functions/notify-community/index.test.ts`:
- `setVerifyForTest`/`setAdminForTest` injection seams
- Deno.serve guard (per memory `reference_deno_test_top_level_serve_trap`)
- HMAC + service-role bearer dual-auth coverage

**Component tests** — all forks of `leanshot/src/components/admin/QuarterlyNPSDashboard.test.tsx` shape.

---

## Shared Patterns (cross-cutting)

### Authentication / Authorization

**For SECDEF RPCs (report_content, banned_word_upsert, apply_user_moderation, log_moderation_action, can_moderate_report_org):**
- `auth.uid()` guard; raise `'42501'` if NULL (or `'forbidden'` if not is_staff).
- `revoke all from public; grant execute to authenticated;` — **NEVER** `service_role` (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).
- `set search_path = public, extensions` (per memory `reference_supabase_migration_gotchas`).
- For SECDEF functions called from **triggers fired by pg_net** (i.e., the trigger writes via SECDEF, then pg_net to Edge Fn): the Edge Fn cannot call back into an `auth.uid()`-dependent RPC because service-role context has no `auth.uid()`. Use service-role-backed inline SQL or pass `actor_id` explicitly in RPC args (then validate against bearer in the RPC body).

**For service-role Edge Fns (claude-moderation, banned-words-sweep, ban-enforcement):**
- `checkServiceRoleBearer(req)` from `_shared/lifecycle-utils.ts` — handles `sb_secret_*` vs JWT formats (per memory `reference_supabase_service_role_key_format_divergence`).
- HMAC dual-auth required for trigger-invoked Fns (banned-words-sweep, ban-enforcement) — reuse Phase 38 winback pattern.

### RLS predicate library (mute-hide invariant)

**New file:** `leanshot/src/lib/moderation/rls-predicates.ts`

```typescript
/**
 * Phase 48 — Moderation RLS predicate constants (documentation-only).
 *
 * The muted-content-hide invariant: every content-table SELECT policy
 * MUST OR-extend with this predicate. Future content tables added by
 * Phase 49+ MUST integrate this predicate or document explicit exception.
 */
export const MUTED_AUTHOR_HIDE_PREDICATE = `
  author_id = auth.uid()
  OR public.is_staff()
  OR NOT EXISTS (
    SELECT 1 FROM public.user_moderation_state ums
    WHERE ums.user_id = <table>.<author_col> AND ums.status = 'muted'
  )
`;

export const BANNED_USER_WRITE_DENY_PREDICATE = `
  NOT EXISTS (
    SELECT 1 FROM public.user_moderation_state ums
    WHERE ums.user_id = auth.uid() AND ums.status IN ('banned','temp_suspended')
  )
`;
```

### PHI routing (load-bearing)

**Apply to:** every `email-router` call in `banned_words_trigger` (D-12 escalate emails) + `claude-moderation` Fn (if it ever sends mod notifications — currently does not v1).

**Phase 48 is admin-to-admin** — `phi: false` is correct for moderation emails (NOT patient-facing). Document this inline in the trigger body + Fn handler.

**Critical:** `claude-moderation` Fn MUST NOT be invoked for clinic-PHI content per D-08. The PHI gate is at the **trigger WHEN clause** (`community_spaces.org_id IS NULL`), NOT at the Fn entry. Defense-in-depth: Fn also early-returns if the content's space has `org_id IS NOT NULL` (per Anthropic data-sharing surface conservatism).

### Migration timestamp ordering

- Phase 45 ships `community_reports` (status text, default 'open') in `20270727*`.
- Phase 46 ships `course_modules`/`course_lessons` in `20270720*..20270730*`.
- Phase 47 ships `events` + notification widening in `20270801*`.
- Phase 48 uses `20270901*` for ALL migrations — guarantees Phase 45/46/47 are applied first.
- Per memory `reference_migration_timestamp_collision_precheck` — pre-merge glob `supabase/migrations/20270901*.sql` to confirm no internal collision before push.

### Vendor secret pre-flight (Wave 0 dispatch)

Per memory `feedback_vendor_secret_preflight_surface` — orchestrator dispatch confirmation MUST surface:
```bash
# Pre-existing (Phase 25 — VERIFY set):
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep ANTHROPIC_API_KEY_CONSUMER

# NEW for Phase 48:
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp \
  MODERATION_HMAC_SECRET=<openssl rand -hex 32>
```

Operator runs in parallel with Wave 0 execute (saves ~3-5h block at HUMAN-UAT gate).

### Migration filename regex

Per memory `reference_supabase_migration_filename_regex`: strict 14-digit timestamp prefix `<14-digits>_<name>.sql`. **NO letter suffixes** (silently SKIPPED by Supabase CLI). Pre-push grep `^Skipping` in `supabase db push --linked` output.

### Deno.serve guard (test trap)

Apply to **every new Edge Fn index.ts**:
```typescript
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
```
Per memory `reference_deno_test_top_level_serve_trap` — bare `Deno.serve(handler)` triggers HTTP server on `deno test` import → all tests abort.

### Per-Fn `deno.json` (URGENT — per memory)

Per memory `reference_supabase_functions_deploy_import_map_flag` — CLI v2.101.0+ silently ignores `--import-map`. Every new Edge Fn (`claude-moderation`, `banned-words-sweep`, `ban-enforcement`) MUST ship its own `deno.json` with bare imports (e.g., `npm:@supabase/supabase-js@2`) — NO `shared/*` aliases. Copy template from `supabase/functions/notify-community/deno.json` verbatim:
```json
{
  "tasks": { "test": "deno test --no-check --allow-env ." },
  "imports": { "npm:@supabase/supabase-js@2": "npm:@supabase/supabase-js@2" },
  "lint": { "rules": { "tags": ["recommended"] } },
  "fmt":  { "useTabs": false, "lineWidth": 100 }
}
```

### Negation-grep hygiene

Per memory `feedback_negation_grep_defeated_by_comment_string` — plan-checker `! grep -q 'admin'` predicate WILL fail if a committed file contains `-- chose support_admin over admin` in a comment. **All rejected-alternative names** (e.g., `admin`, `react-router-dom`, `staff_users`, `ON CONFLICT DO DELETE`) MUST be kept OUT of committed files. Document rejection in PLAN.md / SUMMARY.md / commit message only.

---

## Sibling-collision Matrix (parallel-wave overlap detection)

Per memory `feedback_executor_tdd_scaffolds_sibling_plan_files` + `feedback_stub_then_replace_sibling_collision` — flag any new file touched by ≥2 plans in the same wave:

| File | Risk | Mitigation |
|------|------|------------|
| `supabase/functions/audit-archive/index.ts` | Phase 24 owner; Phase 48 EXTENDS to add `moderation_audit_log` row to archive list | Phase 48 is post-Phase-24; serial — no overlap. |
| `leanshot/src/lib/admin/modules.ts` | Phase 24 owner; Phase 48 adds entry | Single plan owns the EXTEND within Phase 48. |
| `leanshot/src/App.tsx` (top-level view gate) | Phase 48 inserts `AccountSuspended` branch | Single plan within Phase 48. |
| `leanshot/src/lib/store.ts` (userModerationStatus slice) | Same | Single plan within Phase 48. |
| `leanshot/vite.config.ts` (manualChunks) | Phase 48 adds `admin-moderation` chunk rule | Insert AFTER Phase 47's `events` rule. No same-wave overlap. |
| Within Phase 48 Wave 0: migrations 0001 (community_reports ALTER) + 0003 (report_content RPC) | Both touch community_reports schema | Migration timestamps enforce serial apply (0001 before 0003); planner ensures `depends_on: 48-01` on the RPC plan. |
| Within Phase 48 Wave 0: 0004 user_moderation_state + 0005 mute_rls_widen + 0006 ban_write_deny_widen | 0005 + 0006 reference 0004's table | Timestamps enforce serial apply; planner sets `depends_on` accordingly. |
| Within Phase 48: ban-enforcement Fn + user_moderation_state apply RPC | Apply RPC fires pg_net → ban-enforcement | Serial: ship table+RPC in Wave 0, Fn in Wave 1 (Fn can be deployed after migration); OR co-locate if Wave 0 is large enough. |
| `leanshot/src/components/admin/AdminShell.tsx` (IF DRIFT) | Single phase | NO same-wave overlap. |

**No same-wave sibling collisions within Phase 48 itself** based on this map (each new file owned by exactly one plan; the four EXTEND files — `audit-archive/index.ts`, `App.tsx`, `store.ts`, `modules.ts`, `vite.config.ts` — are each owned by one plan).

---

## No Analog Found

Files where the closest match is partial — planner should rely on CONTEXT / RESEARCH §Code Examples directly:

| File | Role | Reason | Fallback |
|------|------|--------|----------|
| `supabase/functions/ban-enforcement/index.ts` `auth.sessions` DELETE body | service-role DML on auth schema | No prior Edge Fn in repo writes to `auth.sessions` | RESEARCH §spike pinned body (verified 2026-05-23 — service-role can DML); planner pins exact SQL inline |
| `supabase/tests/p48_auto_flag_phi_skip.sql` | trigger test asserting NO pg_net call | No prior pgTAP-style trigger test for negative pg_net assertion in repo | Use `pg_net._http_response` table inspection (per Supabase docs); planner pins query |
| `leanshot/src/lib/moderation/rls-predicates.ts` | documentation-only module exporting predicate strings | Net-new utility; no prior "predicate library" file in repo | Single short module; pattern from CONTEXT integration-point inline |
| `leanshot/scripts/assert-moderation-bundle-budget.sh` | chunk-size assertion script | `assert-helpdesk-bundle-budget.sh` exists but plan must inspect at plan-time to confirm shape | FORK existing script; swap chunk name + threshold |

---

## Metadata

**Analog search scope:**
- `supabase/migrations/` (Phase 25 phi_access_log, Phase 38 pg_cron, Phase 44 community schema/RLS/notification, Phase 28 org_members enum verified via context)
- `supabase/functions/` (`weekly-digest`, `notify-community`, `audit-archive`, `_shared/anthropic-summarize.ts`, `_shared/lifecycle-utils.ts`, `_shared/email-router.ts`)
- `leanshot/src/admin/modules/community/` (CommunityAdminLayout pathname-based pattern + SpaceEditor CRUD form)
- `leanshot/src/components/admin/AdminShell.tsx` + `src/lib/admin/modules.ts` (manifest pattern)
- `leanshot/src/components/admin/AuditLogModule.tsx` (CSV export + filter idiom for AuditLogViewer)
- `leanshot/tests/rls/` (community-spaces-rls fixtures-community)
- `leanshot/tests/integration/` (community-mention-notification env+admin+JWT idiom)
- `leanshot/scripts/assert-{helpdesk,clinic}-bundle-budget.sh` (bundle ceiling shell scripts)
- `leanshot/vite.config.ts` manualChunks rules

**Files scanned:** ~35 source files + 12 migrations + 5 Edge Fns + 4 admin module dirs + 3 bundle scripts
**Pattern extraction date:** 2026-05-23
**Coverage:** 100% — every net-new Phase 48 file has a pinpointed analog OR a documented fallback to RESEARCH/CONTEXT

---

*Phase: 48-M4 Moderation*
*Patterns mapped: 2026-05-23*
