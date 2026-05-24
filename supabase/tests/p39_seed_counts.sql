-- Phase 39 Plan 39-01 — pgTAP seed-count proof.
--
-- Proves seed counts shipped exactly per CONTEXT decisions:
--   1. cohort_definitions contains the 5 Phase 39 named cohorts (D-08).
--   2. utm_variant_map contains exactly the 4 D-09 seeded utm_source rows.
--   3. Each D-09 utm_source row has a non-null variant_id pointing at a
--      paywall-surface variant_config row.
--
-- begin/rollback wrapper — no DB residue. Note: we read the actual seeded
-- rows present (these are inserted at migration apply time, not test time),
-- so the counts reflect the production seed not test fixture data.

begin;

select plan(3);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: All 5 Phase 39 cohort names exist in cohort_definitions
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 5
      from public.cohort_definitions
     where name in ('free-user', 'past-due-3d', 'trial-day-3', 'trial-day-7', 'post-activation')
  ),
  'cohort_definitions contains exactly the 5 D-08 Phase 39 cohort names'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: All 4 D-09 utm_source rows exist in utm_variant_map
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 4
      from public.utm_variant_map
     where utm_source in ('lean', 'transformation', 'clinical', 'default')
  ),
  'utm_variant_map contains exactly the 4 D-09 utm_source rows '
  '(lean, transformation, clinical, default)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: Each D-09 utm_source row maps to a paywall-surface variant_config
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 4
      from public.utm_variant_map uvm
      join public.variant_config vc on vc.id = uvm.variant_id
     where uvm.utm_source in ('lean', 'transformation', 'clinical', 'default')
       and vc.surface = 'paywall'
  ),
  'All 4 D-09 utm_source rows reference a paywall-surface variant_config row'
);

select * from finish();

rollback;
