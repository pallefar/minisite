# Phase 48: M4 Moderation - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Community-safety surface layered on Phase 44's community schema + Phase 45's `community_reports` queue table. Phase 48 EXTENDS `community_reports` with a triage workflow (`status` enum widening to `open → triaged → resolved | dismissed`), adds a SECURITY DEFINER RPC for reporters with a partial-UNIQUE-index cooldown that prevents duplicate active reports per (reporter, content), and ships a new `/admin/moderation` pathname-based admin module (sub-views: Reports queue / Auto-flags / Banned words / User bans / Audit log viewer) fork of `CommunityAdminLayout.tsx`. Auto-flagging runs ASYNC via AFTER INSERT/UPDATE triggers on `community_posts` / `community_comments` / `direct_messages` → `pg_net.http_post` → `claude-moderation` Edge Fn (consumer Anthropic credential per Phase 25 D-07; SKIPS clinic-org-scoped content per HIPAA conservatism) → structured-output JSON returns confidence 0-1 per fixed category (toxicity / spam / medical-misinformation) → ≥0.7 on any category INSERTs a system-reporter row into `community_reports`. NEVER auto-removes content (success-criterion-locked); admin always reviews. Banned-words system stores admin-editable rows in `banned_words (word, severity ∈ ('warn','flag','escalate'), case_insensitive)` with 60s Edge-Fn-cache TTL; AFTER trigger on the same content tables matches body via `ILIKE ANY (SELECT '%'||word||'%' FROM banned_words)` and queues into `community_reports` with severity-derived priority + admin email on `escalate`. Historical sweep is admin-triggered (re-runnable per success criterion #3) via cursored Edge Fn iterating content tables in batches of 100. Mute/ban state lives in dedicated `user_moderation_state (user_id PK, status ∈ ('active','muted','banned','temp_suspended'), applied_by, reason, expires_at)` — mute = silent-suspend (author sees own content; everyone else's feed quietly omits it via RLS predicate `author_id = auth.uid() OR is_staff() OR NOT exists(muted)`); ban = `supabase.auth.admin.signOut(user_id)` + RLS deny on all user-owned write surfaces (reads continue for GDPR portability); temp_suspended auto-restores via pg_cron sweep on `expires_at < now()`. Every moderation action (admin + automated) writes to `moderation_audit_log` mirroring Phase 25 D-07/D-08 `phi_access_log` immutability: INSERT-only via SECDEF RPC; REVOKE UPDATE+DELETE from all roles; 90d hot + Parquet cold per Phase 24 D-16. Cross-org isolation: platform admin (`is_staff()`) sees all reports; clinic-org admins see only reports targeting content in spaces where they're a member with role='admin'.

**Out of scope:** Self-serve user appeal flow; shadowbans (mute = silent-suspend already covers the use case); user reputation / trust scores; IP blocks / device fingerprinting; federated moderation (cross-clinic share); auto-removal at ANY confidence (success-criterion-locked NEVER auto-remove); admin-configurable Claude prompt templates (defer to v2 — admin-prompt-injection attack surface); pg_trgm fuzzy matching for banned-words (defer); banned-words bootstrap from static JSON (admin-editable table is source of truth); shared session-replay for muted/banned users (PostHog session-replay is already disabled on PHI URLs per Phase 25 D-16).

</domain>

<decisions>
## Implementation Decisions

### Reports Queue Extension + Cooldown + Admin Surface (Area 1)

- **D-01:** Triage workflow = **status enum widens to `('open','triaged','resolved','dismissed')`**; add columns `triaged_by uuid references auth.users(id)`, `triaged_at timestamptz`, `dismissed_reason text nullable`. Migration is ADD COLUMN + CHECK constraint widen (per memory `feedback_planner_missed_status_enum_widening` + Phase 47 D-19 precedent — widen VALID_CATEGORIES enum in same commit). RLS: staff write status; reporter reads own report status (notify reporter when their report transitions to resolved/dismissed via in-app indicator only — no email in v1). `open` = needs review; `triaged` = an admin claimed it (claim-locks via UPDATE … WHERE status='open' SECDEF RPC); `resolved` = action taken; `dismissed` = no action + reason.

- **D-02:** Duplicate-report cooldown = **partial UNIQUE index on `(reporter_user_id, target_type, target_id) WHERE status IN ('open','triaged')`**. Reporter can file ONE active report per content; re-file allowed after admin resolves/dismisses (preserves "I want to escalate this differently" UX). No time-based cooldown. Pair with SECDEF RPC `report_content(p_target_type, p_target_id, p_reason)` that inserts and surfaces a clean error message on UNIQUE violation ("You've already reported this; admin is reviewing").

- **D-03:** Admin moderation surface = **NEW `/admin/moderation` module, pathname-based** (NOT react-router per CORRECTED memory `reference_react_router_consumer_admin_split` — 2026-05-23 live audit confirmed zero react-router imports in `src/admin/`). Fork `src/admin/modules/community/CommunityAdminLayout.tsx` as the analog. Sub-views (resolveView returns):
  - `reports` (default) — Reports queue with filter by status / target_type / reporter / created_after.
  - `auto-flags` — Same queue filtered by `reporter='system'`.
  - `banned-words` — CRUD form for the banned_words table.
  - `bans` — User moderation state roster + apply mute/ban/temp_suspend form.
  - `audit-log` — Read-only moderation_audit_log viewer with filters.
  Each sub-view's URL prefix is `/admin/moderation/<sub>`; resolveView regex `^/admin/moderation/?([^/]+)?/?([^/]+)?` keyed to sub_view + optional id.

- **D-04:** Cross-org isolation = **platform admin sees all; clinic owner + support_admin see only their org's reports**. RLS predicate on community_reports SELECT: `public.is_staff() OR public.can_moderate_report_org(report_id)`. Helper SECDEF function `public.can_moderate_report_org(p_report_id uuid)` resolves the target's parent space → org_id and checks `org_members.role IN ('owner','support_admin')` for the calling user. **CORRECTED 2026-05-23 (researcher live-DB pre-check):** live `org_member_role` enum is `owner | clinician | staff | support_admin | support_lead` — there is NO `'admin'` value; using it would silently never match. `owner` + `support_admin` is the chosen moderation tier (clinicians focus on patient care; staff/support_lead are not granted mod authority by default). Phase 28 `org_members` is the source of truth.

### Auto-Flag Pipeline (Area 2)

- **D-05:** Auto-flag timing = **ASYNC via AFTER INSERT/UPDATE trigger → pg_net → `claude-moderation` Edge Fn**. Triggers on `community_posts`, `community_comments`, `direct_messages`. Trigger body fires `pg_net.http_post` (fire-and-forget) with `{ content_type, content_id, body, space_id }`. Edge Fn calls Claude with structured output, then writes a system-reporter row into `community_reports` if any category ≥0.7. User sees their post live immediately (good UX); admin queue catches asynchronously. Doesn't block on Claude latency (~2-5s). Per memory `reference_supabase_pg_cron_vault_service_role_pattern` — pg_net call uses vault.decrypted_secrets `service_role_key` + hardcoded Fn URL.

- **D-06:** Categories = **FIXED v1: `toxicity`, `spam`, `medical_misinformation`** (3 categories). Hardcoded enum in `claude-moderation` Edge Fn + Anthropic structured-output JSON schema:
  ```json
  {"toxicity": {"type": "number", "minimum": 0, "maximum": 1},
   "spam": {"type": "number", "minimum": 0, "maximum": 1},
   "medical_misinformation": {"type": "number", "minimum": 0, "maximum": 1},
   "rationale": {"type": "string"}}
  ```
  Admin-configurable categories deferred to v2 (admin-prompt-injection attack surface).

- **D-07:** Flag threshold + queue routing = **≥0.7 on ANY category → INSERT into community_reports with `reporter_user_id=NULL` + `reason jsonb = {source: 'claude_auto_flag', category, confidence, rationale}`**. NEVER auto-remove content even at 0.99 confidence (success criterion #4 lock). All flagged content goes to queue with `status='open'`. Admin reviews + decides. Per-category thresholds + admin-tunable thresholds deferred to v2.

- **D-08:** PHI / clinic-org content = **SKIP auto-flag for spaces where `community_spaces.org_id IS NOT NULL`**. Trigger WHEN clause: `WHEN (exists (select 1 from community_spaces s where s.id = NEW.space_id and s.org_id is null))` — fires only on global-space content. Clinic-private content avoids Anthropic data-sharing surface entirely (HIPAA-conservative; aligns with [[feedback_regulator_vs_user_audience_pattern]] — trim PHI surface aggressively). Clinic admin can still manually queue via report button (D-02 RPC works for any space). DM messages: trigger checks both sender + recipient — if EITHER user belongs to a clinic-private space with the other, treat as clinic-PHI and skip; OR just skip all DMs from auto-flag (cleaner — DMs are 1:1 private; high false-positive risk if Claude reads private health discussions). **Locked: DMs skip auto-flag uniformly in v1; only community_posts + community_comments in global spaces auto-flag.**

### Banned-Words System (Area 3)

- **D-09:** Banned-words storage = **`banned_words` table, admin-editable**. Schema:
  ```sql
  create table public.banned_words (
    id uuid primary key default gen_random_uuid(),
    word text not null,
    severity text not null check (severity in ('warn','flag','escalate')),
    case_insensitive boolean not null default true,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint banned_words_unique unique (lower(word))
  );
  ```
  RLS: staff write (insert/update/delete via SECDEF RPC `banned_word_upsert(p_word, p_severity)`); no public read. Edge Fn `claude-moderation` + trigger fn both load via SECDEF helper with 60s in-memory cache to avoid hot-path DB hit on every post.

- **D-10:** Matching = **Postgres AFTER INSERT/UPDATE trigger on community_posts / community_comments**. Trigger body:
  ```sql
  for r in select word, severity from public.banned_words loop
    if (case when r.case_insensitive then NEW.body ilike '%'||r.word||'%' else NEW.body like '%'||r.word||'%' end) then
      insert into public.community_reports (target_type, target_id, reporter_user_id, reason, status)
      values (TG_TABLE_NAME-derived, NEW.id, NULL, jsonb_build_object('source','banned_word','word',r.word,'severity',r.severity), 'open');
      if r.severity = 'escalate' then
        perform net.http_post(...); -- fire email-router send to staff opted into 'banned_word_escalate' notification category
      end if;
    end if;
  end loop;
  ```
  Runs in same txn as the content INSERT — atomic. ~1ms for 1000 banned words. NOT applied to direct_messages (consistent with D-08 — DMs skip auto-flag uniformly). pg_trgm fuzzy matching deferred.

- **D-11:** Historical sweep = **admin-triggered `Re-run sweep` button + cursored Edge Fn**. New Edge Fn `banned-words-sweep` accepts `{ start_cursor: uuid | null, batch_size: 100 }`; reads banned_words ONCE at start; iterates `community_posts` + `community_comments` in batches of 100 with `WHERE id > last_seen_id ORDER BY id LIMIT 100`; matches each row body against the cached banned_words list; INSERTs new system-reporter rows into community_reports for any match NOT already represented (idempotent via partial UNIQUE on `(target_type, target_id) WHERE reason->>'source'='banned_word'`). Progress streamed back via SSE or returns `next_cursor` for client-driven re-invoke. Admin sees progress bar in `/admin/moderation/banned-words`. Runs on add-new-word (admin sweeps automatically) or on-demand. NOT cron-driven (per success criterion #3 "re-runnable across historical content" — admin-triggered semantics clearer).

- **D-12:** Severity = **3 levels (`warn`, `flag`, `escalate`)**. `warn` annotates the report row with lower priority sort (admin can mass-dismiss); `flag` is default (queue + system report); `escalate` adds an immediate email-router send to `notification_settings.category='banned_word_escalate'`-opted-in staff. Lets admin tune fluffy slurs vs explicit threats. Widen `notification_settings.VALID_CATEGORIES` CHECK with new entry `banned_word_escalate` in the same Wave 0 migration that ships the banned_words table (mirrors Phase 47 D-19 widening pattern).

### Mute/Ban + Audit Log + Cross-Org (Area 4)

- **D-13:** Mute/ban state = **dedicated `user_moderation_state` table**. Schema:
  ```sql
  create table public.user_moderation_state (
    user_id uuid primary key references auth.users(id) on delete cascade,
    status text not null check (status in ('active','muted','banned','temp_suspended')),
    applied_by uuid not null references auth.users(id),
    reason text,
    expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint user_moderation_expires_chk check (
      (status = 'temp_suspended' and expires_at is not null) or
      (status <> 'temp_suspended' and expires_at is null)
    )
  );
  ```
  RLS: staff write via SECDEF RPC; user reads OWN row only. Default = no row (= status='active' implicit). One row per user (PK).

- **D-14:** Mute mechanic = **author's content hidden from everyone except themselves + staff** (silent-suspend). RLS predicate widens on `community_posts` / `community_comments` / `community_reactions` (+ leaderboard matview JOIN) SELECT:
  ```sql
  using (author_id = auth.uid() OR public.is_staff() OR NOT exists(
    select 1 from public.user_moderation_state ums
    where ums.user_id = community_posts.author_id and ums.status = 'muted'
  ))
  ```
  Author SEES their own posts (no awareness they're muted — the "silent" part). Everyone else's feed quietly omits the row. Mentions notifications fire normally to muted user but the mentioning user doesn't see reply (consistent silent-suspend semantics). Reactions are also hidden (matview excludes muted-author rows on refresh).

- **D-15:** Ban enforcement = **direct service-role SQL DELETE on `auth.sessions` + `auth.refresh_tokens` + RLS deny on user-owned writes**. **CORRECTED 2026-05-23 (researcher live-DB):** `supabase.auth.admin.signOut(JWT)` takes a JWT, NOT a user_id, so it's unusable for "revoke all sessions for this user" from an admin context. Live spike (orchestrator 2026-05-23) confirmed service-role can DML `auth.sessions` (returns no rows on dummy uuid, no permission error). On `user_moderation_state.status='banned'` INSERT/UPDATE, AFTER trigger calls `pg_net.http_post` to a new `ban-enforcement` Edge Fn which:
  1. Executes `DELETE FROM auth.sessions WHERE user_id = $1; DELETE FROM auth.refresh_tokens WHERE user_id = $1;` via service-role client. All active sessions invalidated; user must re-login.
  2. Writes a row to `moderation_audit_log` with action='session_revoked'.
  RLS on all user-content INSERT/UPDATE/DELETE policies widens with `NOT exists(user_moderation_state where user_id=auth.uid() AND status='banned')`. Reads continue (GDPR portability — banned user can still export their own data). User attempt to log back in via Supabase Auth still succeeds, but the SPA sees `user_moderation_state.status='banned'` and renders an `<AccountSuspended />` blocker route at the App.tsx switch level.

  Temp_suspended: same RLS deny on writes, but auto-restores via pg_cron `temp-suspended-restore-hourly` job at `0 * * * *` that UPDATEs `status='active'` + sets `expires_at=null` where `expires_at < now()`. Cron also signs the user out (so the suspended UX is replaced cleanly on next login). One-line pg_cron job; mirror Phase 38 cron structure with `$cron$` + `$restore$` dollar-quote tags per memory `reference_postgres_dollar_quote_nesting_in_cron_body`.

- **D-16:** `moderation_audit_log` = **mirror Phase 25 D-07/D-08 `phi_access_log` immutability + retention pattern**. Schema:
  ```sql
  create table public.moderation_audit_log (
    id bigserial primary key,
    actor_id uuid references auth.users(id),  -- nullable for system actions
    action_type text not null,  -- e.g. 'report_filed', 'report_triaged', 'mute_applied', 'ban_applied', 'auto_flag', 'banned_word_match', 'session_revoked'
    target_type text not null check (target_type in ('post','comment','dm_message','profile','user','space','banned_word')),
    target_id uuid,
    before_state jsonb,
    after_state jsonb,
    reason text,
    created_at timestamptz not null default now()
  );
  alter table public.moderation_audit_log enable row level security;
  -- INSERT-only via SECDEF RPC log_moderation_action(...).
  create policy mod_audit_select_staff on public.moderation_audit_log
    for select to authenticated using (public.is_staff());
  -- NO insert/update/delete policies for authenticated; only the SECDEF RPC writes.
  revoke insert, update, delete on public.moderation_audit_log from authenticated, anon, service_role;
  -- Service-role + SECDEF RPC together provide the only write path.
  ```
  All moderation actions (admin + automated) write via SECDEF RPC `log_moderation_action(p_action_type, p_target_type, p_target_id, p_before, p_after, p_reason)`. Triggers + Edge Fns + admin RPCs all funnel through it.

  Retention: 90d hot + Parquet cold forever (Phase 24 D-16 + `audit-archive` Edge Fn already extends to phi_access_log; widen to include moderation_audit_log).

### Claude's Discretion

- Exact Anthropic model for moderation: `claude-haiku-4-5-20251001` (cheapest; structured output sufficient) — researcher confirms via Context7.
- Claude moderation Edge Fn batching: single-content-per-call v1 (each trigger = 1 call). Defer batch mode.
- Banned-words ILIKE performance at >5000 words: researcher confirms with EXPLAIN; if slow, add pg_trgm GIN index as v2 optimization (currently deferred).
- DM auto-flag policy is "skip entirely v1 per D-08" — researcher should NOT plan a DM auto-flag path. Banned-words ALSO skips DMs (D-10).
- Mute mechanic on DM messages: `direct_messages` RLS predicate also widens — muted user sending DMs can still see the conversation appear sent (silent), but recipient never sees the message. Edge case: muted user's existing message threads continue to render historically; only new messages get the silent treatment.
- Cron expression for temp_suspended restore: `0 * * * *` (hourly). Per-minute precision deferred (operator can manually call the restore Fn for early-release if needed).
- HMAC orchestrator-auth for `banned-words-sweep` + `ban-enforcement` Edge Fns: reuse Phase 38 winback pattern (per memory `reference_supabase_service_role_key_format_divergence`).
- TabId widening: NO consumer-side TabId change — Phase 48 is admin-only UI. Consumer report buttons already exist (Phase 45 D-11).
- Bundle ceiling: new `admin-moderation` chunk ≤30 kB gz (matches CommunityAdminLayout precedent).
- The `community_reports.status` enum widening pre-check: live-DB `npx supabase db query --linked "select column_name, character_maximum_length from information_schema.columns where table_schema='public' and table_name='community_reports'"` to confirm the current shape before writing the ALTER TABLE migration (per memory `feedback_live_db_precheck_inverts_research_grep`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 48 Source-of-Truth

- `.planning/ROADMAP.md` §Phase 48 — Goal, dependencies, success criteria, requirements binding
- `.planning/REQUIREMENTS.md` §MOD-01..05 — Requirement-by-requirement scope

### Upstream Locks (cross-phase contracts that constrain this phase)

- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` D-03 (email-router phi flag), D-07/D-08 (phi_access_log INSERT-only + retention pattern — D-16 mirrors), D-14 (dual-credential Anthropic — consumer vs clinical).
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-posthog/24-CONTEXT.md` — `audit_logs` schema + retention (90d hot + Parquet cold; D-16 applies); modular admin shell manifest (new `/admin/moderation` module manifest entry per memory `feedback_admin_module_manifest_vs_router_branch_drift`); bundle-budget gate (admin-moderation chunk ≤30 kB gz).
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/` — `org_members` schema (D-04 cross-org isolation predicate joins this).
- `.planning/phases/38-m5b-ai-recommender-pgvector-claude-digest/38-CONTEXT.md` — Anthropic Edge Fn HMAC orchestrator-auth pattern (claude-moderation reuses); structured-output JSON schema invocation; per-user-TZ pg_cron pattern (temp_suspended restore cron mirrors).
- `.planning/phases/44-m4-community-feed-foundation/44-CONTEXT.md` — `community_posts` + `community_comments` schemas (trigger targets); `community_spaces.org_id` (D-08 PHI gate predicate); RLS predicate shapes.
- `.planning/phases/45-m4-community-spaces-member-directory-opt-in-dms-leaderboard/45-CONTEXT.md` D-11 — `community_reports` table EXISTS; Phase 48 EXTENDS (D-01 status enum widening + triage columns). `direct_messages` schema (D-08/D-10 SKIPS DMs from auto-flag + banned-words v1).
- `.planning/phases/47-m4-events-calendar-zoom-reminders-recording/47-CONTEXT.md` D-19 — notification_settings VALID_CATEGORIES widening pattern (D-12 mirrors for `banned_word_escalate`).

### Live Schema Refs (verified 2026-05-23 via Phase 45 migration)

- `supabase/migrations/<phase-45-ts>_p45_community_reports.sql` — `community_reports` exists with status text default 'open'. Phase 48 ALTERs to widen CHECK + add columns (per memory `feedback_planner_silent_scope_reduction_patterns` — confirm migration timestamp ordering at plan-time).
- `supabase/migrations/<phase-25-ts>_phi_access_log.sql` — INSERT-only RLS + REVOKE pattern. D-16 copies verbatim.
- `supabase/migrations/<phase-38-ts>*_phase38_pg_cron_schedules.sql` — cron job template (dollar-quote tags `$cron$` + unique inner tag — use `$restore$` for temp_suspended cron; do NOT collide with Phase 47's `$reminders$`).
- `supabase/migrations/<phase-47-ts>_p47_notification_settings_widen.sql` (planned) — VALID_CATEGORIES CHECK widening template (D-12 mirror).

### Shared Infrastructure (re-use, don't re-invent)

- `supabase/functions/_shared/email-router.ts` (Phase 25) — REQUIRED for D-12 escalate emails + any moderator notifications. Set `phi:false` for moderation emails (moderation actions on clinic content are admin-to-admin, not patient-facing).
- `supabase/functions/_shared/lifecycle-utils.ts` — `checkServiceRoleBearer`, `constantTimeEqual` for `claude-moderation` + `banned-words-sweep` + `ban-enforcement` Edge Fn auth.
- `supabase/functions/audit-archive/` (Phase 24) — widen Parquet cold archive to include moderation_audit_log per D-16.
- Phase 25 Anthropic dual-credential router — consumer credential for D-05 claude-moderation calls (clinic content skipped per D-08).
- Phase 24 admin shell module manifest — register new `/admin/moderation` entry (per memory `feedback_admin_module_manifest_vs_router_branch_drift` — manifest URL prefix branch in router fallthrough).
- `src/admin/modules/community/CommunityAdminLayout.tsx` (Phase 44) — fork as `src/admin/modules/moderation/ModerationLayout.tsx` for D-03 pathname-based admin module.
- `public.is_staff()` SECDEF helper (Phase 44) — D-03 + D-04 + RLS predicates.
- Phase 38 cron HTTP-invoke + vault.decrypted_secrets pattern (`reference_supabase_pg_cron_vault_service_role_pattern`).

### External Library Refs (for researcher's Context7 sweep)

- **Anthropic Messages API + structured output (`output_config.format.json_schema`)** — claude-moderation invocation shape; pin `claude-haiku-4-5-20251001` per [[reference_anthropic_model_id_hyphenated_format]] (NEVER dotted `4.5`).
- **Supabase Auth Admin API `auth.admin.signOut(user_id)`** — D-15 ban enforcement; researcher confirms exact method name + return shape on supabase-js v2 (could be `auth.admin.signOut(user_id, { scope: 'global' })` to revoke all sessions).
- **pg_trgm extension** — researcher confirms install status (probably enabled from Phase 49 Search prep); D-10 v2 optimization path documented but NOT shipped v1.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 45 community_reports** — Phase 48 extends (no re-create); ALTER TABLE adds status enum values + triaged_by + triaged_at + dismissed_reason columns. Migration timestamp must land AFTER all Phase 45 migrations (planner verifies at plan-time via grep).
- **Phase 25 phi_access_log immutability** — D-16 mirrors verbatim: INSERT-only via SECDEF, REVOKE all other DML, retention via audit-archive Fn.
- **Phase 25 Anthropic dual-credential router** — D-05 claude-moderation uses consumer credential; clinic content skipped per D-08 (no clinical-cred path needed in Phase 48).
- **Phase 38 cron template** — temp_suspended restore + (optional future) auto-flag re-process cron mirror.
- **Phase 24 audit-archive Edge Fn** — widen to include moderation_audit_log in 90d→cold pipeline.
- **public.is_staff() SECDEF** — D-03 admin gate + D-04 cross-org override.
- **`src/admin/modules/community/CommunityAdminLayout.tsx`** — fork analog for D-03 `/admin/moderation` module (pathname-based, NOT react-router per CORRECTED memory).

### Established Patterns

- **SECDEF RPC + partial UNIQUE index** for cooldown (D-02) — Phase 35 freeze-token + Phase 47 D-19 precedent.
- **AFTER trigger → pg_net → Edge Fn** (D-05 async auto-flag) — Phase 24 events_mirror + Phase 38 winback fire-and-forget precedent.
- **AFTER trigger ILIKE ANY for banned-words match** (D-10) — direct SQL match in trigger; ~1ms for 1000 words; bigger lists migrate to pg_trgm v2.
- **`pg_net.http_post` from trigger with vault.decrypted_secrets bearer** (per memory `reference_supabase_pg_cron_vault_service_role_pattern`).
- **Dollar-quote tag nesting** (per memory `reference_postgres_dollar_quote_nesting_in_cron_body`) — outer `$cron$` + inner `$restore$` for temp_suspended cron (do NOT collide with Phase 38 `$digest$` or Phase 47 `$reminders$`).
- **Admin module manifest** (per memory `feedback_admin_module_manifest_vs_router_branch_drift`) — register `/admin/moderation` URL prefix in router fallthrough so it doesn't fall through to the default Phase 24 admin landing.
- **Bundle ceiling** — new `admin-moderation` chunk ≤30 kB gz; vite.config.ts manualChunks rule inserted AFTER `community-feed` and BEFORE `community-admin` rules.
- **Live-DB pre-check before ALTER TABLE** (per memory `feedback_live_db_precheck_inverts_research_grep`) — confirm community_reports current shape via `supabase db query --linked` at plan-time.
- **CHECK constraint widening** (per memory `feedback_planner_missed_status_enum_widening` + Phase 47 D-19) — community_reports.status CHECK widens in same Wave 0 migration as triage column ADD; notification_settings.VALID_CATEGORIES widens with `banned_word_escalate` in same migration as banned_words table.

### Integration Points

- **`claude-moderation` Edge Fn** — net-new; HMAC orchestrator-auth; consumer Anthropic credential; Anthropic structured-output JSON schema; writes system-reporter row into community_reports on flag.
- **`banned-words-sweep` Edge Fn** — net-new; cursored iteration over content tables; idempotent INSERTs (partial UNIQUE on community_reports for source='banned_word' to dedup).
- **`ban-enforcement` Edge Fn** — net-new; triggered by user_moderation_state AFTER trigger via pg_net; calls Supabase Auth Admin signOut + writes audit row.
- **`temp-suspended-restore-hourly` pg_cron** — hourly job; direct SQL UPDATE; mirrors Phase 38 cron block shape.
- **Admin Moderation Editor** — new admin module under `src/admin/modules/moderation/` following Phase 44/47 admin shell pattern + pathname-based switching (NOT react-router). New pathname prefix `/admin/moderation/`.
- **Moderation RLS predicate library** — new `src/lib/moderation/rls-predicates.ts` documenting the muted-content-hide RLS predicate so future content-table RLS edits don't break the invariant.

### Bundle Routing

- `admin-moderation` chunk via `vite.config.ts` manualChunks rule (~30 kB gz target). Strictly admin UI + RPC client; no consumer-side imports.
- NO new consumer chunk — Phase 45 already shipped report buttons. Phase 48 doesn't widen consumer surface.

</code_context>

<specifics>
## Specific Ideas

- Skool's mod-queue UX as reference: list view with reporter avatar + content preview + reason chip + claim button.
- "Triaged by [admin]" badge prevents double-claim races during multi-admin shifts.
- Banned-words editor: simple textarea-of-rows-per-word + severity dropdown + bulk paste from CSV.
- Audit log viewer: filter by actor / action_type / target_type / created_after; CSV export.
- Ban UX: when banned user logs in, render `<AccountSuspended />` page with appeal email contact (no in-app appeal flow — appeals go to support@leanshot.app).

</specifics>

<deferred>
## Deferred Ideas

- **Self-serve appeal flow** — appeals go to support@leanshot.app in v1; in-app appeal form deferred.
- **Shadowbans** — mute = silent-suspend already covers (D-14); explicit shadowban deferred (no clear use case beyond mute).
- **User reputation / trust scores** — defer; would require behavior-score table + decay model.
- **IP blocks / device fingerprinting** — defer to v2 if abuse vectors emerge.
- **Federated moderation** — cross-clinic share of bans/banned-words; defer to v2.
- **Auto-removal at any confidence** — success-criterion-locked NEVER auto-remove (D-07); reject any future plan that proposes this.
- **Admin-configurable Claude prompt templates** — admin-prompt-injection attack surface; defer.
- **pg_trgm fuzzy matching for banned-words** — D-10 ILIKE sufficient for ~1000 words; defer optimization.
- **Banned-words bootstrap from static JSON** — table is source of truth (D-09); no JSON bootstrap.
- **DM auto-flag + DM banned-words** — DMs skip uniformly per D-08/D-10; defer until specific abuse vector emerges.
- **Per-category Claude moderation thresholds + admin-tunable** — fixed 0.7 v1 (D-07).
- **Claude moderation batching** (multiple posts per call) — single-call v1 (D-claude-discretion).
- **Per-minute cron precision on temp_suspended restore** — hourly v1 sufficient.
- **PostHog session-replay for muted/banned users** — already disabled via Phase 25 D-16 on PHI URLs; no new session-replay config needed for v1.
- **In-app user notification when their report is resolved/dismissed** — defer; admin dismissal note visible in user's "My reports" list (out of scope for v1) or via email later.
- **Anthropic Enterprise + clinical creds for auto-flag** — D-08 currently skips clinic content; if clinic moderation volume justifies, swap in clinical creds + enable v2.

</deferred>

---

*Phase: 48-M4 Moderation*
*Context gathered: 2026-05-23*
