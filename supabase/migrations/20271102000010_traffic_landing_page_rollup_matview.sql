-- Phase 51 Plan 51-03 — traffic_landing_page_rollup materialized view.
-- Decision refs: D-11 (landing-path × variant rollup), D-14 (SECDEF accessor MVs).
-- Requirements: TRAFFIC-08, TRAFFIC-10.
--
-- One row per (landing_path, page_variant_id, audience, day, org_id). Counts
-- visits + signups + activations + paids per cell.
--
-- PAGEAB join: per orchestrator pre-flight, public.page_variants does NOT
-- exist on this codebase yet (Phase 15 / PAGEAB hasn't shipped). The matview
-- emits NULL::uuid for page_variant_id and Phase 15 will add a follow-up
-- migration that wires the join. This is documented in 51-03-SUMMARY and is a
-- known carry-over. The PAGEAB downstream wire-up can swap the matview body
-- with a CREATE OR REPLACE MATERIALIZED VIEW (or DROP + CREATE) and add a
-- LEFT JOIN — column list stays additive-safe.
--
-- Audience derivation matches traffic_channel_rollup (org_members → clinic-org,
-- affiliates → affiliate, else consumer).
--
-- Activation/paid events are counted via LEFT JOIN to events_mirror on
-- distinct_id = utat.user_id::text — same join semantic as channel rollup
-- (post-stitch users only contribute; pre-stitch users contribute 0 to these
-- metrics, which is the expected behavior — no user_id, no activation tracking).
--
-- CONCURRENT-refresh contract: UNIQUE index over the GROUP BY key with
-- COALESCE for nullable columns.
--
-- Migration timestamp: 20271102000010.

create materialized view public.traffic_landing_page_rollup as
with audience_per_user as (
  select
    utat.anon_id,
    utat.user_id,
    utat.org_id,
    utat.last_touch_landing_path,
    utat.last_touch_at,
    case
      when om.user_id is not null then 'clinic-org'
      when af.user_id is not null then 'affiliate'
      else 'consumer'
    end as audience
  from public.user_traffic_attribution utat
  left join lateral (
    select om2.user_id
    from public.org_members om2
    where om2.user_id = utat.user_id
    limit 1
  ) om on true
  left join public.affiliates af on af.user_id = utat.user_id
)
select
  au.last_touch_landing_path as landing_path,
  null::uuid as page_variant_id,  -- PAGEAB carry-over: Phase 15 wires via JOIN page_variants when shipped.
  au.audience,
  date_trunc('day', au.last_touch_at)::date as day,
  au.org_id,
  count(distinct au.anon_id) as visits,
  count(distinct au.user_id) filter (where au.user_id is not null) as signups,
  count(distinct em_act.distinct_id) as activations,
  count(distinct em_paid.distinct_id) as paids
from audience_per_user au
left join public.events_mirror em_act
  on em_act.distinct_id = au.user_id::text
 and em_act.event_name  = 'activation_event'
left join public.events_mirror em_paid
  on em_paid.distinct_id = au.user_id::text
 and em_paid.event_name  in ('paid', 'subscription_started', 'first_paid_seat', 'first_referral_conversion')
group by 1, 2, 3, 4, 5;

create unique index traffic_landing_page_rollup_uq
  on public.traffic_landing_page_rollup (
    (coalesce(landing_path, '')),
    (coalesce(page_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    audience,
    day,
    (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

comment on materialized view public.traffic_landing_page_rollup is
  'Phase 51 / D-11 / D-14 — Landing-path × variant × audience × day × org rollup. page_variant_id is NULL until Phase 15 (PAGEAB) wires the join. Read via get_traffic_landing_page_rollup SECDEF accessor.';
