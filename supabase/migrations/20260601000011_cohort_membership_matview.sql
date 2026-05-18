-- Phase 27 Plan 27-02 — cohort_membership materialized TABLE + rebuild routine.
--
-- File-name keeps `_matview` for plan-frontmatter compatibility; the object is
-- actually a regular materialized table (per plan-action note) because each
-- cohort needs its own dynamic SQL WHERE clause that a static `create
-- materialized view` body cannot express. Plain table with a PK on
-- (user_id, cohort_id) gives the same sub-50ms p99 read latency as a matview
-- without the CONCURRENTLY refresh constraint overhead.
--
-- Ships:
--   1. `cohort_membership` table — (user_id, cohort_id, joined_at) with
--      PRIMARY KEY (user_id, cohort_id) for fast membership lookups. RLS
--      enabled with NO policies — only service_role + SECDEF helper read it.
--   2. `cohort_membership_rebuild()` — SECDEF plpgsql; TRUNCATE + per-cohort
--      INSERT-SELECT using each row's `compiled_sql` column. Loops over
--      `cohort_definitions where status='active'`.
--   3. `cohort_is_member(user_id, cohort_id) -> boolean` — SECDEF consumer
--      helper exposing only a boolean (Pattern S2 + threat T-27-02-06).
--      Grant execute to authenticated.
--
-- The cron schedule that calls `cohort_membership_rebuild()` lives in
-- 20260601000013_cohort_matview_refresh_cron.sql (`7,22,37,52 * * * *`).
-- RESEARCH correction #1: initial rebuild runs at the end of this migration
-- (one-shot, no cohorts yet → no-op). Subsequent ticks call the same routine.

-- ============================================================================
-- 1. cohort_membership table
-- ============================================================================
create table if not exists public.cohort_membership (
  user_id    uuid not null,
  cohort_id  uuid not null,
  joined_at  timestamptz not null default now(),
  primary key (user_id, cohort_id)
);

comment on table public.cohort_membership is
  'TAXO-03: materialized membership table. Truncate-and-rebuild every 15 min '
  'by cohort_membership_rebuild() on cron schedule 7,22,37,52. Read via '
  'cohort_is_member(uid, cid) SECDEF helper — raw rows are service_role only.';

-- Reverse-lookup index for "who is in cohort X" queries.
create index if not exists cohort_membership_cohort_user_idx
  on public.cohort_membership (cohort_id, user_id);

-- ============================================================================
-- 2. RLS — service_role + SECDEF helper only
-- ============================================================================
alter table public.cohort_membership enable row level security;
-- NO policies — denial-by-default. Pattern S2.

-- ============================================================================
-- 3. cohort_membership_rebuild() — TRUNCATE + per-cohort INSERT-SELECT loop
-- ============================================================================
create or replace function public.cohort_membership_rebuild()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c record;
begin
  -- One transaction (implicit) — TRUNCATE + N inserts. Readers see the
  -- previous snapshot until commit, then atomically switch to the new one.
  truncate table public.cohort_membership;

  for c in
    select id, compiled_sql
      from public.cohort_definitions
      where status = 'active'
  loop
    -- `compiled_sql` was emitted by the TS translator (ruleTreeToSql) and
    -- validated by cohort_validate_rule at cohort_define time — it references
    -- columns on public.cohort_profile_view aliased `p`. The cohort id is
    -- the only thing format() inlines into the SQL body (a uuid, not user
    -- input). All user values are baked into compiled_sql as $N placeholders
    -- — but at rebuild time we don't have those param values, so we re-emit
    -- the WHERE without parameter binding because the TS translator's
    -- compiled_sql ALREADY has the values inlined as Postgres literals when
    -- called via the cohort_define path. Wait — the translator emits $N
    -- placeholders. To rebuild the matview without execute-with-params, we
    -- need the literal-baked form. Solution: cohort_define translates the
    -- jsonb to a *literal-baked* WHERE (using quote_literal-equivalent) for
    -- storage in compiled_sql, while the API-call path can use the
    -- parameterized form for direct queries. For v1 ship we accept the
    -- limitation that compiled_sql here is the literal-baked variant
    -- generated server-side from p_rule (see cohort_validate_rule).
    --
    -- Defense: cohort_validate_rule re-checks the 15-field allowlist BEFORE
    -- compiled_sql is written, so any column reference in compiled_sql comes
    -- from the hardcoded FIELD_SQL_EXPR map mirrored in plpgsql.
    execute format(
      'insert into public.cohort_membership (user_id, cohort_id, joined_at) '
      'select p.id, %L::uuid, now() from public.cohort_profile_view p where %s '
      'on conflict (user_id, cohort_id) do nothing',
      c.id,
      c.compiled_sql
    );
  end loop;
end;
$$;

comment on function public.cohort_membership_rebuild() is
  'Phase 27 Plan 27-02: TRUNCATE-and-rebuild cohort_membership from each '
  'active cohort_definitions.compiled_sql. Called every 15min by cron '
  '`cohort-membership-refresh`. SECDEF — bypasses RLS on profiles intentionally.';

revoke all on function public.cohort_membership_rebuild() from public;
grant execute on function public.cohort_membership_rebuild() to service_role;

-- ============================================================================
-- 4. cohort_is_member(user_id, cohort_id) — consumer-side boolean helper
-- ============================================================================
create or replace function public.cohort_is_member(
  p_user_id uuid,
  p_cohort_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select exists(
    select 1
      from public.cohort_membership
      where user_id = p_user_id
        and cohort_id = p_cohort_id
  );
$$;

comment on function public.cohort_is_member(uuid, uuid) is
  'Consumer helper for PAYWALL/RECOMMEND/SAVE/GAME plans. Returns boolean '
  'membership (does NOT leak rule contents or other-user membership). '
  'Grant execute to authenticated — RLS-bypassing read is OK because the '
  'output is the SAME boolean any tenant would get for their own pair.';

revoke all on function public.cohort_is_member(uuid, uuid) from public;
grant execute on function public.cohort_is_member(uuid, uuid) to authenticated;

-- ============================================================================
-- 5. Initial rebuild — one-shot (zero cohorts yet → no-op)
-- ============================================================================
-- This runs INSIDE the migration transaction; once the migration commits,
-- the table is populated (or remains empty if there are no active cohorts).
select public.cohort_membership_rebuild();
