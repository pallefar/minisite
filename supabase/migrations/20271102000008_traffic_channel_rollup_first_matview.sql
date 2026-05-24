-- Phase 51 Plan 51-03 — traffic_channel_rollup_first (FIRST-touch) materialized view.
-- Decision refs: D-02 (first-touch immutability + first-touch attribution),
-- B4 revision iter-1 (D-02 toggle delivers real first-vs-last data, not a UI no-op).
-- Requirements: TRAFFIC-07.
--
-- Symmetric twin of traffic_channel_rollup. Only diffs:
--   last_touch_channel_group → first_touch_channel_group
--   last_touch_at            → first_touch_at
-- All other columns, retention CTEs, ad_spend join, and CAC math are identical.
-- ad_spend_by_channel_day CTE body is byte-identical between the two matviews
-- because it keys on network→channel_group mapping inside ad_spend_facts —
-- nothing in it references user_traffic_attribution.
--
-- Row type compatibility: traffic_channel_rollup and traffic_channel_rollup_first
-- have IDENTICAL column lists and types. The SECDEF accessor get_traffic_channel_rollup
-- in 20271102000012 declares `returns setof public.traffic_channel_rollup` and
-- conditionally branches the underlying matview by p_touch_mode. Postgres row-
-- type compatibility lets `setof public.traffic_channel_rollup` accept rows
-- from the structurally-identical traffic_channel_rollup_first.
--
-- File-order note: the orchestrator pre-flight initially suggested timestamp
-- 20271102000013 for this twin. That conflicts with dependency order — the
-- cron at 20271102000013 in this batch refreshes the twin and cannot run until
-- the twin exists. Twin is placed at 20271102000008 (before the SECDEF
-- accessors at ..0012 and before the cron at ..0013) so each migration's
-- dependencies are already applied at apply time. Documented in 51-03-SUMMARY
-- §Deviations.

create materialized view public.traffic_channel_rollup_first as
with
daily_visits as (
  select
    utat.first_touch_channel_group as channel_group,
    case
      when om.user_id is not null then 'clinic-org'
      when af.user_id is not null then 'affiliate'
      else 'consumer'
    end as audience,
    date_trunc('day', utat.first_touch_at)::date as day,
    utat.org_id,
    count(distinct utat.anon_id) as visits,
    count(distinct utat.user_id) filter (where utat.user_id is not null) as signups
  from public.user_traffic_attribution utat
  left join lateral (
    select om2.user_id
    from public.org_members om2
    where om2.user_id = utat.user_id
    limit 1
  ) om on true
  left join public.affiliates af on af.user_id = utat.user_id
  group by 1, 2, 3, 4
),
-- REVIEW CR-02 fix (FIRST-touch mirror of last-touch matview): lateral-pick
-- the EARLIEST utat row per em.user_id so each activation/paid is attributed
-- to exactly one first-touch channel_group (otherwise N anon devices = N rows
-- = N-fold inflation, see migration 20271102000007 for full rationale).
daily_activations as (
  select
    utat.first_touch_channel_group as channel_group,
    'consumer'::text as audience,
    date_trunc('day', em.created_at)::date as day,
    utat.org_id,
    count(distinct em.distinct_id) as activations
  from public.events_mirror em
  join lateral (
    select u.first_touch_channel_group, u.org_id, u.first_touch_at
    from public.user_traffic_attribution u
    where (em.user_id is not null and u.user_id = em.user_id)
       or (u.user_id::text = em.distinct_id)
       or (u.anon_id = em.distinct_id)
    order by u.first_touch_at asc
    limit 1
  ) utat on true
  where em.event_name = 'activation_event'
  group by 1, 2, 3, 4
),
daily_paids as (
  select
    utat.first_touch_channel_group as channel_group,
    'consumer'::text as audience,
    date_trunc('day', em.created_at)::date as day,
    utat.org_id,
    count(distinct em.distinct_id) as paids
  from public.events_mirror em
  join lateral (
    select u.first_touch_channel_group, u.org_id, u.first_touch_at
    from public.user_traffic_attribution u
    where (em.user_id is not null and u.user_id = em.user_id)
       or (u.user_id::text = em.distinct_id)
       or (u.anon_id = em.distinct_id)
    order by u.first_touch_at asc
    limit 1
  ) utat on true
  where em.event_name in ('paid', 'subscription_started', 'first_paid_seat', 'first_referral_conversion')
  group by 1, 2, 3, 4
),
ad_spend_by_channel_day as (
  -- IDENTICAL to traffic_channel_rollup's CTE — keys on network mapping inside
  -- ad_spend_facts, not on user_traffic_attribution.
  select
    case
      when network in ('meta', 'facebook', 'instagram') then 'Paid Social'
      when network = 'google' then 'Paid Search'
      when network = 'tiktok' then 'Paid Social'
      else 'Paid Search'
    end as channel_group,
    spend_date as day,
    sum(coalesce(spend_usd_at_spend_date, 0)) as ad_spend_usd
  from public.ad_spend_facts
  group by 1, 2
),
retention_per_channel as (
  select
    utat.first_touch_channel_group as channel_group,
    case
      when om.user_id is not null then 'clinic-org'
      when af.user_id is not null then 'affiliate'
      else 'consumer'
    end as audience,
    date_trunc('day', utat.first_touch_at)::date as day,
    utat.org_id,
    count(distinct utat.user_id) filter (
      where utat.user_id is not null
        and public.is_retained(utat.user_id,
              case
                when om.user_id is not null then 'clinic-org'
                when af.user_id is not null then 'affiliate'
                else 'consumer'
              end,
              1)
    ) as d1_retained_count,
    count(distinct utat.user_id) filter (
      where utat.user_id is not null
        and public.is_retained(utat.user_id,
              case
                when om.user_id is not null then 'clinic-org'
                when af.user_id is not null then 'affiliate'
                else 'consumer'
              end,
              7)
    ) as d7_retained_count,
    count(distinct utat.user_id) filter (
      where utat.user_id is not null
        and public.is_retained(utat.user_id,
              case
                when om.user_id is not null then 'clinic-org'
                when af.user_id is not null then 'affiliate'
                else 'consumer'
              end,
              14)
    ) as d14_retained_count,
    count(distinct utat.user_id) filter (
      where utat.user_id is not null
        and public.is_retained(utat.user_id,
              case
                when om.user_id is not null then 'clinic-org'
                when af.user_id is not null then 'affiliate'
                else 'consumer'
              end,
              30)
    ) as d30_retained_count,
    count(distinct utat.user_id) filter (
      where utat.user_id is not null
        and public.is_retained(utat.user_id,
              case
                when om.user_id is not null then 'clinic-org'
                when af.user_id is not null then 'affiliate'
                else 'consumer'
              end,
              60)
    ) as d60_retained_count
  from public.user_traffic_attribution utat
  left join lateral (
    select om2.user_id
    from public.org_members om2
    where om2.user_id = utat.user_id
    limit 1
  ) om on true
  left join public.affiliates af on af.user_id = utat.user_id
  group by 1, 2, 3, 4
)
select
  dv.channel_group,
  dv.audience,
  dv.day,
  dv.org_id,
  coalesce(dv.visits, 0)            as visits,
  coalesce(dv.signups, 0)           as signups,
  coalesce(da.activations, 0)       as activations,
  coalesce(dp.paids, 0)             as paids,
  coalesce(asd.ad_spend_usd, 0)     as ad_spend_usd,
  coalesce(rp.d1_retained_count, 0)  as d1_retained_count,
  coalesce(rp.d7_retained_count, 0)  as d7_retained_count,
  coalesce(rp.d14_retained_count, 0) as d14_retained_count,
  coalesce(rp.d30_retained_count, 0) as d30_retained_count,
  coalesce(rp.d60_retained_count, 0) as d60_retained_count,
  case
    when coalesce(da.activations, 0) > 0
      then coalesce(asd.ad_spend_usd, 0) / da.activations
  end as cac_to_activation,
  case
    when coalesce(dp.paids, 0) > 0
      then coalesce(asd.ad_spend_usd, 0) / dp.paids
  end as cac_to_paid
from daily_visits dv
left join daily_activations da using (channel_group, audience, day, org_id)
left join daily_paids       dp using (channel_group, audience, day, org_id)
left join ad_spend_by_channel_day asd
  on asd.channel_group = dv.channel_group and asd.day = dv.day
left join retention_per_channel rp using (channel_group, audience, day, org_id);

create unique index traffic_channel_rollup_first_uq
  on public.traffic_channel_rollup_first (
    channel_group,
    audience,
    day,
    (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

comment on materialized view public.traffic_channel_rollup_first is
  'Phase 51 / D-02 — FIRST-touch symmetric twin of traffic_channel_rollup. Identical column list/types; only the GROUP BY column differs (first_touch_channel_group / first_touch_at). Read via get_traffic_channel_rollup SECDEF accessor with p_touch_mode=''first''.';
