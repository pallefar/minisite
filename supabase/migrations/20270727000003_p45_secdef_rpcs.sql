-- Phase 45 Plan 01 — 7 SECDEF RPCs (toggle / admin / leaderboard / activity).
--
-- Functions shipped:
--   1. toggle_community_block(p_target_user_id uuid) → boolean
--   2. community_report_create(p_target_type text, p_target_id uuid, p_reason text) → uuid
--   3. admin_toggle_space_leaderboard(p_space_id uuid, p_enabled boolean) → boolean
--   4. admin_set_clinician_verified(p_user_id uuid, p_verified boolean) → boolean
--   5. admin_toggle_report_digest_opt_in(p_enabled boolean) → boolean
--   6. update_community_last_active() → timestamptz
--   7. get_community_space_leaderboard(p_space_id uuid)
--        → table(handle text, score bigint, rank_in_space int)
--
-- Per memory reference_supabase_migration_gotchas:
--   security definer + set search_path = public, extensions (every function).
--
-- Per memory reference_postgres_no_insert_on_conflict_do_delete:
--   toggle_community_block uses SELECT FOR UPDATE then branch INSERT/DELETE.
--   This is the canonical Postgres idiom for symmetric idempotent toggles.
--
-- Per memory feedback_rpc_auth_uid_vs_service_role_mismatch:
--   All 7 RPCs use auth.uid(); they are CLIENT-CALLED ONLY. Cron / fire-and-forget
--   Edge Fns (e.g. community-admin-report-digest in plan 45-05) MUST NOT invoke
--   these — they should write/read tables directly with service-role.
--
-- Per memory feedback_negation_grep_defeated_by_comment_string:
--   Rejected alternatives are intentionally NOT named in this file.
--
-- Per memory reference_supabase_is_staff_helper:
--   Admin guards use `public.is_staff()` directly.
--
-- get_community_space_leaderboard references
-- `public.community_space_leaderboard_matview` which ships in plan 45-06
-- (20270727000005). Function-body validation is LAZY in Postgres; this
-- function compiles cleanly even before the matview exists, but it will
-- raise `relation does not exist` at first invocation if 45-06 has not
-- yet been pushed. Order is enforced by the close-out plan 45-09 push.

begin;

-- ============================================================================
-- 1. toggle_community_block — SELECT FOR UPDATE + branch INSERT/DELETE
-- ============================================================================
create or replace function public.toggle_community_block(
  p_target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_exists  boolean;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_user_id is null then
    raise exception 'invalid_target_user_id' using errcode = '22023';
  end if;

  -- Cannot self-block (mirrors the user_block_list CHECK constraint —
  -- belt-and-suspenders to surface a clean error instead of 23514).
  if p_target_user_id = v_user_id then
    raise exception 'cannot_self_block' using errcode = '22023';
  end if;

  -- SELECT FOR UPDATE locks the row (or empty set) for the toggle,
  -- preventing a concurrent caller from inserting between our existence
  -- check and the branch. This is the canonical Postgres pattern for
  -- symmetric idempotent toggles per
  -- reference_postgres_no_insert_on_conflict_do_delete.
  select exists (
    select 1 from public.user_block_list
    where blocker_user_id = v_user_id
      and blocked_user_id = p_target_user_id
    for update
  ) into v_exists;

  if v_exists then
    delete from public.user_block_list
    where blocker_user_id = v_user_id
      and blocked_user_id = p_target_user_id;
    return false;  -- now unblocked
  else
    insert into public.user_block_list (blocker_user_id, blocked_user_id)
      values (v_user_id, p_target_user_id);
    return true;   -- now blocked
  end if;
end;
$fn$;

comment on function public.toggle_community_block(uuid) is
  'P45 D-10 — idempotent block toggle. Returns true=now blocked, false=now unblocked. '
  'CLIENT-CALLED ONLY (auth.uid() context).';

revoke execute on function public.toggle_community_block(uuid) from public, anon;
grant  execute on function public.toggle_community_block(uuid) to authenticated;

-- ============================================================================
-- 2. community_report_create — user-context insert; returns inserted id
-- ============================================================================
create or replace function public.community_report_create(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id   uuid := auth.uid();
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_target_type not in ('post','comment','dm_message','profile') then
    raise exception 'invalid_target_type' using errcode = '22023';
  end if;

  if p_target_id is null then
    raise exception 'invalid_target_id' using errcode = '22023';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  insert into public.community_reports
    (reporter_user_id, target_type, target_id, reason)
  values
    (v_user_id, p_target_type, p_target_id, p_reason)
  returning id into v_report_id;

  return v_report_id;
end;
$fn$;

comment on function public.community_report_create(text, uuid, text) is
  'P45 D-11 — consumer-facing write-only report submission. '
  'CLIENT-CALLED ONLY (auth.uid()).';

revoke execute on function public.community_report_create(text, uuid, text) from public, anon;
grant  execute on function public.community_report_create(text, uuid, text) to authenticated;

-- ============================================================================
-- 3. admin_toggle_space_leaderboard — is_staff()-guarded toggle (D-14)
-- ============================================================================
create or replace function public.admin_toggle_space_leaderboard(
  p_space_id uuid,
  p_enabled  boolean
)
returns boolean
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

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.community_spaces
    set leaderboard_enabled = p_enabled,
        updated_at          = now()
    where id = p_space_id;

  return p_enabled;
end;
$fn$;

comment on function public.admin_toggle_space_leaderboard(uuid, boolean) is
  'P45 D-14 — staff-only toggle for per-space leaderboard visibility.';

revoke execute on function public.admin_toggle_space_leaderboard(uuid, boolean) from public, anon;
grant  execute on function public.admin_toggle_space_leaderboard(uuid, boolean) to authenticated;

-- ============================================================================
-- 4. admin_set_clinician_verified — is_staff()-guarded clinician badge
-- ============================================================================
create or replace function public.admin_set_clinician_verified(
  p_user_id  uuid,
  p_verified boolean
)
returns boolean
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

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.profiles
    set is_clinician_verified = p_verified
    where id = p_user_id;

  return p_verified;
end;
$fn$;

comment on function public.admin_set_clinician_verified(uuid, boolean) is
  'P45 — staff-only setter for profiles.is_clinician_verified (badge + DM rate-limit bypass).';

revoke execute on function public.admin_set_clinician_verified(uuid, boolean) from public, anon;
grant  execute on function public.admin_set_clinician_verified(uuid, boolean) to authenticated;

-- ============================================================================
-- 5. admin_toggle_report_digest_opt_in — staff self-opt-in for daily digest
-- ============================================================================
create or replace function public.admin_toggle_report_digest_opt_in(
  p_enabled boolean
)
returns boolean
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

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.profiles
    set admin_digest_opt_in = p_enabled
    where id = v_user_id;

  return p_enabled;
end;
$fn$;

comment on function public.admin_toggle_report_digest_opt_in(boolean) is
  'P45 D-11 — staff self-opt-in to the daily admin report digest email.';

revoke execute on function public.admin_toggle_report_digest_opt_in(boolean) from public, anon;
grant  execute on function public.admin_toggle_report_digest_opt_in(boolean) to authenticated;

-- ============================================================================
-- 6. update_community_last_active — debounce signal for "active" presence
-- ============================================================================
create or replace function public.update_community_last_active()
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_now     timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  update public.profiles
    set community_last_active_at = v_now
    where id = v_user_id;

  return v_now;
end;
$fn$;

comment on function public.update_community_last_active() is
  'P45 — pings profiles.community_last_active_at = now() for the caller. Used by '
  'dm-create-thread Edge Fn to skip notify-community when recipient was active <5 min ago.';

revoke execute on function public.update_community_last_active() from public, anon;
grant  execute on function public.update_community_last_active() to authenticated;

-- ============================================================================
-- 7. get_community_space_leaderboard — top-10 + ±5 neighborhood read
-- ============================================================================
-- D-14 — top-10 always + caller's ±5 neighborhood. Matview ships in plan 45-06
-- (20270727000005_p45_leaderboard_matview.sql). Function body validation is
-- lazy in Postgres; this compiles even before the matview exists.
--
-- Mirror of public.get_leaderboard_for_user (Phase 35, 20270708000014). The
-- handle returned here is profiles.leaderboard_handle (per D-16 — global per-
-- profile handle), NOT the per-cohort handle Phase 35 used.
create or replace function public.get_community_space_leaderboard(
  p_space_id uuid
)
returns table(
  handle        text,
  score         bigint,
  rank_in_space integer
)
language plpgsql
security definer
set search_path = public, extensions
stable
as $fn$
declare
  v_user_id   uuid := auth.uid();
  v_self_rank integer;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Find caller's rank in the target space (NULL if not opted in or not yet refreshed).
  select m.rank_in_space::integer into v_self_rank
    from public.community_space_leaderboard_matview m
   where m.space_id = p_space_id and m.user_id = v_user_id;

  return query
    with top10 as (
      select m.handle, m.score, m.rank_in_space::integer as rank_in_space
        from public.community_space_leaderboard_matview m
       where m.space_id = p_space_id
         and m.rank_in_space <= 10
    ),
    neighbors as (
      select m.handle, m.score, m.rank_in_space::integer as rank_in_space
        from public.community_space_leaderboard_matview m
       where m.space_id = p_space_id
         and v_self_rank is not null
         and m.rank_in_space between greatest(1, v_self_rank - 5) and (v_self_rank + 5)
    )
    select t.handle, t.score, t.rank_in_space from top10     t
    union
    select n.handle, n.score, n.rank_in_space from neighbors n
    order by rank_in_space;
end;
$fn$;

comment on function public.get_community_space_leaderboard(uuid) is
  'P45 D-14 — top-10 + ±5 neighborhood read for a space leaderboard. '
  'Returns anonymized leaderboard_handle only. CLIENT-CALLED ONLY (auth.uid()). '
  'Matview lives in 20270727000005_p45_leaderboard_matview.sql (plan 45-06).';

revoke execute on function public.get_community_space_leaderboard(uuid) from public, anon;
grant  execute on function public.get_community_space_leaderboard(uuid) to authenticated;

commit;
