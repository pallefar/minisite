-- Phase 39 Plan 39-01 — pgTAP RLS proof: user_experiments cross-tenant denial.
--
-- Proves (T-39-01-01 mitigation):
--   1. user_experiments has exactly 1 SELECT policy
--      (pol_user_experiments_self_or_admin_select); NO INSERT/UPDATE/DELETE
--      policies — denial-by-default for direct writes (SECDEF RPC owns writes).
--   2. SELECT policy gates on user_id = auth.uid() OR is_admin_at_least —
--      cross-tenant impersonation by non-admin returns 0 rows.
--   3. RLS is enabled on the table (rowsecurity = true).
--
-- Pattern: mirrors p40_offers_log_rls_proof.sql shape (begin / plan / select
-- assertions / rollback). Named dollar-quote tags ($sql$, $body$). begin/rollback
-- leaves zero DB residue.

begin;

select plan(4);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: Exactly 1 RLS policy — only the self-or-admin SELECT
-- ──────────────────────────────────────────────────────────────────────────────

select policies_are(
  'public',
  'user_experiments',
  array['pol_user_experiments_self_or_admin_select'],
  'user_experiments has exactly the self_or_admin SELECT policy '
  '(no INSERT/UPDATE/DELETE — writes only through SECDEF RPC, Pattern S2)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: RLS is enabled on the table
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select relrowsecurity
      from pg_class
     where relname = 'user_experiments'
       and relnamespace = 'public'::regnamespace
  ),
  'user_experiments has row-level security enabled'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: SELECT policy qual references both auth.uid() ownership and
-- is_admin_at_least — cross-tenant impersonation gate (T-39-01-01).
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'user_experiments'
       and policyname = 'pol_user_experiments_self_or_admin_select'
       and cmd = 'SELECT'
       and roles = '{authenticated}'::name[]
       and qual like '%auth.uid()%'
       and qual like '%is_admin_at_least%'
  ),
  'SELECT policy gates on user_id = auth.uid() OR is_admin_at_least — '
  'cross-tenant impersonation enforced (T-39-01-01)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4: NO write policies present (denial-by-default for INSERT/UPDATE/DELETE).
-- Pattern S2 — writes flow only through SECDEF RPC.
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 0
      from pg_policies
     where schemaname = 'public'
       and tablename = 'user_experiments'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'user_experiments has NO INSERT/UPDATE/DELETE/ALL policies — '
  'denial-by-default; writes flow through SECDEF RPC only'
);

select * from finish();

rollback;
