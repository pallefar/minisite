-- Phase 35 — pgTAP RLS proof: xp_ledger append-only + select-own.
-- VALIDATION.md row 35-01-04 (GAME-01, T-35-01-01, T-35-01-04).
--
-- Proves:
--   1. xp_ledger has exactly 2 RLS policies (select-own + service-insert);
--      NO UPDATE / DELETE policies — negative-space append-only enforcement.
--   2. Defense-in-depth append-only trigger blocks UPDATE at the row level.
--   3. Defense-in-depth append-only trigger blocks DELETE at the row level.
--   4. compute_level is IMMUTABLE (provolatile = 'i') per D-04.
--
-- Named dollar-quote tags ($sql$) — bare $$ forbidden per project convention.
-- begin/rollback wrapper: leaves no residue.

begin;

select plan(4);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: xp_ledger has exactly these two policies — no more, no less.
-- policies_are() from pgTAP asserts the policy name list exactly.
-- ──────────────────────────────────────────────────────────────────────────────

select policies_are(
  'public',
  'xp_ledger',
  array['xp_ledger_select_own', 'xp_ledger_service_insert'],
  'xp_ledger has exactly select-own + service-insert policies (no UPDATE/DELETE policies — append-only)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: Defense-in-depth trigger blocks UPDATE on xp_ledger
-- throws_ok(sql, errcode, errmsg, description)
-- WHERE FALSE ensures no rows are actually locked — just fires the trigger path check.
-- Note: PostgreSQL raises the trigger even for UPDATE ... WHERE false when the
-- BEFORE trigger fires on the statement (FOR EACH ROW does not fire if no rows match).
-- We use a subquery INSERT to ensure at least one row exists for the trigger to fire.
-- ──────────────────────────────────────────────────────────────────────────────

do $body$
declare
  test_id uuid;
begin
  -- Insert a throwaway row (rolled back at end of transaction)
  insert into public.xp_ledger (user_id, action_type, xp_delta)
  values (gen_random_uuid(), 'injection_log', 25)
  returning id into test_id;
  perform set_config('p35_rls_test.row_id', test_id::text, true);
end
$body$;

select throws_ok(
  $sql$
    update public.xp_ledger
       set xp_delta = 999
     where id = current_setting('p35_rls_test.row_id')::uuid
  $sql$,
  null,
  'xp_ledger is append-only',
  'defense-in-depth trigger blocks UPDATE on xp_ledger'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: Defense-in-depth trigger blocks DELETE on xp_ledger
-- ──────────────────────────────────────────────────────────────────────────────

select throws_ok(
  $sql$
    delete from public.xp_ledger
     where id = current_setting('p35_rls_test.row_id')::uuid
  $sql$,
  null,
  'xp_ledger is append-only',
  'defense-in-depth trigger blocks DELETE on xp_ledger'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4: compute_level is IMMUTABLE (D-04 pgTAP marker)
-- provolatile = 'i' means IMMUTABLE in pg_proc catalog.
-- ──────────────────────────────────────────────────────────────────────────────

select is(
  (
    select provolatile
      from pg_proc
     where proname = 'compute_level'
       and pronamespace = 'public'::regnamespace
     limit 1
  ),
  'i'::char,
  'compute_level is IMMUTABLE (provolatile = ''i'') — D-04 determinism marker'
);

select * from finish();

rollback;
