-- Phase 51 Plan 51-03 — traffic_channel_rollup (LAST-touch) materialized view.
-- Decision refs: D-14 (SECDEF accessor MVs), D-15 (LEFT JOIN ad_spend by channel/day),
-- D-16 (cohort retention curves D1/D7/D14/D30/D60).
-- Requirements: TRAFFIC-07, TRAFFIC-09, TRAFFIC-10.
--
-- One row per (channel_group, audience, day, org_id) computed from
-- public.user_traffic_attribution (the authoritative attribution table shipped
-- by Plan 51-01). Channel grouping is taken from utat.last_touch_channel_group
-- (already classified at write time via classify_channel_group_with_referrer()
-- in the recorder Edge Fn / Plan 51-02).
--
-- Audience derivation (three-way join):
--   • clinic-org  — user is a member of any org (public.org_members; canonical
--                   table referenced by _is_org_clinician per 20270601300100).
--   • affiliate   — user owns an affiliates row (public.affiliates.user_id;
--                   canonical per Plan 51-01 SUMMARY Deviation #3 — there is
--                   no affiliate_partners table on this codebase).
--   • consumer    — else (everyone with a stitched user_id; anonymous visits
--                   default to consumer too).
--
-- Retention CTE calls public.is_retained(user_id, audience, window_days) for
-- each of D1/D7/D14/D30/D60. is_retained is SECDEF + stable + service_role
-- granted; it evaluates now() at function-call time (which is refresh time
-- for the matview). Per RESEARCH Pitfall 2 / memory
-- reference_supabase_migration_gotchas: no bare now() inside the matview
-- SELECT body — only via is_retained().
--
-- ad_spend join: public.ad_spend_facts has columns (network text in
-- ('meta','google','tiktok'), spend_date date, spend_usd_at_spend_date
-- numeric(12,6)). It has NO `day`/`spend_usd`/`org_id` columns; plan body
-- naming is normalized here. spend_usd_at_spend_date is NULL when fx_rate
-- was missing at write time (D-11 from Phase 33) — we sum it with
-- COALESCE(...,0) inside the per-channel-per-day CTE.
--
-- Channel mapping for ad spend: utat.last_touch_channel_group is the canonical
-- text (e.g., 'Paid Search', 'Paid Social'). ad_spend_facts.network is the
-- vendor key. Mapping per orchestrator prompt:
--   meta/facebook/instagram → 'Paid Social'
--   tiktok                  → 'Paid Social'
--   google                  → 'Paid Search'
--   else                    → 'Paid Search'  (defensive default; check
--                             constraint on ad_spend_facts.network limits
--                             to meta/google/tiktok so this branch never
--                             fires today but is future-proof).
--
-- Migration timestamp: shifted from plan-text 20270712000007 to 20271102000007
-- per orchestrator pre-flight (continuing the 20271102* range established by
-- Plan 51-01's renames; see Plan 51-01 SUMMARY Deviation #1).
--
-- CONCURRENT-refresh contract: UNIQUE index over the GROUP BY key is mandatory.
-- The org_id column is nullable so the unique key uses
-- COALESCE(org_id, '00000000-0000-0000-0000-000000000000') (Pattern P30 +
-- Plan 51-01 utat_org_id_last_touch_idx pattern).

create materialized view public.traffic_channel_rollup as
with
-- ---------------------------------------------------------------------------
-- Daily visits & signups, grouped on LAST-touch channel.
-- ---------------------------------------------------------------------------
daily_visits as (
  select
    utat.last_touch_channel_group as channel_group,
    case
      when om.user_id is not null then 'clinic-org'
      when af.user_id is not null then 'affiliate'
      else 'consumer'
    end as audience,
    date_trunc('day', utat.last_touch_at)::date as day,
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
-- ---------------------------------------------------------------------------
-- Daily activations (consumer audience only — activation_event in events_mirror).
-- ---------------------------------------------------------------------------
daily_activations as (
  select
    utat.last_touch_channel_group as channel_group,
    'consumer'::text as audience,
    date_trunc('day', em.created_at)::date as day,
    utat.org_id,
    count(distinct em.distinct_id) as activations
  from public.events_mirror em
  join public.user_traffic_attribution utat
    on utat.user_id::text = em.distinct_id
   or utat.user_id = em.user_id
  where em.event_name = 'activation_event'
  group by 1, 2, 3, 4
),
-- ---------------------------------------------------------------------------
-- Daily paids (consumer audience only — paid + subscription/seat/referral conv).
-- ---------------------------------------------------------------------------
daily_paids as (
  select
    utat.last_touch_channel_group as channel_group,
    'consumer'::text as audience,
    date_trunc('day', em.created_at)::date as day,
    utat.org_id,
    count(distinct em.distinct_id) as paids
  from public.events_mirror em
  join public.user_traffic_attribution utat
    on utat.user_id::text = em.distinct_id
   or utat.user_id = em.user_id
  where em.event_name in ('paid', 'subscription_started', 'first_paid_seat', 'first_referral_conversion')
  group by 1, 2, 3, 4
),
-- ---------------------------------------------------------------------------
-- Ad spend by channel_group × day (Phase 33 → Phase 51 CAC join).
-- network → channel_group fixed mapping per orchestrator prompt.
-- ---------------------------------------------------------------------------
ad_spend_by_channel_day as (
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
-- ---------------------------------------------------------------------------
-- Retention CTE — D1/D7/D14/D30/D60 cohort counts per (channel × audience × day × org).
-- Each is_retained call evaluates now() at refresh time (helper is stable).
-- ---------------------------------------------------------------------------
retention_per_channel as (
  select
    utat.last_touch_channel_group as channel_group,
    case
      when om.user_id is not null then 'clinic-org'
      when af.user_id is not null then 'affiliate'
      else 'consumer'
    end as audience,
    date_trunc('day', utat.last_touch_at)::date as day,
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
-- ---------------------------------------------------------------------------
-- Final SELECT: visits/signups/activations/paids/ad_spend + retention + CAC.
-- ---------------------------------------------------------------------------
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

-- CONCURRENT-refresh contract: UNIQUE index over GROUP BY key (with org_id
-- COALESCE since the column is nullable).
create unique index traffic_channel_rollup_uq
  on public.traffic_channel_rollup (
    channel_group,
    audience,
    day,
    (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

comment on materialized view public.traffic_channel_rollup is
  'Phase 51 / D-14 / D-15 / D-16 — Channel × audience × day × org rollup grouped on LAST-touch channel. Joins user_traffic_attribution → org_members/affiliates (audience) → events_mirror (activations/paids) → ad_spend_facts (CAC). Retention via is_retained() SECDEF helper. Read via get_traffic_channel_rollup SECDEF accessor (p_touch_mode=''last'').';
