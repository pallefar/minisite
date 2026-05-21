-- Phase 40 Plan 40-01 — pgTAP RLS proof: cancellation_offers_log
-- VALIDATION.md row 40-01-T1a.
--
-- Proves:
--   1. cancellation_offers_log has exactly 2 RLS policies (select_admin + service_insert);
--      NO UPDATE / DELETE policies — negative-space append-only enforcement.
--   2. Defense-in-depth trigger blocks UPDATE on any row.
--   3. Defense-in-depth trigger blocks DELETE on any row.
--   4. Cross-tenant impersonation: cancellation_offers_log_select_admin policy
--      is configured on is_admin_at_least — protects cross-tenant leakage (T-40-01-02).
--
-- Named dollar-quote tags ($sql$, $body$) — bare $$ forbidden per project convention.
-- begin/rollback wrapper: leaves no residue on the DB.

begin;

select plan(4);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: Exactly 2 RLS policies — no more, no less
-- ──────────────────────────────────────────────────────────────────────────────

select policies_are(
  'public',
  'cancellation_offers_log',
  array['cancellation_offers_log_select_admin', 'cancellation_offers_log_service_insert'],
  'cancellation_offers_log has exactly select_admin + service_insert policies (no UPDATE/DELETE — append-only)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: Defense-in-depth trigger blocks UPDATE
-- Insert a throwaway row (rolled back at end of transaction), then attempt UPDATE.
-- ──────────────────────────────────────────────────────────────────────────────

do $body$
declare
  test_id uuid;
begin
  insert into public.cancellation_offers_log (
    reason, offer_type, tenure_bucket, status
  )
  values (
    'too_expensive', 'discount', '<30d', 'offered'
  )
  returning id into test_id;
  perform set_config('p40_rls_test.row_id', test_id::text, true);
end
$body$;

select throws_ok(
  $sql$
    update public.cancellation_offers_log
       set status = 'accepted'
     where id = current_setting('p40_rls_test.row_id')::uuid
  $sql$,
  null,
  'append_only_table',
  'defense-in-depth trigger blocks UPDATE on cancellation_offers_log'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: Defense-in-depth trigger blocks DELETE
-- ──────────────────────────────────────────────────────────────────────────────

select throws_ok(
  $sql$
    delete from public.cancellation_offers_log
     where id = current_setting('p40_rls_test.row_id')::uuid
  $sql$,
  null,
  'append_only_table',
  'defense-in-depth trigger blocks DELETE on cancellation_offers_log'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4: Cross-tenant SELECT isolation
-- Assert that the select_admin policy is configured to filter by is_admin_at_least,
-- preventing non-admin authenticated users from reading any rows (T-40-01-02).
-- ──────────────────────────────────────────────────────────────────────────────

select ok(
  (
    select count(*) = 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'cancellation_offers_log'
       and policyname = 'cancellation_offers_log_select_admin'
       and cmd = 'SELECT'
       and roles = '{authenticated}'::name[]
       and qual like '%is_admin_at_least%'
  ),
  'cancellation_offers_log_select_admin policy gates SELECT on is_admin_at_least — cross-tenant isolation enforced (T-40-01-02)'
);

select * from finish();

rollback;
