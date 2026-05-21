-- Phase 40 Plan 40-01 — pgTAP enum completeness check.
-- VALIDATION.md row 40-01-T2.
--
-- Proves that CHECK constraints on cancellation_offers_log declare ALL required values
-- for: status (6 values), offer_type (6 values), reason (7 values), tenure_bucket (3 values).
-- No later widening migration needed in Phase 40 (D-37-09-1 lesson compliance proof).
--
-- Named dollar-quote tags ($sql$) — bare $$ forbidden per project convention.
-- begin/rollback wrapper: leaves no residue.

begin;

select plan(4);

-- ──────────────────────────────────────────────────────────────────────────────
-- Helper: check CHECK constraint source text from pg_constraint catalog.
-- consrc contains the expression text; we verify all required values are present.
-- ──────────────────────────────────────────────────────────────────────────────

-- TEST 1: status CHECK declares all 6 values
select ok(
  (
    select
      consrc like '%offered%'
      and consrc like '%accepted%'
      and consrc like '%declined%'
      and consrc like '%expired%'
      and consrc like '%ineligible_lifetime_cap%'
      and consrc like '%ineligible_cooldown%'
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'cancellation_offers_log'
      and c.contype = 'c'
      and consrc like '%status%'
    limit 1
  ),
  'cancellation_offers_log.status CHECK declares all 6 values: offered, accepted, declined, expired, ineligible_lifetime_cap, ineligible_cooldown'
);

-- TEST 2: offer_type CHECK declares all 6 values
select ok(
  (
    select
      consrc like '%pause%'
      and consrc like '%discount%'
      and consrc like '%extended_trial%'
      and consrc like '%downgrade%'
      and consrc like '%contact_csm%'
      and consrc like '%none%'
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'cancellation_offers_log'
      and c.contype = 'c'
      and consrc like '%offer_type%'
    limit 1
  ),
  'cancellation_offers_log.offer_type CHECK declares all 6 values: pause, discount, extended_trial, downgrade, contact_csm, none'
);

-- TEST 3: reason CHECK declares all 7 values (D-18 verbatim)
select ok(
  (
    select
      consrc like '%too_expensive%'
      and consrc like '%not_using%'
      and consrc like '%found_alternative%'
      and consrc like '%health_goals_changed%'
      and consrc like '%temporary_break%'
      and consrc like '%service_quality_issue%'
      and consrc like '%other%'
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'cancellation_offers_log'
      and c.contype = 'c'
      and consrc like '%too_expensive%'
    limit 1
  ),
  'cancellation_offers_log.reason CHECK declares all 7 D-18 values: too_expensive, not_using, found_alternative, health_goals_changed, temporary_break, service_quality_issue, other'
);

-- TEST 4: tenure_bucket CHECK declares all 3 values
select ok(
  (
    select
      consrc like '%<30d%'
      and consrc like '%30-180d%'
      and consrc like '%>180d%'
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'cancellation_offers_log'
      and c.contype = 'c'
      and consrc like '%30d%'
    limit 1
  ),
  'cancellation_offers_log.tenure_bucket CHECK declares all 3 values: <30d, 30-180d, >180d'
);

select * from finish();

rollback;
