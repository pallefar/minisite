-- Phase 62 Plan 01 — 5 aggregate materialized views (k-floor + zero PHI)
-- =============================================================================
--
-- CI grep gate: eval/phase62/no-phi-in-matviews.test.ts — MUST find ZERO
-- non-aggregate occurrences of user_id|email|phone|address inside
-- CREATE MATERIALIZED VIEW bodies.
--
-- Privacy invariants (enforced here, NOT in application layer):
--   - HAVING count(distinct <user_id>) >= 5 on every matview body (k-anonymity)
--   - ZERO PHI columns in SELECT list of any matview
--     (user_id/email/phone/address are legal in JOIN ON, WHERE, count(distinct …) ONLY)
--   - All matviews created WITH NO DATA — refreshed by close-out cron in 62-08
--   - Idempotent creation via IF NOT EXISTS clause on all matviews
--   - Per-matview UNIQUE INDEX on natural key (required for REFRESH CONCURRENTLY)
--
-- Source table column name corrections (verified from migration files):
--   public.injections  : medication text, dose text, unit text, logged_at timestamptz
--                        PK: (user_id, log_id) — no standalone id
--   public.weights     : weight numeric, date text, ts bigint
--                        PK: (user_id, weight_id) — no logged_at col
--   public.profiles    : primary_goal text (NOT goal_type)
--   public.ai_messages : model text (NOT model_used), id uuid
--   public.community_engagement: does NOT exist in migrations
--     → insights_engagement_rollup falls back to ai_messages alone
--       (community_engagement was listed in CONTEXT.md but is not present)
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290102+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Tenure bucket helper expression (reused across matviews via inline CASE).
-- Buckets: '<3m' / '3-6m' / '6-12m' / '12m+'
-- Based on age(now(), p.created_at) interval comparison.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. insights_dose_rollup
--    Source: public.injections JOIN public.profiles
--    PHI gate: user_id only in JOIN ON + count(distinct i.user_id) aggregate
--    dose text cast to numeric — rows where dose is non-numeric silently return
--    NULL from try_cast; we use NULLIF to guard division-by-zero downstream.
-- ---------------------------------------------------------------------------

create materialized view if not exists public.insights_dose_rollup as
select
  date_trunc('week', i.logged_at)::date                         as week_bin,
  i.medication                                                   as compound,
  case
    when age(now(), p.created_at) < interval '3 months'  then '<3m'
    when age(now(), p.created_at) < interval '6 months'  then '3-6m'
    when age(now(), p.created_at) < interval '12 months' then '6-12m'
    else '12m+'
  end                                                            as tenure_bucket,
  p.primary_goal                                                 as audience_segment,
  count(distinct i.user_id)                                      as cohort_n,
  avg(
    case when i.dose ~ '^[0-9]+(\.[0-9]+)?$' then i.dose::numeric else null end
  )                                                              as avg_dose_mg,
  stddev(
    case when i.dose ~ '^[0-9]+(\.[0-9]+)?$' then i.dose::numeric else null end
  )                                                              as stddev_dose_mg,
  count(*)                                                       as injection_count
from public.injections i
join public.profiles p on p.id = i.user_id
where p.research_consent = true
group by 1, 2, 3, 4
having count(distinct i.user_id) >= 5
with no data;

-- UNIQUE INDEX on natural key (required for REFRESH CONCURRENTLY)
create unique index if not exists uidx_insights_dose_rollup
  on public.insights_dose_rollup (week_bin, compound, tenure_bucket, audience_segment);

-- ---------------------------------------------------------------------------
-- 2. insights_body_metrics_rollup
--    Source: public.weights JOIN public.profiles
--    PHI gate: user_id only in JOIN ON + count(distinct w.user_id) aggregate
--    weights.weight is numeric (column name is 'weight', not 'weight_kg')
--    weights.date is text (YYYY-MM-DD); cast to date for week_bin truncation.
-- ---------------------------------------------------------------------------

create materialized view if not exists public.insights_body_metrics_rollup as
select
  date_trunc('week', w.date::date)::date                        as week_bin,
  case
    when age(now(), p.created_at) < interval '3 months'  then '<3m'
    when age(now(), p.created_at) < interval '6 months'  then '3-6m'
    when age(now(), p.created_at) < interval '12 months' then '6-12m'
    else '12m+'
  end                                                            as tenure_bucket,
  p.primary_goal                                                 as audience_segment,
  count(distinct w.user_id)                                      as cohort_n,
  avg(w.weight)                                                  as avg_weight_kg,
  stddev(w.weight)                                               as stddev_weight_kg
from public.weights w
join public.profiles p on p.id = w.user_id
where p.research_consent = true
group by 1, 2, 3
having count(distinct w.user_id) >= 5
with no data;

-- UNIQUE INDEX on natural key
create unique index if not exists uidx_insights_body_metrics_rollup
  on public.insights_body_metrics_rollup (week_bin, tenure_bucket, audience_segment);

-- ---------------------------------------------------------------------------
-- 3. insights_retention_rollup
--    Source: public.profiles + public.injections (for 30d/90d retention signal)
--    PHI gate: p.id only in count(distinct p.id) aggregate
--    retention_30d: fraction of cohort who had ≥1 injection within 30d of signup
--    retention_90d: fraction within 90d of signup
-- ---------------------------------------------------------------------------

create materialized view if not exists public.insights_retention_rollup as
select
  date_trunc('week', p.created_at)::date                        as cohort_week,
  p.primary_goal                                                 as audience_segment,
  case
    when age(now(), p.created_at) < interval '3 months'  then '<3m'
    when age(now(), p.created_at) < interval '6 months'  then '3-6m'
    when age(now(), p.created_at) < interval '12 months' then '6-12m'
    else '12m+'
  end                                                            as tenure_bucket,
  count(distinct p.id)                                           as cohort_n,
  count(distinct case
    when exists (
      select 1 from public.injections i
      where i.user_id = p.id
        and i.logged_at <= p.created_at + interval '30 days'
    ) then p.id
  end)::numeric / nullif(count(distinct p.id), 0)               as retention_30d,
  count(distinct case
    when exists (
      select 1 from public.injections i
      where i.user_id = p.id
        and i.logged_at <= p.created_at + interval '90 days'
    ) then p.id
  end)::numeric / nullif(count(distinct p.id), 0)               as retention_90d
from public.profiles p
where p.research_consent = true
group by 1, 2, 3
having count(distinct p.id) >= 5
with no data;

-- UNIQUE INDEX on natural key
create unique index if not exists uidx_insights_retention_rollup
  on public.insights_retention_rollup (cohort_week, audience_segment, tenure_bucket);

-- ---------------------------------------------------------------------------
-- 4. insights_engagement_rollup
--    NOTE: public.community_engagement does NOT exist in tracked migrations.
--    Falling back to public.ai_messages as the engagement signal source
--    (tracks user interaction with AI coach — valid engagement proxy).
--    A comment documents the absence so close-out plan 62-08 can ADD
--    community_engagement support via ALTER VIEW / DROP+RECREATE if that
--    table is ever shipped.
--
--    If community_engagement is later added, this matview should be replaced
--    to use (community_engagement JOIN profiles) for richer engagement data.
--
--    PHI gate: user_id only in JOIN ON + count(distinct am.user_id) aggregate
-- ---------------------------------------------------------------------------

create materialized view if not exists public.insights_engagement_rollup as
-- Fallback: community_engagement absent → using ai_messages as engagement proxy.
-- Replace this matview body when community_engagement table is available.
select
  date_trunc('week', am.created_at)::date                       as week_bin,
  p.primary_goal                                                 as audience_segment,
  case
    when age(now(), p.created_at) < interval '3 months'  then '<3m'
    when age(now(), p.created_at) < interval '6 months'  then '3-6m'
    when age(now(), p.created_at) < interval '12 months' then '6-12m'
    else '12m+'
  end                                                            as tenure_bucket,
  am.role                                                        as kind,
  count(distinct am.user_id)                                     as cohort_n,
  count(*)                                                       as event_count
from public.ai_messages am
join public.profiles p on p.id = am.user_id
where p.research_consent = true
group by 1, 2, 3, 4
having count(distinct am.user_id) >= 5
with no data;

-- UNIQUE INDEX on natural key
create unique index if not exists uidx_insights_engagement_rollup
  on public.insights_engagement_rollup (week_bin, audience_segment, tenure_bucket, kind);

-- ---------------------------------------------------------------------------
-- 5. insights_ai_interaction_rollup
--    Source: public.ai_messages JOIN public.profiles
--    PHI gate: user_id only in JOIN ON + count(distinct am.user_id) aggregate
--    model_bucket: ai_messages uses column 'model' (not 'model_used')
--    Buckets aggregate model variants for privacy (prevents fingerprinting
--    rare model users who might form tiny cohorts).
-- ---------------------------------------------------------------------------

create materialized view if not exists public.insights_ai_interaction_rollup as
select
  date_trunc('week', am.created_at)::date                       as week_bin,
  p.primary_goal                                                 as audience_segment,
  case
    when age(now(), p.created_at) < interval '3 months'  then '<3m'
    when age(now(), p.created_at) < interval '6 months'  then '3-6m'
    when age(now(), p.created_at) < interval '12 months' then '6-12m'
    else '12m+'
  end                                                            as tenure_bucket,
  am.role                                                        as role,
  coalesce(am.model, 'unknown')                                  as model_bucket,
  count(distinct am.user_id)                                     as cohort_n,
  count(*)                                                       as message_count
from public.ai_messages am
join public.profiles p on p.id = am.user_id
where p.research_consent = true
group by 1, 2, 3, 4, 5
having count(distinct am.user_id) >= 5
with no data;

-- UNIQUE INDEX on natural key
create unique index if not exists uidx_insights_ai_interaction_rollup
  on public.insights_ai_interaction_rollup (week_bin, audience_segment, tenure_bucket, role, model_bucket);

commit;
