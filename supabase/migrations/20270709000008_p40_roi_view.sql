-- Phase 40 Plan 40-06 — POLISH-02: Admin ROI dashboard view.
--
-- Creates the `v_cancellation_offers_roi` plain SQL VIEW over
-- `cancellation_offers_log`. Plain view (NOT materialized) chosen per
-- RESEARCH §ROI Analytics Architecture: acceptable at v1.3 scale.
--
-- Matview migration threshold (document inline per plan spec):
--   p95 query latency > 500ms  OR  row count > 10,000
--   See 40-RESEARCH §ROI Analytics Architecture for full decision rationale.
--
-- RLS: this view inherits the base-table RLS policy from
-- cancellation_offers_log (admin-only SELECT). No separate SECDEF wrapper
-- required per PATTERNS §11 — non-admin callers receive an empty result set.
--
-- Exclusion: `where org_id is null` excludes clinic-org cancellations per
-- RESEARCH Open Q3 — clinic CSM-contact cancellations use variable per-patient
-- billing math and are counted separately in v1.3.
--
-- Timestamp: 20270709000008 — immediately after 40-07 per wave-3 dispatch.

-- ============================================================
-- VIEW: public.v_cancellation_offers_roi
-- ============================================================

create or replace view public.v_cancellation_offers_roi as
select
  date_trunc('day', offered_at)                               as offered_day,
  offer_type,
  cohort_snapshot ->> 'cohort_id'                             as cohort_id,
  tenure_bucket,
  posthog_variant_id,
  count(*) filter (where status = 'offered')                  as shown_count,
  count(*) filter (where status = 'accepted')                 as accepted_count,
  count(*) filter (where status = 'declined')                 as declined_count,
  sum(
    case
      when status = 'accepted'
       and offer_type in ('discount', 'pause', 'extended_trial')
      then coalesce((offer_config ->> 'percent_off')::numeric, 0) * 12.99
      else 0
    end
  )                                                           as deferred_mrr_cents_est
from public.cancellation_offers_log
where org_id is null
  -- v1.3 excludes clinic-org per RESEARCH Open Q3
  -- (clinic-CSM counted separately due to variable per-patient billing math)
group by
  date_trunc('day', offered_at),
  offer_type,
  cohort_snapshot ->> 'cohort_id',
  tenure_bucket,
  posthog_variant_id;

comment on view public.v_cancellation_offers_roi is
  'Phase 40 ROI. Matview migration threshold: p95 > 500ms OR row count > 10000 — see 40-RESEARCH §ROI Analytics Architecture.';
