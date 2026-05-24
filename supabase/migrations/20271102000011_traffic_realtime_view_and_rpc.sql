-- Phase 51 Plan 51-03 — traffic_realtime_v VIEW + get_realtime_traffic_summary RPC.
-- Decision refs: D-10 (realtime tab last-60min over user_traffic_attribution +
-- events_mirror — direct query, not matview).
-- Requirements: TRAFFIC-07, TRAFFIC-08.
--
-- This is a REGULAR view (not a matview) — it is evaluated at every query so
-- it returns rows from the last 60 minutes at SELECT time. Plan-checker iter-1
-- pinned the cost as bounded to recent rows (T-51-19 disposition: accept).
--
-- Direct SELECT against traffic_realtime_v is allowed for the SECDEF accessor
-- only; the view inherits the underlying RLS on user_traffic_attribution (RLS
-- enabled there by Plan 51-01) and events_mirror (RLS enabled with no policies
-- — only SECDEF callers can read). The accessor RPC runs as SECDEF so it
-- bypasses both, then applies its own is_admin_at_least + _is_org_clinician
-- gate.
--
-- get_realtime_traffic_summary RPC: returns (channel_group, audience, visits,
-- signups, activations, paids) over the last `p_minutes` minutes for the
-- given `p_org_id` (or all orgs when admin and p_org_id is null).
--
-- Helper-name resolution: per Plan 51-01 SUMMARY Deviation #2 the canonical
-- admin gate on this codebase is public.is_admin_at_least(min_role
-- public.admin_role); public.is_admin() does NOT exist. The accessor pattern
-- here mirrors the corrected form.
--
-- Migration timestamp: 20271102000011.

-- ---------------------------------------------------------------------------
-- 1. Regular VIEW — evaluated at each call. Last 60min of attribution rows.
-- ---------------------------------------------------------------------------
create or replace view public.traffic_realtime_v as
select
  utat.last_touch_channel_group as channel_group,
  utat.last_touch_landing_path  as landing_path,
  case
    when om.user_id is not null then 'clinic-org'
    when af.user_id is not null then 'affiliate'
    else 'consumer'
  end as audience,
  utat.anon_id,
  utat.user_id,
  utat.org_id,
  utat.last_touch_at
from public.user_traffic_attribution utat
left join lateral (
  select om2.user_id
  from public.org_members om2
  where om2.user_id = utat.user_id
  limit 1
) om on true
left join public.affiliates af on af.user_id = utat.user_id
where utat.last_touch_at >= now() - interval '60 minutes';

-- Direct VIEW access is locked down. Only the SECDEF RPC reads it.
revoke all on public.traffic_realtime_v from public, anon, authenticated;

comment on view public.traffic_realtime_v is
  'Phase 51 / D-10 — Regular VIEW (not matview) over user_traffic_attribution last 60min. Read only via get_realtime_traffic_summary SECDEF RPC.';

-- ---------------------------------------------------------------------------
-- 2. SECDEF accessor RPC for the realtime tab.
-- ---------------------------------------------------------------------------
create or replace function public.get_realtime_traffic_summary(
  p_minutes int default 60,
  p_org_id  uuid default null
)
returns table (
  channel_group text,
  audience      text,
  visits        bigint,
  signups       bigint,
  activations   bigint,
  paids         bigint
)
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

  -- Authorization gate (canonical helper per Plan 51-01 SUMMARY Deviation #2):
  --   Admin (admin role ≥ 'admin') may read all orgs OR a specific org.
  --   Clinic-org clinician/owner may read only their own org.
  if not public.is_admin_at_least('admin'::public.admin_role)
     and (p_org_id is null or not public._is_org_clinician(p_org_id, v_uid)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Bound p_minutes to (0, 1440] for safety. Default 60 (last hour).
  if p_minutes is null or p_minutes <= 0 then
    p_minutes := 60;
  elsif p_minutes > 1440 then
    p_minutes := 1440;
  end if;

  return query
  select
    tr.channel_group,
    tr.audience,
    count(distinct tr.anon_id)                                                                              as visits,
    count(distinct tr.user_id) filter (where tr.user_id is not null)                                        as signups,
    count(distinct em_act.distinct_id)                                                                      as activations,
    count(distinct em_paid.distinct_id)                                                                     as paids
  from public.traffic_realtime_v tr
  left join public.events_mirror em_act
    on em_act.distinct_id = tr.user_id::text
   and em_act.event_name  = 'activation_event'
   and em_act.created_at >= now() - make_interval(mins => p_minutes)
  left join public.events_mirror em_paid
    on em_paid.distinct_id = tr.user_id::text
   and em_paid.event_name  in ('paid', 'subscription_started', 'first_paid_seat', 'first_referral_conversion')
   and em_paid.created_at >= now() - make_interval(mins => p_minutes)
  where tr.last_touch_at >= now() - make_interval(mins => p_minutes)
    and (p_org_id is null or tr.org_id = p_org_id)
  group by 1, 2;
end;
$$;

revoke all on function public.get_realtime_traffic_summary(int, uuid) from public, anon;
grant execute on function public.get_realtime_traffic_summary(int, uuid) to authenticated;

comment on function public.get_realtime_traffic_summary(int, uuid) is
  'Phase 51 / D-10 — Realtime traffic summary (last p_minutes, default 60). Gates on is_admin_at_least(''admin'') OR _is_org_clinician(p_org_id, auth.uid()). p_minutes capped at 1440 (24h).';
