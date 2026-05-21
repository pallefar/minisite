-- Phase 35 Plan 35-04 — Leaderboard SECDEF RPCs.
--
-- Ships three functions:
--   1. set_leaderboard_optin(p_cohort_id, p_handle, p_opt_in) — user-context mutation
--   2. suggest_leaderboard_handle() — generates a default theme-rand4 suggestion
--   3. get_leaderboard_for_user(p_cohort_id) — top-10 + ±5 neighborhood read
--
-- CRITICAL AUTH NOTE (Pitfall 8 / memory feedback_rpc_auth_uid_vs_service_role_mismatch):
--   All three functions use auth.uid(). They are CLIENT-CALLED ONLY. They MUST NOT
--   be invoked from service-role Edge Fns (cron, fire-and-forget) because auth.uid()
--   returns NULL in service-role context → auth checks fail → 42501 exception.
--   This is an INTENTIONAL design (D-12: opt-in is user-driven; D-14: leaderboard
--   is user-visible). Comments below make this explicit.
--
-- SECDEF pattern (mirrors cohort_is_member in 20270602000011):
--   security definer + set search_path = public, pg_catalog
--
-- ============================================================================
-- 1. set_leaderboard_optin — user-context mutation (opt-in / opt-out)
-- ============================================================================

create or replace function public.set_leaderboard_optin(
  p_cohort_id uuid,
  p_handle    text,
  p_opt_in    boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
declare
  v_user            uuid := auth.uid();  -- CLIENT-CALLED ONLY (Pitfall 8)
  v_cohort_enabled  boolean;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- D-11: only allow opt-in to admin-enabled cohorts
  select leaderboard_enabled into v_cohort_enabled
    from public.cohort_definitions
   where id = p_cohort_id;

  if v_cohort_enabled is null then
    raise exception 'cohort_not_found' using errcode = 'P0002';
  end if;

  if not v_cohort_enabled then
    raise exception 'cohort_leaderboard_disabled' using errcode = 'P0001';
  end if;

  -- Verify user is a member of the cohort (cannot opt into a cohort they don't belong to).
  if not exists(
    select 1 from public.cohort_membership
     where user_id = v_user and cohort_id = p_cohort_id
  ) then
    raise exception 'not_cohort_member' using errcode = '42501';
  end if;

  if p_opt_in then
    -- D-13: handle regex validated by table CHECK constraint; this provides server-side
    -- mirror error message (client validateHandle in handle-validate.ts is for live feedback).
    if p_handle is null or p_handle !~ '^[a-zA-Z0-9_-]{6,24}$' then
      raise exception 'invalid_handle' using errcode = '22023';
    end if;

    -- UPSERT: INSERT or UPDATE handle + active=true.
    -- Per-cohort partial UNIQUE index on (cohort_id, handle) WHERE active=true blocks
    -- handle collision at the index level — surfaces as a unique_violation (23505).
    insert into public.leaderboard_optin (user_id, cohort_id, handle, active, updated_at)
    values (v_user, p_cohort_id, p_handle, true, now())
    on conflict (user_id, cohort_id) do update set
      handle      = excluded.handle,
      active      = true,
      updated_at  = now();

  else
    -- D-15: opt-out sets active=false; matview refresh excludes the row within 15 min.
    update public.leaderboard_optin
       set active     = false,
           updated_at = now()
     where user_id   = v_user
       and cohort_id = p_cohort_id;
  end if;
end;
$body$;

comment on function public.set_leaderboard_optin(uuid, text, boolean) is
  'Phase 35 D-12 — user-context-only opt-in/opt-out mutation. '
  'CLIENT-CALLED ONLY: uses auth.uid() to identify the opting user (Pitfall 8). '
  'MUST NOT be called from service-role Edge Fns; auth.uid() returns NULL in that context, '
  'which would surface as a 42501 unauthenticated exception and defeat the opt-in invariant. '
  'Validates: (1) cohort exists + leaderboard_enabled=true, (2) user is cohort_membership member, '
  '(3) handle matches ^[a-zA-Z0-9_-]{6,24}$ (D-13). '
  'Opt-out: sets active=false; matview refresh drops the row within 15 min (D-15).';

revoke all on function public.set_leaderboard_optin(uuid, text, boolean) from public;
grant execute on function public.set_leaderboard_optin(uuid, text, boolean) to authenticated;

-- ============================================================================
-- 2. suggest_leaderboard_handle — generates a default suggestion
-- ============================================================================
-- D-13: server-generated default suggestion (`<theme>-<rand4digit>`).
-- Suggestion is globally-unique heuristic (not per-cohort strict) — actual
-- uniqueness is enforced at insert time by the partial unique index.
-- Retries up to 10 times to avoid a collision on globally-active handles.

create or replace function public.suggest_leaderboard_handle()
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
declare
  v_themes  text[] := array[
    'Peptide', 'Curve', 'Site', 'Rotation', 'Coach',
    'Tracker', 'Cycle', 'Pioneer', 'Compound', 'Discipline'
  ];
  v_theme   text;
  v_suffix  int;
  v_handle  text;
  v_attempts int := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 10 then
      raise exception 'could_not_generate_unique_handle' using errcode = 'P0001';
    end if;

    v_theme  := v_themes[1 + floor(random() * array_length(v_themes, 1))::int];
    v_suffix := 1000 + floor(random() * 9000)::int;
    v_handle := v_theme || '-' || v_suffix::text;

    -- Simple global heuristic: avoid reusing any currently-active handle.
    -- Not strict (handles are unique per-cohort, not globally) — this is
    -- a suggestion only; the actual enforcement is at insert time.
    if not exists(
      select 1 from public.leaderboard_optin
       where handle = v_handle and active = true
    ) then
      return v_handle;
    end if;
  end loop;
end;
$body$;

comment on function public.suggest_leaderboard_handle() is
  'Phase 35 D-13 — generates a default leaderboard handle suggestion '
  'in the form <theme>-<rand4digit> (e.g., PeptidePioneer-7841). '
  'CLIENT-CALLED ONLY (auth.uid() context). '
  'Returns a handle that is not currently active globally (heuristic, not per-cohort strict). '
  'The Settings → Leaderboards form may pre-fill this suggestion; user can override.';

grant execute on function public.suggest_leaderboard_handle() to authenticated;

-- ============================================================================
-- 3. get_leaderboard_for_user — top-10 + ±5 neighborhood read
-- ============================================================================
-- D-14: Display = top-10 always + user's ±5 neighborhood.
-- Returns the UNION (de-duped by rank) of top-10 entries + self ±5 neighborhood,
-- sorted by rank_in_cohort. The `is_self` flag lets UI bold the user's row.
--
-- Privacy: user must be a member of the cohort to see its leaderboard.
-- Handles are anonymized — real user_id is NEVER returned to the client.

create or replace function public.get_leaderboard_for_user(p_cohort_id uuid)
returns table(
  handle          text,
  xp_7d           bigint,
  rank_in_cohort  bigint,
  is_self         boolean,
  refreshed_at    timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
stable
as $body$
declare
  v_user      uuid := auth.uid();  -- CLIENT-CALLED ONLY (Pitfall 8)
  v_self_rank bigint;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Privacy: user must be a member of the cohort to see its leaderboard.
  if not exists(
    select 1 from public.cohort_membership
     where user_id = v_user and cohort_id = p_cohort_id
  ) then
    raise exception 'not_cohort_member' using errcode = '42501';
  end if;

  -- Find self rank (NULL if user has not opted in or was not in last matview refresh).
  select rank_in_cohort into v_self_rank
    from public.leaderboard_matview
   where cohort_id = p_cohort_id and user_id = v_user;

  return query
    with top10 as (
      select m.handle, m.xp_7d, m.rank_in_cohort, m.user_id, m.refreshed_at
        from public.leaderboard_matview m
       where m.cohort_id = p_cohort_id
         and m.rank_in_cohort <= 10
    ),
    neighbors as (
      select m.handle, m.xp_7d, m.rank_in_cohort, m.user_id, m.refreshed_at
        from public.leaderboard_matview m
       where m.cohort_id = p_cohort_id
         and v_self_rank is not null
         and m.rank_in_cohort between greatest(1, v_self_rank - 5) and v_self_rank + 5
    )
    -- UNION de-dupes rows that appear in both top10 and neighbors (user in top 5).
    select t.handle, t.xp_7d, t.rank_in_cohort, (t.user_id = v_user) as is_self, t.refreshed_at
      from top10 t
    union
    select n.handle, n.xp_7d, n.rank_in_cohort, (n.user_id = v_user) as is_self, n.refreshed_at
      from neighbors n
    order by rank_in_cohort;
end;
$body$;

comment on function public.get_leaderboard_for_user(uuid) is
  'Phase 35 D-14 — top-10 + ±5 neighborhood leaderboard view for a cohort member. '
  'Returns anonymized handles only — user_id NEVER returned to client. '
  'is_self=true flags the requesting user''s row for UI highlighting. '
  'CLIENT-CALLED ONLY: uses auth.uid() (Pitfall 8). '
  'MUST NOT be invoked from service-role Edge Fns (xp-event, xp-grant, '
  'admin-grant-freeze-token, challenge-notify) — auth.uid() is NULL in those contexts. '
  'Plans 35-05 (admin module), 35-06 (LeaderboardCard), 35-08 (Settings → Leaderboards) '
  'consume this RPC. Matview is refreshed every 15 min (phase35-leaderboard-refresh cron).';

revoke all on function public.get_leaderboard_for_user(uuid) from public;
grant execute on function public.get_leaderboard_for_user(uuid) to authenticated;
