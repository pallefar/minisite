-- Phase 35 D-04 — pgTAP determinism contract for xp_ledger + compute_level.
-- VALIDATION.md row 35-01-04 (GAME-01, T-35-01-04).
--
-- Proves: ledger replay against random sequences yields identical level
-- regardless of insert order (pure function, no side state).
--
-- Named dollar-quote tags ($body$, $sql$) — bare $$ forbidden per project convention.
-- begin/rollback wrapper: leaves no residue in the DB after test run.

begin;

select plan(8);

-- ──────────────────────────────────────────────────────────────────────────────
-- SETUP: insert 25-row random ledger sequences for two synthetic users.
-- User A: forward order. User B: reverse order.
-- Total XP: 25+25+10+50+100+25+25+250+25+50+25+10+50+100+25+25+10+25+250+25+50+25+100+25+10 = 1345
-- Both must produce identical level — proving compute_level is order-independent.
-- ──────────────────────────────────────────────────────────────────────────────

do $body$
declare
  uid_a  uuid  := gen_random_uuid();
  uid_b  uuid  := gen_random_uuid();
  deltas int[] := array[
    25, 25, 10, 50, 100, 25, 25, 250, 25, 50,
    25, 10, 50, 100, 25, 25, 10,  25, 250, 25,
    50, 25, 100, 25, 10
  ];  -- 25 rows, total = 1345 XP → level 3 (3²×100=900 ≤ 1345 < 4²×100=1600)
  i int;
begin
  -- Insert in forward order for user A
  for i in 1..array_length(deltas, 1) loop
    insert into public.xp_ledger (user_id, action_type, xp_delta)
      values (uid_a, 'injection_log', deltas[i]);
  end loop;

  -- Insert in reverse order for user B (same deltas, different sequence)
  for i in reverse array_length(deltas, 1)..1 loop
    insert into public.xp_ledger (user_id, action_type, xp_delta)
      values (uid_b, 'injection_log', deltas[i]);
  end loop;

  -- Store UUIDs in transaction-local config for retrieval by test assertions
  perform set_config('p35_test.uid_a', uid_a::text, true);
  perform set_config('p35_test.uid_b', uid_b::text, true);
end
$body$;

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: D-04 determinism — identical level regardless of insert order
-- ──────────────────────────────────────────────────────────────────────────────

select is(
  public.compute_level(public.xp_total_for(current_setting('p35_test.uid_a')::uuid)),
  public.compute_level(public.xp_total_for(current_setting('p35_test.uid_b')::uuid)),
  'D-04: ledger replay yields identical level regardless of insert order'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TESTS 2-8: D-02 locked spot-check values
-- These lock the quadratic level curve contract so any formula change fails fast.
-- ──────────────────────────────────────────────────────────────────────────────

select is(
  public.compute_level(0),
  1::int,
  'compute_level(0) = 1 (always at least level 1)'
);

select is(
  public.compute_level(100),
  1::int,
  'compute_level(100) = 1 (level 1 boundary; level 2 begins at 400)'
);

select is(
  public.compute_level(400),
  2::int,
  'compute_level(400) = 2 (D-02: 2²×100 = 400)'
);

select is(
  public.compute_level(2500),
  5::int,
  'compute_level(2500) = 5 (D-02: 5²×100 = 2500)'
);

select is(
  public.compute_level(10000),
  10::int,
  'compute_level(10000) = 10 (D-02: 10²×100 = 10000)'
);

select is(
  public.compute_level(40000),
  20::int,
  'compute_level(40000) = 20 (D-02: 20²×100 = 40000)'
);

select is(
  public.compute_prestige(1000000),
  1::int,
  'compute_prestige(1000000) = 1 (level 100 / 100 = prestige 1, D-03)'
);

select * from finish();

rollback;
-- All xp_ledger rows inserted above are rolled back; no residue.
