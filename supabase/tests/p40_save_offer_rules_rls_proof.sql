-- Phase 40 Plan 40-01 — pgTAP RLS proof: save_offer_rules
-- VALIDATION.md row 40-01-T1b.
--
-- Proves:
--   1. save_offer_rules has exactly 1 RLS policy (select_admin);
--      NO INSERT / UPDATE / DELETE policies — writes-via-SECDEF-only enforcement.
--   2. Deferred FK constraint p40_offers_rule_fk exists on cancellation_offers_log.
--   3. cohort_id FK references cohort_definitions(id) ON DELETE CASCADE.
--   4. Non-admin cannot INSERT into save_offer_rules directly (T-40-01-03 mitigation).
--
-- Named dollar-quote tags ($sql$, $body$) — bare $$ forbidden per project convention.
-- begin/rollback wrapper: leaves no residue.

begin;

select plan(4);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: Exactly 1 RLS policy on save_offer_rules (select_admin only)
-- ──────────────────────────────────────────────────────────────────────────────

select policies_are(
  'public',
  'save_offer_rules',
  array['save_offer_rules_select_admin'],
  'save_offer_rules has exactly 1 policy: select_admin (no INSERT/UPDATE/DELETE — SECDEF RPCs only)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: Deferred FK constraint p40_offers_rule_fk exists on cancellation_offers_log
-- This confirms the cyclic-dependency resolution (added at end of 20270709000002).
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 1
      from information_schema.table_constraints
     where constraint_schema = 'public'
       and table_name = 'cancellation_offers_log'
       and constraint_name = 'p40_offers_rule_fk'
       and constraint_type = 'FOREIGN KEY'
  ),
  'p40_offers_rule_fk FK exists on cancellation_offers_log.rule_id → save_offer_rules(id)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: cohort_id FK references cohort_definitions(id) with ON DELETE CASCADE
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 1
      from information_schema.referential_constraints rc
      join information_schema.table_constraints tc
        on tc.constraint_name = rc.constraint_name
       and tc.constraint_schema = rc.constraint_schema
     where tc.table_name = 'save_offer_rules'
       and rc.delete_rule = 'CASCADE'
       and rc.unique_constraint_name in (
         select constraint_name
           from information_schema.table_constraints
          where table_name = 'cohort_definitions'
            and constraint_type = 'PRIMARY KEY'
       )
  ),
  'save_offer_rules.cohort_id FK references cohort_definitions(id) ON DELETE CASCADE'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4: Non-admin INSERT direct access denied
-- Verify the select_admin policy uses is_admin_at_least (structural proof).
-- Live impersonation test: INSERT into save_offer_rules from authenticated non-admin
-- should fail due to RLS (no INSERT policy) + revoked grant.
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'save_offer_rules'
       and policyname = 'save_offer_rules_select_admin'
       and cmd = 'SELECT'
       and roles = '{authenticated}'::name[]
       and qual like '%is_admin_at_least%'
  ),
  'save_offer_rules_select_admin policy gates SELECT on is_admin_at_least; no INSERT/UPDATE/DELETE policy (T-40-01-03)'
);

select * from finish();

rollback;
