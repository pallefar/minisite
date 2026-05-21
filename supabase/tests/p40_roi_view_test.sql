-- Phase 40 Plan 40-06 — pgTAP test for v_cancellation_offers_roi VIEW.
--
-- Seeds 10 cancellation_offers_log rows across 2 cohorts × 4 offer_types
-- × mixed statuses, plus 1 clinic-org row to verify exclusion.
--
-- Run: supabase db query --linked --file supabase/tests/p40_roi_view_test.sql

begin;

select plan(8);

-- ── Seed helpers ─────────────────────────────────────────────────────────────
-- Use a fixed synthetic user_id + subscription_id that won't collide with real data.
-- profile/subscription must exist for FK checks; use existing rows or service-role bypass.
-- Since this test runs via --linked / supabase test db (service-role context), we can
-- insert without FK conflicts only if we use do-nothing FKs.
-- Safest: use SET session_replication_role = replica to bypass FK checks during seed.

set session_replication_role = replica;

-- Cleanup from any prior run (idempotent).
delete from public.cancellation_offers_log
  where posthog_variant_id = '__p40_roi_test__';

-- ── Cohort A seed rows (org_id IS NULL → should appear in view) ──────────────
-- Row 1: discount / offered (shown but no response) — cohort_A, 30-180d
insert into public.cancellation_offers_log
  (user_id, org_id, subscription_id, reason, offer_type, offer_config,
   cohort_snapshot, tenure_bucket, status, posthog_variant_id)
values
  -- Row 1: discount / offered
  (gen_random_uuid(), null, 'sub_test001',
   'too_expensive', 'discount',
   '{"percent_off": 25, "coupon_id": "SAVE-25-3MO", "duration_in_months": 3}'::jsonb,
   '{"cohort_id": "cohort_A"}'::jsonb,
   '30-180d', 'offered', '__p40_roi_test__'),
  -- Row 2: discount / accepted — cohort_A, 30-180d
  (gen_random_uuid(), null, 'sub_test002',
   'too_expensive', 'discount',
   '{"percent_off": 25, "coupon_id": "SAVE-25-3MO", "duration_in_months": 3}'::jsonb,
   '{"cohort_id": "cohort_A"}'::jsonb,
   '30-180d', 'accepted', '__p40_roi_test__'),
  -- Row 3: discount / declined — cohort_A, 30-180d
  (gen_random_uuid(), null, 'sub_test003',
   'too_expensive', 'discount',
   '{"percent_off": 25, "coupon_id": "SAVE-25-3MO", "duration_in_months": 3}'::jsonb,
   '{"cohort_id": "cohort_A"}'::jsonb,
   '30-180d', 'declined', '__p40_roi_test__'),
  -- Row 4: pause / accepted — cohort_A, <30d
  (gen_random_uuid(), null, 'sub_test004',
   'temporary_break', 'pause',
   '{"pause_months": 2}'::jsonb,
   '{"cohort_id": "cohort_A"}'::jsonb,
   '<30d', 'accepted', '__p40_roi_test__'),
  -- Row 5: extended_trial / offered — cohort_B, 30-180d
  (gen_random_uuid(), null, 'sub_test005',
   'not_using', 'extended_trial',
   '{"extension_days": 14}'::jsonb,
   '{"cohort_id": "cohort_B"}'::jsonb,
   '30-180d', 'offered', '__p40_roi_test__'),
  -- Row 6: downgrade / offered — cohort_B, >180d
  (gen_random_uuid(), null, 'sub_test006',
   'found_alternative', 'downgrade',
   '{"target": "price_monthly"}'::jsonb,
   '{"cohort_id": "cohort_B"}'::jsonb,
   '>180d', 'offered', '__p40_roi_test__'),
  -- Row 7: downgrade / accepted — cohort_B, >180d
  (gen_random_uuid(), null, 'sub_test007',
   'found_alternative', 'downgrade',
   '{"target": "price_monthly"}'::jsonb,
   '{"cohort_id": "cohort_B"}'::jsonb,
   '>180d', 'accepted', '__p40_roi_test__'),
  -- Row 8: pause / offered — cohort_B, <30d
  (gen_random_uuid(), null, 'sub_test008',
   'temporary_break', 'pause',
   '{"pause_months": 1}'::jsonb,
   '{"cohort_id": "cohort_B"}'::jsonb,
   '<30d', 'offered', '__p40_roi_test__'),
  -- Row 9: discount / offered — cohort_A, <30d (different tenure bucket)
  (gen_random_uuid(), null, 'sub_test009',
   'too_expensive', 'discount',
   '{"percent_off": 20, "coupon_id": "SAVE-20-2MO", "duration_in_months": 2}'::jsonb,
   '{"cohort_id": "cohort_A"}'::jsonb,
   '<30d', 'offered', '__p40_roi_test__'),
  -- Row 10: extended_trial / declined — cohort_B, 30-180d
  (gen_random_uuid(), null, 'sub_test010',
   'health_goals_changed', 'extended_trial',
   '{"extension_days": 30}'::jsonb,
   '{"cohort_id": "cohort_B"}'::jsonb,
   '30-180d', 'declined', '__p40_roi_test__');

-- ── Clinic-org row (org_id IS NOT NULL → EXCLUDED from view) ─────────────────
insert into public.cancellation_offers_log
  (user_id, org_id, subscription_id, reason, offer_type, offer_config,
   cohort_snapshot, tenure_bucket, status, posthog_variant_id)
values
  (gen_random_uuid(), gen_random_uuid(), 'sub_test_clinic',
   'too_expensive', 'discount',
   '{"percent_off": 20, "coupon_id": "SAVE-20-2MO", "duration_in_months": 2}'::jsonb,
   '{"cohort_id": "clinic_cohort"}'::jsonb,
   '30-180d', 'accepted', '__p40_roi_test__');

reset session_replication_role;

-- ── Tests ─────────────────────────────────────────────────────────────────────

-- Test 1: View exists (is_view)
select has_view(
  'public', 'v_cancellation_offers_roi',
  'view public.v_cancellation_offers_roi exists'
);

-- Test 2: Clinic-org row (org_id IS NOT NULL) is excluded from the view.
-- The clinic_cohort cohort_id should not appear in the view output for our test variant.
select is(
  (
    select count(*)::int
    from public.v_cancellation_offers_roi
    where cohort_id = 'clinic_cohort'
      and posthog_variant_id = '__p40_roi_test__'
  ),
  0,
  'clinic-org rows (org_id IS NOT NULL) are excluded from v_cancellation_offers_roi'
);

-- Test 3: cohort_A, discount, 30-180d — shown_count = 2 (rows 1 + 2 are offered;
-- row 3 is declined but still counted in 'offered' filter... wait:
-- Actually, row 1 status='offered', row 2 status='accepted', row 3 status='declined'.
-- shown_count = count(*) filter (where status = 'offered') = 1 (row 1 only).
-- The group is (cohort_A, discount, 30-180d, null posthog_variant_id).
-- So shown_count=1, accepted_count=1, declined_count=1.
select is(
  (
    select shown_count::int
    from public.v_cancellation_offers_roi
    where cohort_id = 'cohort_A'
      and offer_type = 'discount'
      and tenure_bucket = '30-180d'
      and posthog_variant_id = '__p40_roi_test__'
  ),
  1,
  'cohort_A discount 30-180d: shown_count = 1 (status=offered rows)'
);

-- Test 4: accepted_count for cohort_A, discount, 30-180d = 1 (row 2)
select is(
  (
    select accepted_count::int
    from public.v_cancellation_offers_roi
    where cohort_id = 'cohort_A'
      and offer_type = 'discount'
      and tenure_bucket = '30-180d'
      and posthog_variant_id = '__p40_roi_test__'
  ),
  1,
  'cohort_A discount 30-180d: accepted_count = 1'
);

-- Test 5: declined_count for cohort_A, discount, 30-180d = 1 (row 3)
select is(
  (
    select declined_count::int
    from public.v_cancellation_offers_roi
    where cohort_id = 'cohort_A'
      and offer_type = 'discount'
      and tenure_bucket = '30-180d'
      and posthog_variant_id = '__p40_roi_test__'
  ),
  1,
  'cohort_A discount 30-180d: declined_count = 1'
);

-- Test 6: deferred_mrr_cents_est for cohort_A, discount, 30-180d.
-- Row 2 is accepted, offer_type='discount', percent_off=25 → 25 * 12.99 = 324.75.
select is(
  (
    select deferred_mrr_cents_est::numeric
    from public.v_cancellation_offers_roi
    where cohort_id = 'cohort_A'
      and offer_type = 'discount'
      and tenure_bucket = '30-180d'
      and posthog_variant_id = '__p40_roi_test__'
  ),
  324.75::numeric,
  'cohort_A discount 30-180d: deferred_mrr_cents_est = 324.75 (25 * 12.99)'
);

-- Test 7: downgrade / accepted does NOT contribute to deferred_mrr_cents_est
-- (only pause, discount, extended_trial contribute per view formula).
-- Row 7: downgrade / accepted — should have deferred_mrr_cents_est = 0.
select is(
  (
    select deferred_mrr_cents_est::numeric
    from public.v_cancellation_offers_roi
    where cohort_id = 'cohort_B'
      and offer_type = 'downgrade'
      and tenure_bucket = '>180d'
      and posthog_variant_id = '__p40_roi_test__'
  ),
  0::numeric,
  'downgrade accepted rows do not contribute to deferred_mrr_cents_est'
);

-- Test 8: Total non-clinic view groups = 6.
-- All 10 seeded rows share the same offered_day (now()), so they group into:
--   cohort_A / discount / 30-180d  (rows 1+2+3)
--   cohort_A / pause   / <30d      (row 4)
--   cohort_A / discount/ <30d      (row 9)
--   cohort_B / extended_trial / 30-180d  (rows 5+10)
--   cohort_B / downgrade / >180d   (rows 6+7)
--   cohort_B / pause   / <30d      (row 8)
-- = 6 distinct groups. Clinic row excluded.
select is(
  (
    select count(*)::int
    from public.v_cancellation_offers_roi
    where posthog_variant_id = '__p40_roi_test__'
  ),
  6,
  '6 distinct groups visible in v_cancellation_offers_roi (clinic row excluded)'
);

select * from finish();
rollback;
