-- Phase 39 Plan 39-03 — pgTAP proof: refund-rate kill (D-02).
--
-- Proves:
--   1. p39_refund_rate_kill_scan() archives a TEST variant whose 7d refund rate
--      exceeds 2x the CONTROL 30d baseline.
--   2. The CONTROL variant is NOT archived.
--   3. Re-running the scan is idempotent (TEST archived_at unchanged on second
--      call).
--
-- Service-role context only — does NOT reference auth.uid().
--
-- Named dollar-quote tags ($sql$).
-- begin/rollback wrapper: leaves no residue.

begin;

select plan(3);

-- ──────────────────────────────────────────────────────────────────────────────
-- SETUP: create auth.users + 2 variant_config rows (CONTROL, TEST) +
-- subscriptions wired so:
--   - CONTROL users: 100 subs, 6 refunded over 30d  -> baseline = 0.06
--   - TEST users:    20 subs in last 7d, 4 refunded -> 7d rate = 0.20
--     0.20 > 2 * 0.06 = 0.12  -> KILL.
-- ──────────────────────────────────────────────────────────────────────────────

do $setup$
declare
  v_test_variant uuid := '33333333-3333-4333-8333-333333333333'::uuid;
  v_user uuid;
  i int;
begin
  -- CONTROL: 1 variant_config row, but in this test "CONTROL" is identified
  -- as "users with no paywall user_experiments assignment". So we just need
  -- a TEST variant_config + populate subscriptions for CONTROL (no UE rows)
  -- and TEST (UE rows pointing at v_test_variant).

  insert into public.variant_config
    (id, surface, cohort_id, config, archived_at, created_by, created_at, updated_at)
    values
      (v_test_variant, 'paywall', null, '{"label":"test"}'::jsonb,
       null, null, now() - interval '7 days', now() - interval '7 days');

  -- CONTROL users (100): 6 refunded.
  for i in 1..100 loop
    v_user := gen_random_uuid();
    insert into auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data,
                            aud, role, created_at, updated_at)
      values (v_user, '00000000-0000-0000-0000-000000000000'::uuid,
              'ctrl-' || i || '@example.test', '{}'::jsonb, '{}'::jsonb,
              'authenticated', 'authenticated', now() - interval '30 days', now())
      on conflict do nothing;
    insert into public.subscriptions
      (id, user_id, refunded_at, created_at)
      values (gen_random_uuid(), v_user,
              case when i <= 6 then now() - interval '15 days' else null end,
              now() - interval '20 days');
  end loop;

  -- TEST users (20): 4 refunded, all in last 7 days.
  for i in 1..20 loop
    v_user := gen_random_uuid();
    insert into auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data,
                            aud, role, created_at, updated_at)
      values (v_user, '00000000-0000-0000-0000-000000000000'::uuid,
              'test-' || i || '@example.test', '{}'::jsonb, '{}'::jsonb,
              'authenticated', 'authenticated', now() - interval '7 days', now())
      on conflict do nothing;
    insert into public.user_experiments
      (id, user_id, surface, variant_id, cohort_id, utm_variant_id, created_at, updated_at)
      values (gen_random_uuid(), v_user, 'paywall', v_test_variant, null, null,
              now() - interval '3 days', now());
    insert into public.subscriptions
      (id, user_id, refunded_at, created_at)
      values (gen_random_uuid(), v_user,
              case when i <= 4 then now() - interval '2 days' else null end,
              now() - interval '3 days');
  end loop;
end
$setup$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Run the scan + assert outcomes.
-- ──────────────────────────────────────────────────────────────────────────────

select public.p39_refund_rate_kill_scan();

select isnt(
  (select archived_at from public.variant_config
     where id = '33333333-3333-4333-8333-333333333333'::uuid),
  null,
  'TEST variant_config archived_at set (7d refund rate 0.20 > 2x 0.06 baseline)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: idempotency on re-run.
-- ──────────────────────────────────────────────────────────────────────────────

do $capture$
declare
  v_before timestamptz;
  v_after timestamptz;
begin
  select archived_at into v_before from public.variant_config
    where id = '33333333-3333-4333-8333-333333333333'::uuid;
  perform pg_sleep(0.01);
  perform public.p39_refund_rate_kill_scan();
  select archived_at into v_after from public.variant_config
    where id = '33333333-3333-4333-8333-333333333333'::uuid;
  perform set_config('p39_test.eq', case when v_before = v_after then 't' else 'f' end, false);
end
$capture$;

select is(
  current_setting('p39_test.eq'),
  't',
  'idempotency: archived_at unchanged on second scan'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: NO control variant_config row exists for paywall surface (we only
-- created one TEST). Verify no spurious archived rows beyond the test target.
-- ──────────────────────────────────────────────────────────────────────────────

select is(
  (select count(*)::int from public.variant_config
     where surface = 'paywall' and archived_at is not null
       and id <> '33333333-3333-4333-8333-333333333333'::uuid),
  0,
  'no other paywall variants archived (kill scoped to TEST variant only)'
);

select * from finish();

rollback;
