-- Phase 39 Plan 39-03 — pgTAP proof: 42-day archive lifecycle (D-11).
--
-- Proves:
--   1. p39_variant_42day_archive_scan() warns rows created 36 days ago
--      (warn boundary: created_at between -42 and -35 days, warned_at NULL).
--   2. The same scan archives rows created 43 days ago and sets
--      traffic_to_control = TRUE.
--   3. Idempotency: re-running on already-warned/archived rows does not
--      change warned_at or archived_at timestamps.
--
-- Named dollar-quote tags ($sql$) — bare $$ forbidden per project convention.
-- begin/rollback wrapper: leaves no residue.

begin;

select plan(6);

-- ──────────────────────────────────────────────────────────────────────────────
-- SETUP: insert a control landing_page + 2 page_variants at boundary ages.
-- ──────────────────────────────────────────────────────────────────────────────

do $setup$
declare
  v_user uuid := gen_random_uuid();
  v_page uuid := gen_random_uuid();
begin
  -- Need an auth.users row for landing_pages FKs to resolve; pg_cron tests
  -- typically use a minimal fixture. Bypass with set local for tests.
  perform set_config('p39_test.page_id', v_page::text, false);

  -- Try to create a landing_pages row if the table exists with the right shape.
  insert into public.landing_pages (id, slug, status, blocks, created_by, created_at, updated_at)
    values (v_page, 'p39-test-' || substr(v_page::text, 1, 8),
            'draft', '[]'::jsonb, null, now(), now())
    on conflict do nothing;

  -- Warn boundary: 36 days old (>35, <=42, no warned_at, no archived_at).
  insert into public.page_variants
    (id, canonical_page_id, variant_blocks, traffic_split,
     warned_at, archived_at, traffic_to_control, created_at, updated_at)
    values (
      '11111111-1111-4111-8111-111111111111'::uuid,
      v_page, '[]'::jsonb, 0.5, null, null, false,
      now() - interval '36 days', now() - interval '36 days'
    );

  -- Archive boundary: 43 days old (>42, no archived_at).
  insert into public.page_variants
    (id, canonical_page_id, variant_blocks, traffic_split,
     warned_at, archived_at, traffic_to_control, created_at, updated_at)
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      v_page, '[]'::jsonb, 0.5, null, null, false,
      now() - interval '43 days', now() - interval '43 days'
    );
end
$setup$;

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 1-2: First scan warns the 36-day-old row + archives the 43-day-old row.
-- ──────────────────────────────────────────────────────────────────────────────

select public.p39_variant_42day_archive_scan();

select isnt(
  (select warned_at from public.page_variants where id = '11111111-1111-4111-8111-111111111111'::uuid),
  null,
  '36-day-old variant has warned_at set after scan'
);

select isnt(
  (select archived_at from public.page_variants where id = '22222222-2222-4222-8222-222222222222'::uuid),
  null,
  '43-day-old variant has archived_at set after scan'
);

select is(
  (select traffic_to_control from public.page_variants where id = '22222222-2222-4222-8222-222222222222'::uuid),
  true,
  '43-day-old variant has traffic_to_control = TRUE after scan'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 3: warned variant did NOT also get archived (still <42 days).
-- ──────────────────────────────────────────────────────────────────────────────

select is(
  (select archived_at from public.page_variants where id = '11111111-1111-4111-8111-111111111111'::uuid),
  null,
  '36-day-old variant has archived_at still NULL (only warned, not archived)'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- TEST 4-5: idempotency — second scan does not change warned_at / archived_at.
-- ──────────────────────────────────────────────────────────────────────────────

do $capture$
declare
  v_w_before timestamptz;
  v_a_before timestamptz;
  v_w_after timestamptz;
  v_a_after timestamptz;
begin
  select warned_at into v_w_before from public.page_variants
    where id = '11111111-1111-4111-8111-111111111111'::uuid;
  select archived_at into v_a_before from public.page_variants
    where id = '22222222-2222-4222-8222-222222222222'::uuid;

  perform pg_sleep(0.01);
  perform public.p39_variant_42day_archive_scan();

  select warned_at into v_w_after from public.page_variants
    where id = '11111111-1111-4111-8111-111111111111'::uuid;
  select archived_at into v_a_after from public.page_variants
    where id = '22222222-2222-4222-8222-222222222222'::uuid;

  perform set_config('p39_test.w_eq', case when v_w_before = v_w_after then 't' else 'f' end, false);
  perform set_config('p39_test.a_eq', case when v_a_before = v_a_after then 't' else 'f' end, false);
end
$capture$;

select is(
  current_setting('p39_test.w_eq'),
  't',
  'idempotency: warned_at unchanged on second scan'
);

select is(
  current_setting('p39_test.a_eq'),
  't',
  'idempotency: archived_at unchanged on second scan'
);

select * from finish();

rollback;
