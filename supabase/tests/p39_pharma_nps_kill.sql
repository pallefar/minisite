-- Phase 39 Plan 39-03 — pgTAP proof: pharma either-trigger kill (D-03).
--
-- Proves:
--   1. p39_pharma_nps_kill_scan() archives variant A whose lifetime NPS
--      dropped by >= 5 points from the prior-30d baseline.
--   2. The scan is idempotent on subsequent runs (variant A archived_at
--      unchanged).
--   3. The 1★ review-rate branch is conditionally skipped when the
--      review_submissions table does NOT exist on main (defensive
--      to_regclass guard per Plan 39-08 deferral).
--
-- Note on coverage scope: Wave 2 ships ONLY the NPS branch active because
-- review_submissions is owned by 39-08. The pgTAP proof verifies the
-- NPS-only path under the current main schema. The 1★ branch will be
-- re-tested when 39-08 lands the table.
--
-- Named dollar-quote tags. begin/rollback wrapper.

begin;

select plan(4);

-- ──────────────────────────────────────────────────────────────────────────────
-- SETUP: 1 pharma variant + assignees + NPS responses producing >=5 point drop.
--
-- Baseline window (60d..30d ago, GLOBAL surface): construct so baseline_NPS = +30.
-- Variant lifetime: 5 detractors + 0 promoters/passives -> variant_NPS = -100.
-- Drop: 30 - (-100) = 130 points >= 5. KILL.
-- ──────────────────────────────────────────────────────────────────────────────

do $setup$
declare
  v_variant uuid := '44444444-4444-4444-8444-444444444444'::uuid;
  v_user uuid;
  i int;
begin
  insert into public.variant_config
    (id, surface, cohort_id, config, archived_at, created_by, created_at, updated_at)
    values
      (v_variant, 'pharma', null, '{"label":"pharma-A"}'::jsonb,
       null, null, now() - interval '14 days', now() - interval '14 days');

  -- Baseline NPS: 60d..30d ago, 10 promoters + 0 detractors = +100.
  -- That's a high baseline; variant_NPS = -100 drops by 200 points.
  for i in 1..10 loop
    insert into auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data,
                            aud, role, created_at, updated_at)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000'::uuid,
              'bl-' || i || '@example.test', '{}'::jsonb, '{}'::jsonb,
              'authenticated', 'authenticated', now() - interval '60 days', now())
      on conflict do nothing
      returning id into v_user;
    if v_user is null then
      v_user := gen_random_uuid();
      insert into auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data,
                              aud, role, created_at, updated_at)
        values (v_user, '00000000-0000-0000-0000-000000000000'::uuid,
                'bl-alt-' || i || '@example.test', '{}'::jsonb, '{}'::jsonb,
                'authenticated', 'authenticated', now() - interval '60 days', now())
        on conflict do nothing;
    end if;
    insert into public.quarterly_nps_responses
      (id, user_id, quarter, score, comment, responded_via, responded_at)
      values (gen_random_uuid(), v_user, '2026-Q1', 10, null, 'in-app',
              now() - interval '45 days')
      on conflict do nothing;
  end loop;

  -- Variant A assignees: 5 detractors, all responded AFTER assignment.
  for i in 1..5 loop
    v_user := gen_random_uuid();
    insert into auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data,
                            aud, role, created_at, updated_at)
      values (v_user, '00000000-0000-0000-0000-000000000000'::uuid,
              'pa-' || i || '@example.test', '{}'::jsonb, '{}'::jsonb,
              'authenticated', 'authenticated', now() - interval '14 days', now())
      on conflict do nothing;
    insert into public.user_experiments
      (id, user_id, surface, variant_id, cohort_id, utm_variant_id, created_at, updated_at)
      values (gen_random_uuid(), v_user, 'pharma', v_variant, null, null,
              now() - interval '14 days', now());
    insert into public.quarterly_nps_responses
      (id, user_id, quarter, score, comment, responded_via, responded_at)
      values (gen_random_uuid(), v_user, '2026-Q2', 2, null, 'in-app',
              now() - interval '7 days')
      on conflict do nothing;
  end loop;
end
$setup$;

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1: scan archives variant A on NPS-drop trigger.
-- ──────────────────────────────────────────────────────────────────────────────

select public.p39_pharma_nps_kill_scan();

select isnt(
  (select archived_at from public.variant_config
     where id = '44444444-4444-4444-8444-444444444444'::uuid),
  null,
  'pharma variant A archived_at set (NPS dropped >= 5 points)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 2: idempotency.
-- ──────────────────────────────────────────────────────────────────────────────

do $capture$
declare
  v_before timestamptz;
  v_after timestamptz;
begin
  select archived_at into v_before from public.variant_config
    where id = '44444444-4444-4444-8444-444444444444'::uuid;
  perform pg_sleep(0.01);
  perform public.p39_pharma_nps_kill_scan();
  select archived_at into v_after from public.variant_config
    where id = '44444444-4444-4444-8444-444444444444'::uuid;
  perform set_config('p39_test.eq', case when v_before = v_after then 't' else 'f' end, false);
end
$capture$;

select is(
  current_setting('p39_test.eq'),
  't',
  'idempotency: archived_at unchanged on second pharma NPS scan'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: the kill-scan function exists and is SECURITY DEFINER.
-- ──────────────────────────────────────────────────────────────────────────────

select is(
  (select prosecdef from pg_proc
     where proname = 'p39_pharma_nps_kill_scan'
       and pronamespace = 'public'::regnamespace),
  true,
  'p39_pharma_nps_kill_scan is SECURITY DEFINER'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4: function body has NO auth.uid() reference (T-39-03-04).
-- ──────────────────────────────────────────────────────────────────────────────

select is(
  (select count(*)::int from pg_proc
     where proname = 'p39_pharma_nps_kill_scan'
       and pronamespace = 'public'::regnamespace
       and prosrc !~ '\mauth\.uid\(\)'),
  1,
  'p39_pharma_nps_kill_scan body does NOT reference auth.uid() (service-role context)'
);

select * from finish();

rollback;
