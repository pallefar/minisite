-- Phase 51 Plan 51-03 — traffic_funnel_rollup materialized view.
-- Decision refs: D-14 (SECDEF accessor MVs), D-05 (per-audience funnel stages).
-- Requirements: TRAFFIC-08.
--
-- Per-audience funnel stage_pair rollup. For each audience, the table of
-- (stage_in, stage_out, event_in, event_out) is enumerated as a VALUES list;
-- the matview LATERAL-joins events_mirror rows for the stage_in event then
-- LEFT-joins events_mirror rows for the stage_out event (where stage_out
-- occurred AFTER stage_in for the same distinct_id).
--
-- Stage map (per orchestrator prompt + D-05):
--   consumer    : visit → signup → activation → paid
--   clinic-org  : visit → clinic_signup → first_patient_added → first_paid_seat
--   affiliate   : visit → affiliate_signup → first_referral_conversion
--
-- Output columns:
--   audience text, channel_group text, day date, org_id uuid, funnel text,
--   stage_in text, stage_out text, in_count bigint, out_count bigint,
--   rate numeric (out_count / in_count; NULL when in_count = 0).
--
-- channel_group is taken from utat.last_touch_channel_group at the time of
-- the stage_in event (the actor's most recent channel at that moment); a
-- LEFT JOIN handles the case where utat is missing (rare; pre-recorder
-- backfill events).
--
-- CONCURRENT-refresh contract: UNIQUE index over (audience, channel_group,
-- day, COALESCE(org_id, ...), stage_in, stage_out).
--
-- Migration timestamp: 20271102000009 (continuation of 20271102* range).

create materialized view public.traffic_funnel_rollup as
with stage_pairs (audience, funnel, stage_in, stage_out, event_in, event_out, stage_order) as (
  values
    ('consumer'::text,    'consumer'::text,    'visit'::text,                  'signup'::text,                  'traffic_visit'::text,         'traffic_signup'::text,             1),
    ('consumer',          'consumer',          'signup',                       'activation',                    'traffic_signup',              'activation_event',                 2),
    ('consumer',          'consumer',          'activation',                   'paid',                          'activation_event',            'paid',                             3),
    ('clinic-org',        'clinic-org',        'visit',                        'clinic_signup',                 'traffic_visit',               'clinic_signup',                    1),
    ('clinic-org',        'clinic-org',        'clinic_signup',                'first_patient_added',           'clinic_signup',               'first_patient_added',              2),
    ('clinic-org',        'clinic-org',        'first_patient_added',          'first_paid_seat',               'first_patient_added',         'first_paid_seat',                  3),
    ('affiliate',         'affiliate',         'visit',                        'affiliate_signup',              'traffic_visit',               'affiliate_signup',                 1),
    ('affiliate',         'affiliate',         'affiliate_signup',             'first_referral_conversion',     'affiliate_signup',            'first_referral_conversion',        2)
)
select
  sp.audience,
  utat.last_touch_channel_group as channel_group,
  date_trunc('day', em_in.created_at)::date as day,
  utat.org_id,
  sp.funnel,
  sp.stage_in,
  sp.stage_out,
  count(distinct em_in.distinct_id) as in_count,
  count(distinct em_out.distinct_id) as out_count,
  case
    when count(distinct em_in.distinct_id) > 0
      then count(distinct em_out.distinct_id)::numeric / count(distinct em_in.distinct_id)::numeric
  end as rate
from stage_pairs sp
cross join lateral (
  -- Distinct (distinct_id, created_at) rows per stage_in event. We pick the
  -- earliest created_at per distinct_id so the "stage_out >= stage_in" window
  -- semantic is well-defined.
  select em.distinct_id, min(em.created_at) as created_at
  from public.events_mirror em
  where em.event_name = sp.event_in
  group by em.distinct_id
) em_in
left join public.events_mirror em_out
  on em_out.distinct_id = em_in.distinct_id
 and em_out.event_name  = sp.event_out
 and em_out.created_at >= em_in.created_at
-- REVIEW WR-07 fix: lateral-pick the SINGLE most-recent utat row keyed by
-- em_in.distinct_id (covers both pre-stitch anon_id matches and post-stitch
-- user_id::text matches). Previous OR-join multiplied the in_count and
-- out_count per channel_group when a user had N anon_ids, inflating the
-- per-channel funnel breakdown. Top-of-page funnel chart (sum across
-- channel_groups) was over-estimating in_count/out_count by the same factor.
left join lateral (
  select u.last_touch_channel_group, u.org_id, u.last_touch_at
  from public.user_traffic_attribution u
  where u.user_id::text = em_in.distinct_id
     or u.anon_id        = em_in.distinct_id
  order by u.last_touch_at desc
  limit 1
) utat on true
group by 1, 2, 3, 4, 5, 6, 7;

create unique index traffic_funnel_rollup_uq
  on public.traffic_funnel_rollup (
    audience,
    (coalesce(channel_group, '')),
    day,
    (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    stage_in,
    stage_out
  );

comment on materialized view public.traffic_funnel_rollup is
  'Phase 51 / D-14 / D-05 — Per-audience funnel stage_pair rollup. Three audience funnels enumerated via stage_pairs VALUES list. Day is the day of stage_in. Read via get_traffic_funnel_rollup SECDEF accessor.';
