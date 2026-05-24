-- Phase 39 Plan 39-01 — pgTAP RLS proof: pharma_content_versions append-only.
--
-- Proves (T-39-01-02 mitigation):
--   1. pharma_content_versions has exactly 1 SELECT policy (admin-only);
--      NO INSERT/UPDATE/DELETE policies present — append-only via SECDEF RPC.
--   2. RLS is enabled on the table.
--   3. Admin SELECT policy gates on is_admin_at_least (admin-facing audit log).
--   4. No write policies present → INSERT/UPDATE/DELETE all denied by default
--      (even for admin browsers; writes flow only through future SECDEF RPC
--      which bypasses RLS).
--
-- Named dollar-quote tags. begin/rollback wrapper leaves zero DB residue.

begin;

select plan(4);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: Exactly 1 RLS policy — only the admin SELECT
-- ──────────────────────────────────────────────────────────────────────────────

select policies_are(
  'public',
  'pharma_content_versions',
  array['pol_pharma_content_versions_admin_select'],
  'pharma_content_versions has exactly the admin SELECT policy '
  '(append-only: no INSERT/UPDATE/DELETE policies — T-39-01-02)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: RLS is enabled on the table
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select relrowsecurity
      from pg_class
     where relname = 'pharma_content_versions'
       and relnamespace = 'public'::regnamespace
  ),
  'pharma_content_versions has row-level security enabled'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: SELECT policy gates on is_admin_at_least
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'pharma_content_versions'
       and policyname = 'pol_pharma_content_versions_admin_select'
       and cmd = 'SELECT'
       and roles = '{authenticated}'::name[]
       and qual like '%is_admin_at_least%'
  ),
  'pharma_content_versions admin SELECT policy gates on is_admin_at_least'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4: NO write policies — UPDATE + DELETE denied for ALL roles
-- (including admin). T-39-01-02 append-only mitigation; writes flow only
-- through SECDEF RPC (Wave 2/3) which bypasses RLS.
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 0
      from pg_policies
     where schemaname = 'public'
       and tablename = 'pharma_content_versions'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'pharma_content_versions has NO INSERT/UPDATE/DELETE/ALL policies — '
  'append-only enforced via denial-by-default (T-39-01-02)'
);

select * from finish();

rollback;
