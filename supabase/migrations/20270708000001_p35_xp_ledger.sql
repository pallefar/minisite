-- Phase 35 D-04, D-05, D-09, GAME-01, GAME-09
-- Append-only XP ledger + badge_unlocks tables with negative-space RLS.
-- Pattern: supabase/migrations/20260601000001_audit_logs.sql (Phase 7 D-04).
-- Defense-in-depth append-only triggers mirror landing_page_revisions_append_only.sql.
-- Named dollar-quote tags ($body$) per reference_postgres_dollar_quote_nesting_in_cron_body.

-- ============================================================
-- TABLE: public.xp_ledger
-- ============================================================

create table if not exists public.xp_ledger (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        references auth.users(id) on delete set null,
  -- NOT cascade — rows survive account deletion per Phase 7 D-03
  action_type   text        not null check (
    action_type in (
      'injection_log',
      'weight_log',
      'symptom_log',
      'workout_log',
      'streak_day2',
      'streak_weekly_milestone',
      'challenge_complete',
      'monthly_milestone',
      'admin_adjustment',
      'combo_unlock'
    )
  ),
  -- D-01: per-action XP values; signed int allows admin_adjustment corrections
  xp_delta      int         not null check (xp_delta <> 0),
  source_ref    text,       -- nullable; e.g. 'injections:<uuid>' for traceability
  cycle_id      text,       -- nullable; D-09 idempotency e.g. 'streak:weekly:2026-W21'
  created_at    timestamptz not null default now()
);

-- D-09: Anti-spam: prevent double-grant for streak/monthly/challenge cycles
create unique index if not exists idx_xp_ledger_cycle_dedup
  on public.xp_ledger (user_id, action_type, cycle_id)
  where cycle_id is not null;

-- Rolling-7d leaderboard JOIN (Plan 35-04 reads here)
create index if not exists idx_xp_ledger_user_created
  on public.xp_ledger (user_id, created_at desc);

-- SUM(xp_delta) total-XP queries (INCLUDE avoids heap fetch)
create index if not exists idx_xp_ledger_user_delta
  on public.xp_ledger (user_id) include (xp_delta);

-- ============================================================
-- RLS: xp_ledger — negative-space append-only pattern
-- NO INSERT / UPDATE / DELETE policy for `authenticated`.
-- Denial-by-default IS the append-only enforcement.
-- ============================================================

alter table public.xp_ledger enable row level security;

-- Select own rows only
create policy "xp_ledger_select_own"
  on public.xp_ledger
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Explicit service_role insert (grep-able intent; service_role bypasses RLS but
-- shipping the policy makes the threat model legible in code — Phase 19 pattern)
create policy "xp_ledger_service_insert"
  on public.xp_ledger
  for insert
  to service_role
  with check (true);

-- NO UPDATE policy. NO DELETE policy. NO INSERT policy for `authenticated`.

-- ============================================================
-- DEFENSE-IN-DEPTH: append-only triggers for xp_ledger
-- Even a forgotten service_role grant cannot UPDATE/DELETE rows.
-- Named tag $body$ per project convention.
-- ============================================================

create or replace function public._p35_xp_ledger_block_update()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $body$
begin
  raise exception 'xp_ledger is append-only';
end;
$body$;

create or replace function public._p35_xp_ledger_block_delete()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $body$
begin
  raise exception 'xp_ledger is append-only';
end;
$body$;

create trigger xp_ledger_block_update
  before update on public.xp_ledger
  for each row execute function public._p35_xp_ledger_block_update();

create trigger xp_ledger_block_delete
  before delete on public.xp_ledger
  for each row execute function public._p35_xp_ledger_block_delete();

-- ============================================================
-- TABLE: public.badge_unlocks
-- ============================================================

create table if not exists public.badge_unlocks (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        references auth.users(id) on delete set null,
  -- on delete set null — rows survive account deletion per Phase 7 D-03
  badge_id      text        not null,
  -- FK to badge_catalog.id added in 20270708000003_p35_badge_catalog_seed.sql
  -- (badge_catalog table does not exist yet; FK added after table creation)
  unlocked_at   timestamptz not null default now(),
  source        text        not null check (
    source in ('level', 'streak', 'challenge', 'combo', 'admin')
  ),
  source_ref    text        -- e.g. 'challenge:<uuid>' or 'level:5'
);

-- A badge unlocks at most once per user
create unique index if not exists idx_badge_unlocks_user_badge
  on public.badge_unlocks (user_id, badge_id);

-- ============================================================
-- RLS: badge_unlocks — same negative-space append-only pattern
-- ============================================================

alter table public.badge_unlocks enable row level security;

create policy "badge_unlocks_select_own"
  on public.badge_unlocks
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "badge_unlocks_service_insert"
  on public.badge_unlocks
  for insert
  to service_role
  with check (true);

-- NO UPDATE / DELETE policy for any role.

-- ============================================================
-- DEFENSE-IN-DEPTH: append-only triggers for badge_unlocks
-- ============================================================

create or replace function public._p35_badge_unlocks_block_update()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $body$
begin
  raise exception 'xp_ledger is append-only';
end;
$body$;

create or replace function public._p35_badge_unlocks_block_delete()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $body$
begin
  raise exception 'xp_ledger is append-only';
end;
$body$;

create trigger badge_unlocks_block_update
  before update on public.badge_unlocks
  for each row execute function public._p35_badge_unlocks_block_update();

create trigger badge_unlocks_block_delete
  before delete on public.badge_unlocks
  for each row execute function public._p35_badge_unlocks_block_delete();

-- ============================================================
-- TABLE COMMENTS
-- ============================================================

comment on table public.xp_ledger is
  'Phase 35 D-04 — append-only XP grants; SUM(xp_delta) is source of truth for level '
  'via compute_level(). NEVER update or delete rows; admin corrections insert new '
  'admin_adjustment rows. Negative-space RLS (no INSERT/UPDATE/DELETE for authenticated) '
  'enforces append-only at the policy layer; raise-exception triggers are defense-in-depth.';

comment on table public.badge_unlocks is
  'Phase 35 GAME-09 — append-only badge unlock records. Each row is permanent; '
  'UNIQUE (user_id, badge_id) ensures a badge unlocks at most once per user. '
  'FK to badge_catalog.id added in migration 20270708000003_p35_badge_catalog_seed.sql.';
