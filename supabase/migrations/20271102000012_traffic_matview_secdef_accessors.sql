-- Phase 51 Plan 51-03 — SECDEF accessor RPCs for the 4 traffic matviews.
-- Decision refs: D-14 (SECDEF accessor = RLS-equivalent for matviews),
-- D-02 (first/last-touch toggle delivers real data, not a UI no-op).
-- Requirements: TRAFFIC-07, TRAFFIC-08, TRAFFIC-10.
-- Threat refs: T-51-16 (clinic_owner reading another org's matview rows).
--
-- Three accessor functions:
--   public.get_traffic_channel_rollup(p_org_id, p_start_date, p_end_date, p_touch_mode)
--   public.get_traffic_funnel_rollup(p_org_id, p_start_date, p_end_date, p_audience)
--   public.get_traffic_landing_page_rollup(p_org_id, p_start_date, p_end_date, p_audience, p_top_n)
--
-- All four matviews have their direct grants revoked from public/anon/
-- authenticated. The SECDEF accessors are the ONLY read path (matview RLS is
-- not supported in Postgres; cross-tenant isolation is enforced at the
-- function level — same pattern as Phase 30 mv_clinic_alert_metrics, see
-- 20270601300004_p30_matviews_and_cron.sql).
--
-- Authorization gate (canonical helper per Plan 51-01 SUMMARY Deviation #2):
--   • public.is_admin_at_least('admin'::public.admin_role) — admin path
--     (admin/superadmin) sees all orgs OR a specific org.
--   • public._is_org_clinician(p_org_id, auth.uid()) — clinic-org clinician/
--     owner sees only their own org rows.
--   • else — raise 42501 forbidden.
--
-- D-02 first/last-touch toggle: get_traffic_channel_rollup honors p_touch_mode
-- text default 'last'. Valid values: 'first' | 'last'. The function branches
-- the underlying matview by mode:
--   'last'  → public.traffic_channel_rollup
--   'first' → public.traffic_channel_rollup_first
-- Both matviews have IDENTICAL column lists/types so a single function
-- declared `returns setof public.traffic_channel_rollup` accepts rows from
-- either source. Plan 51-10's cross-tenant RLS test fixture seeds rows where
-- first_touch_channel_group != last_touch_channel_group and asserts the two
-- modes return rows tagged with the correct channel — proving the toggle
-- actually moves data (B4 acceptance per orchestrator pre-flight).
--
-- Migration timestamp: 20271102000012.

-- ---------------------------------------------------------------------------
-- 1. Lock down all 4 matviews. SECDEF accessors are the only read path.
-- ---------------------------------------------------------------------------
revoke all on public.traffic_channel_rollup       from public, anon, authenticated;
revoke all on public.traffic_channel_rollup_first from public, anon, authenticated;
revoke all on public.traffic_funnel_rollup        from public, anon, authenticated;
revoke all on public.traffic_landing_page_rollup  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_traffic_channel_rollup — D-02 toggle (p_touch_mode first|last).
-- ---------------------------------------------------------------------------
create or replace function public.get_traffic_channel_rollup(
  p_org_id      uuid default null,
  p_start_date  date default null,
  p_end_date    date default null,
  p_touch_mode  text default 'last'
)
returns setof public.traffic_channel_rollup
language plpgsql
security definer
stable
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_touch_mode is null or p_touch_mode not in ('first', 'last') then
    raise exception 'invalid_touch_mode' using errcode = '22023';
  end if;

  if public.is_admin_at_least('admin'::public.admin_role) then
    if p_touch_mode = 'first' then
      return query
      select * from public.traffic_channel_rollup_first tcr
      where (p_org_id     is null or tcr.org_id = p_org_id)
        and (p_start_date is null or tcr.day  >= p_start_date)
        and (p_end_date   is null or tcr.day  <= p_end_date);
    else
      return query
      select * from public.traffic_channel_rollup tcr
      where (p_org_id     is null or tcr.org_id = p_org_id)
        and (p_start_date is null or tcr.day  >= p_start_date)
        and (p_end_date   is null or tcr.day  <= p_end_date);
    end if;
  elsif p_org_id is not null and public._is_org_clinician(p_org_id, v_uid) then
    if p_touch_mode = 'first' then
      return query
      select * from public.traffic_channel_rollup_first tcr
      where tcr.org_id = p_org_id
        and (p_start_date is null or tcr.day >= p_start_date)
        and (p_end_date   is null or tcr.day <= p_end_date);
    else
      return query
      select * from public.traffic_channel_rollup tcr
      where tcr.org_id = p_org_id
        and (p_start_date is null or tcr.day >= p_start_date)
        and (p_end_date   is null or tcr.day <= p_end_date);
    end if;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.get_traffic_channel_rollup(uuid, date, date, text) from public, anon;
grant execute on function public.get_traffic_channel_rollup(uuid, date, date, text) to authenticated;

comment on function public.get_traffic_channel_rollup(uuid, date, date, text) is
  'Phase 51 / D-02 / D-14 — Channel rollup accessor with first/last-touch toggle. Admin: all orgs or specific org. Clinic-org clinician/owner: own org only. p_touch_mode in (''first'',''last''). Reads traffic_channel_rollup (last) or traffic_channel_rollup_first (first) by mode.';

-- ---------------------------------------------------------------------------
-- 3. get_traffic_funnel_rollup — per-audience funnel stage_pair rollup.
-- ---------------------------------------------------------------------------
create or replace function public.get_traffic_funnel_rollup(
  p_org_id      uuid default null,
  p_start_date  date default null,
  p_end_date    date default null,
  p_audience    text default null
)
returns setof public.traffic_funnel_rollup
language plpgsql
security definer
stable
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_audience is not null and p_audience not in ('consumer', 'clinic-org', 'affiliate') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;

  if public.is_admin_at_least('admin'::public.admin_role) then
    return query
    select * from public.traffic_funnel_rollup tfr
    where (p_org_id     is null or tfr.org_id   = p_org_id)
      and (p_start_date is null or tfr.day     >= p_start_date)
      and (p_end_date   is null or tfr.day     <= p_end_date)
      and (p_audience   is null or tfr.audience = p_audience);
  elsif p_org_id is not null and public._is_org_clinician(p_org_id, v_uid) then
    return query
    select * from public.traffic_funnel_rollup tfr
    where tfr.org_id = p_org_id
      and (p_start_date is null or tfr.day     >= p_start_date)
      and (p_end_date   is null or tfr.day     <= p_end_date)
      and (p_audience   is null or tfr.audience = p_audience);
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.get_traffic_funnel_rollup(uuid, date, date, text) from public, anon;
grant execute on function public.get_traffic_funnel_rollup(uuid, date, date, text) to authenticated;

comment on function public.get_traffic_funnel_rollup(uuid, date, date, text) is
  'Phase 51 / D-14 / D-05 — Funnel rollup accessor. Optional p_audience filter (consumer/clinic-org/affiliate). Admin/_is_org_clinician gate.';

-- ---------------------------------------------------------------------------
-- 4. get_traffic_landing_page_rollup — landing-path × variant × audience.
-- ---------------------------------------------------------------------------
create or replace function public.get_traffic_landing_page_rollup(
  p_org_id      uuid default null,
  p_start_date  date default null,
  p_end_date    date default null,
  p_audience    text default null,
  p_top_n       int  default 25
)
returns setof public.traffic_landing_page_rollup
language plpgsql
security definer
stable
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_audience is not null and p_audience not in ('consumer', 'clinic-org', 'affiliate') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;

  if p_top_n is null or p_top_n <= 0 then
    p_top_n := 25;
  elsif p_top_n > 500 then
    p_top_n := 500;
  end if;

  if public.is_admin_at_least('admin'::public.admin_role) then
    return query
    select * from public.traffic_landing_page_rollup tlp
    where (p_org_id     is null or tlp.org_id   = p_org_id)
      and (p_start_date is null or tlp.day     >= p_start_date)
      and (p_end_date   is null or tlp.day     <= p_end_date)
      and (p_audience   is null or tlp.audience = p_audience)
    order by tlp.visits desc nulls last
    limit p_top_n;
  elsif p_org_id is not null and public._is_org_clinician(p_org_id, v_uid) then
    return query
    select * from public.traffic_landing_page_rollup tlp
    where tlp.org_id = p_org_id
      and (p_start_date is null or tlp.day     >= p_start_date)
      and (p_end_date   is null or tlp.day     <= p_end_date)
      and (p_audience   is null or tlp.audience = p_audience)
    order by tlp.visits desc nulls last
    limit p_top_n;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.get_traffic_landing_page_rollup(uuid, date, date, text, int) from public, anon;
grant execute on function public.get_traffic_landing_page_rollup(uuid, date, date, text, int) to authenticated;

comment on function public.get_traffic_landing_page_rollup(uuid, date, date, text, int) is
  'Phase 51 / D-11 / D-14 — Landing-page rollup accessor with top-N (p_top_n default 25, capped at 500). Admin/_is_org_clinician gate.';
