-- Phase 45 Plan 01 — Schema foundation: profile column additions + 5 new tables
-- + community_spaces.leaderboard_enabled + handle UNIQUE partial index + CHECK.
--
-- Decisions implemented:
--   D-02   — Two-mode directory visibility — schema half (RLS in 20270727000002)
--   D-04   — handle-prefix search support (case-insensitive UNIQUE index on lower(handle))
--   D-05   — bio rendering server-side: CHECK char_length(bio) <= 500
--   D-09   — DM attachments: 5 MB cap, MIME-restricted (bucket in 20270727000004 plan 45-03)
--   D-10   — Symmetric block via user_block_list (RLS predicate in 20270727000002)
--   D-11   — community_reports write-only consumer; staff read via digest (RLS in 20270727000002)
--   D-14   — community_spaces.leaderboard_enabled boolean (admin gate per space)
--   D-16   — leaderboard_handle + leaderboard_opt_in ON PROFILES (NOT per-cohort like Phase 35)
--   Fix-D  — handle + display_name are NET-NEW; live-DB pre-check 2026-05-23 confirms absence
--            (12 existing columns only: account_state, admin_role, completed_onboarding_at,
--             created_at, has_totp, id, is_staff, locale, primary_goal, primary_org_id, tags,
--             timezone). Bare ADD COLUMN is correct for genuinely net-new columns.
--   D-18   — DM Realtime inbox per-user channel (filter on direct_messages.recipient_user_id)
--
-- Per memory reference_supabase_migration_filename_regex:
--   14-digit timestamp + underscore + lower_snake name. No letter suffix.
--
-- Per memory reference_supabase_migration_gotchas:
--   - Partial-index expressions must be IMMUTABLE — lower(handle) IS NULL clause both qualify.
--   - SECURITY DEFINER funcs go in 20270727000003 (not this file).
--
-- Per memory reference_profiles_email_vs_auth_users_email:
--   profiles has NO email column; we do NOT add one. Phase 48 admin RPCs already JOIN auth.users.
--
-- Per memory reference_postgres_no_insert_on_conflict_do_delete:
--   Toggle semantics live in SECDEF RPC (20270727000003), NOT here.
--
-- Per memory feedback_negation_grep_defeated_by_comment_string:
--   Rejected alternatives (e.g. staff_users) are intentionally NOT named here.

begin;

-- ============================================================
-- profiles — 13 net-new columns (11 idempotent + 2 bare net-new)
-- ============================================================

-- 11 idempotent ALTER ADD COLUMN IF NOT EXISTS — the existing-pattern columns.
-- These use IF NOT EXISTS because the planner pattern reuses common defensive
-- shape for profile additions across phases; harmless if a prior migration
-- already added one (e.g. directory_opt_in could land via a hotfix).
alter table public.profiles
  ADD COLUMN IF NOT EXISTS directory_opt_in           boolean     not null default false,
  ADD COLUMN IF NOT EXISTS dm_open                    boolean     not null default true,
  ADD COLUMN IF NOT EXISTS is_clinician_verified      boolean     not null default false,
  ADD COLUMN IF NOT EXISTS show_tier_badge            boolean     not null default true,
  ADD COLUMN IF NOT EXISTS show_streak_badge          boolean     not null default true,
  ADD COLUMN IF NOT EXISTS bio                        text
                             constraint profiles_bio_len_chk
                             check (bio is null or char_length(bio) <= 500),
  ADD COLUMN IF NOT EXISTS links                      jsonb       not null default '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS admin_digest_opt_in        boolean     not null default false,
  ADD COLUMN IF NOT EXISTS community_last_active_at   timestamptz,
  ADD COLUMN IF NOT EXISTS leaderboard_handle         text
                             constraint profiles_leaderboard_handle_format
                             check (leaderboard_handle is null or leaderboard_handle ~ '^[a-zA-Z0-9_-]{6,24}$'),
  ADD COLUMN IF NOT EXISTS leaderboard_opt_in         boolean     not null default false;

comment on column public.profiles.directory_opt_in is
  'P45 D-02 — opt-in for community member directory listing; default false (privacy-default).';
comment on column public.profiles.dm_open is
  'P45 D-10 — accepts new DM threads; default true. Verified clinicians can bypass (audit row written).';
comment on column public.profiles.is_clinician_verified is
  'P45 — staff-toggled badge via admin_set_clinician_verified RPC; grants DM rate-limit bypass.';
comment on column public.profiles.leaderboard_handle is
  'P45 D-16 — global per-profile leaderboard handle (replaces per-cohort handle in Phase 35 leaderboard_optin).';
comment on column public.profiles.leaderboard_opt_in is
  'P45 D-16 — global per-profile leaderboard opt-in (privacy-default false).';

-- Fix-D: 2 BARE net-new ADD COLUMN for handle + display_name.
-- Live-DB pre-check 2026-05-23 confirmed these columns DO NOT EXIST on
-- public.profiles. Bare ADD COLUMN is the clean schema form for net-new columns
-- (per memory feedback_live_db_precheck_inverts_research_grep — net-new bare
-- ADD COLUMN is often correct; idempotent guard is unnecessary defensive code).
alter table public.profiles ADD COLUMN handle text;
alter table public.profiles ADD COLUMN display_name text;

comment on column public.profiles.handle is
  'P45 Fix-D — globally-unique mention handle. NET-NEW (live-DB pre-check 2026-05-23). '
  'Format: ^[a-z0-9_]{3,30}$ (matches Phase 44 mention regex). '
  'Uniqueness enforced by profiles_handle_unique partial UNIQUE index on lower(handle) WHERE handle IS NOT NULL.';
comment on column public.profiles.display_name is
  'P45 Fix-D — display name shown alongside @handle in directory + DM views. NET-NEW.';

-- handle CHECK constraint (allows null during transition; format matches Phase 44 mention regex).
alter table public.profiles
  add constraint profiles_handle_format
    check (handle is null or handle ~ '^[a-z0-9_]{3,30}$');

-- Case-insensitive UNIQUE partial index — allows nulls during transition;
-- enforces global uniqueness on case-folded handles. Both lower(text) and
-- IS NOT NULL are IMMUTABLE expressions (per reference_supabase_migration_gotchas).
create unique index if not exists profiles_handle_unique
  on public.profiles (lower(handle))
  where handle is not null;

-- ============================================================
-- community_spaces.leaderboard_enabled (D-14)
-- ============================================================

alter table public.community_spaces
  ADD COLUMN IF NOT EXISTS leaderboard_enabled boolean not null default false;

comment on column public.community_spaces.leaderboard_enabled is
  'P45 D-14 — admin per-space toggle. Matview includes only rows where this is true. Default false.';

-- ============================================================
-- dm_threads — 1:1 DM thread between two users
-- ============================================================

create table if not exists public.dm_threads (
  id                  uuid        primary key default gen_random_uuid(),
  creator_user_id     uuid        not null references public.profiles(id) on delete cascade,
  recipient_user_id   uuid        not null references public.profiles(id) on delete cascade,
  last_message_at     timestamptz,
  created_at          timestamptz not null default now(),
  -- Prevent duplicate creator→recipient threads. Directional (B→A creates a
  -- separate thread from A→B in v1; UI surfaces the most-recent thread per
  -- counterparty). Future consolidation can be done via a canonical
  -- least(a,b)/greatest(a,b) UNIQUE pair migration.
  constraint dm_threads_creator_recipient_unique
    unique (creator_user_id, recipient_user_id),
  -- Cannot DM yourself.
  constraint dm_threads_no_self_dm_chk
    check (creator_user_id <> recipient_user_id)
);

comment on table public.dm_threads is
  'P45 D-10 — 1:1 opt-in DM thread. INSERT gated by RLS symmetric-block + dm_open + creator=auth.uid().';

-- Inbox query: list recipient threads sorted by recency.
create index if not exists idx_dm_threads_recipient_last_msg
  on public.dm_threads (recipient_user_id, last_message_at desc);

-- Rate-limit count: thread-creation rate per creator over rolling window.
create index if not exists idx_dm_threads_creator_created
  on public.dm_threads (creator_user_id, created_at);

-- ============================================================
-- direct_messages — Individual DM messages within a thread
-- ============================================================

create table if not exists public.direct_messages (
  id                uuid        primary key default gen_random_uuid(),
  thread_id         uuid        not null references public.dm_threads(id) on delete cascade,
  sender_user_id    uuid        not null references public.profiles(id) on delete cascade,
  body              text        not null
                      constraint direct_messages_body_len_chk
                      check (char_length(body) <= 2000),
  -- Single optional attachment per message. Path is relative to the
  -- dm-attachments bucket (shipped by plan 45-03). Bucket RLS enforces
  -- per-thread access via JOIN dm_threads (per RESEARCH Pattern 5).
  attachment_path   text,
  created_at        timestamptz not null default now()
);

comment on table public.direct_messages is
  'P45 D-09 — DM message body. ≤2000 chars; optional attachment via dm-attachments bucket.';
comment on column public.direct_messages.attachment_path is
  'P45 D-09 — path within dm-attachments bucket (format: <thread_id>/<message_id>/<filename>). '
  'Bucket policy uses JOIN dm_threads to enforce per-thread access.';

create index if not exists idx_direct_messages_thread_created
  on public.direct_messages (thread_id, created_at);

-- ============================================================
-- dm_thread_audit — Audit trail for verified-clinician rate-limit bypass
-- ============================================================

create table if not exists public.dm_thread_audit (
  id              uuid        primary key default gen_random_uuid(),
  thread_id       uuid        not null references public.dm_threads(id) on delete cascade,
  actor_user_id   uuid        not null references public.profiles(id) on delete cascade,
  reason          text        not null
                    constraint dm_thread_audit_reason_chk
                    check (reason in ('clinician_bypass')),
  created_at      timestamptz not null default now()
);

comment on table public.dm_thread_audit is
  'P45 — append-only audit row written when verified-clinician bypasses normal DM rate-limit. '
  'RLS: staff-only SELECT via public.is_staff(); INSERT restricted to service-role (no authenticated policy).';

-- ============================================================
-- user_block_list — Symmetric block list (per D-10)
-- ============================================================

create table if not exists public.user_block_list (
  blocker_user_id   uuid        not null references public.profiles(id) on delete cascade,
  blocked_user_id   uuid        not null references public.profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  -- Cannot block yourself.
  constraint user_block_list_no_self_block_chk
    check (blocker_user_id <> blocked_user_id)
);

comment on table public.user_block_list is
  'P45 D-10 — symmetric block (RLS dm_threads INSERT predicate checks NOT EXISTS where '
  'blocker=recipient AND blocked=creator).';

-- Inverse lookup for symmetric block check: did THIS user block ME?
create index if not exists idx_user_block_list_blocked
  on public.user_block_list (blocked_user_id, blocker_user_id);

-- ============================================================
-- community_reports — Write-only consumer report queue (D-11)
-- ============================================================

create table if not exists public.community_reports (
  id                uuid        primary key default gen_random_uuid(),
  reporter_user_id  uuid        not null references public.profiles(id) on delete cascade,
  target_type       text        not null
                      constraint community_reports_target_type_chk
                      check (target_type in ('post','comment','dm_message','profile')),
  -- Polymorphic FK: no DB-level constraint; enforced application-side.
  -- Phase 48 moderation queue consumes via per-type queries.
  target_id         uuid        not null,
  reason            text        not null,
  status            text        not null default 'open'
                      constraint community_reports_status_chk
                      check (status in ('open')),
  created_at        timestamptz not null default now()
);

comment on table public.community_reports is
  'P45 D-11 — consumer-facing write-only report queue. Staff read via daily digest Edge Fn (plan 45-05). '
  'Phase 48 widens status CHECK to (open,triaged,resolved,dismissed) — that lives in 20270901000001.';
comment on column public.community_reports.target_id is
  'P45 D-11 — Polymorphic FK; no DB constraint. Application-side enforcement. Phase 48 moderation queue consumes.';
comment on column public.community_reports.status is
  'P45 D-11 — initial CHECK accepts only (open). Phase 48 plan 48-01 widens to triage workflow.';

-- Digest query: count of open reports per target_type for daily admin email.
create index if not exists idx_community_reports_status_target_type
  on public.community_reports (status, target_type);

commit;
