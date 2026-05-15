-- Phase 19 Plan 19-07 — Behavior test for affiliate_click_baseline matview.
--
-- Spec reference: 19-07-PLAN.md Task 1 File 5.
-- Run via: psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/affiliate_click_baseline.test.sql
--
-- Behaviors covered (5 tests):
--   T1: fixture — insert 50 click rows for affiliate_A spread over 5 days; 0 for affiliate_B.
--   T2: REFRESH MATERIALIZED VIEW populates affiliate_click_baseline.
--   T3: affiliate_A row has mean ~10, stddev > 0, days_observed = 5.
--   T4: no row exists for affiliate_B (no clicks → no aggregation).
--   T5: REFRESH CONCURRENTLY succeeds (proves the UNIQUE index is wired correctly,
--       Pitfall 5).
--
-- We can't ROLLBACK around `refresh materialized view concurrently` (it requires
-- its own transaction), so the test uses explicit cleanup at the end instead of
-- BEGIN/ROLLBACK. Per-affiliate referral_code prefix `t19base_` for fixture isolation.

do $$
declare
  v_aff_a uuid;
  v_aff_b uuid;
  v_mean numeric;
  v_stddev numeric;
  v_days integer;
  v_row_count integer;
  v_b_count integer;
  i integer;
  j integer;
begin
  -- ---- T1: fixtures ----
  insert into public.affiliates
    (id, email, display_name, audience_type, audience_size, status, referral_code)
  values
    (gen_random_uuid(), 'aff-a@base.io', 'BaseA', 'Instagram', 1000, 'approved', 't19base_a')
  returning id into v_aff_a;
  insert into public.affiliates
    (id, email, display_name, audience_type, audience_size, status, referral_code)
  values
    (gen_random_uuid(), 'aff-b@base.io', 'BaseB', 'Instagram', 1000, 'approved', 't19base_b')
  returning id into v_aff_b;

  -- 50 clicks over 5 days for affiliate_A — vary counts per day to ensure stddev > 0.
  -- Day-offset → click count: 1d→8, 2d→10, 3d→12, 4d→9, 5d→11 (total 50, mean 10, nonzero stddev).
  for j in 1..5 loop
    for i in 1..(case j when 1 then 8 when 2 then 10 when 3 then 12 when 4 then 9 else 11 end) loop
      insert into public.affiliate_clicks
        (affiliate_id, referral_code, ip, created_at)
      values
        (v_aff_a, 't19base_a', '203.0.113.1'::inet,
         now() - (j::text || ' days')::interval - (i::text || ' minutes')::interval);
    end loop;
  end loop;
  raise notice 'PASS: T1 fixtures inserted (50 clicks for affiliate_A, 0 for affiliate_B)';

  -- ---- T2: plain REFRESH populates the matview ----
  refresh materialized view public.affiliate_click_baseline;
  raise notice 'PASS: T2 REFRESH MATERIALIZED VIEW completed';

  -- ---- T3: affiliate_A baseline shape ----
  select mean_clicks, stddev_clicks, days_observed
    into v_mean, v_stddev, v_days
    from public.affiliate_click_baseline
   where affiliate_id = v_aff_a;
  if v_days <> 5 then
    raise exception 'T3 expected days_observed=5, got %', v_days;
  end if;
  if v_mean < 9.0 or v_mean > 11.0 then
    raise exception 'T3 expected mean_clicks≈10, got %', v_mean;
  end if;
  if v_stddev is null or v_stddev <= 0 then
    raise exception 'T3 expected stddev_clicks > 0, got %', v_stddev;
  end if;
  raise notice 'PASS: T3 affiliate_A baseline: mean=%, stddev=%, days=%', v_mean, v_stddev, v_days;

  -- ---- T4: no row for affiliate_B ----
  select count(*) into v_b_count
    from public.affiliate_click_baseline
   where affiliate_id = v_aff_b;
  if v_b_count <> 0 then
    raise exception 'T4 expected 0 rows for affiliate_B (no clicks), got %', v_b_count;
  end if;
  raise notice 'PASS: T4 affiliate_B has no baseline row (no clicks)';

  -- ---- T5: REFRESH CONCURRENTLY succeeds (unique index wired correctly) ----
  refresh materialized view concurrently public.affiliate_click_baseline;
  raise notice 'PASS: T5 REFRESH CONCURRENTLY succeeded (Pitfall 5: UNIQUE index wired)';

  -- ---- cleanup (no ROLLBACK because CONCURRENTLY refresh runs outside this block's tx) ----
  delete from public.affiliate_clicks where referral_code in ('t19base_a','t19base_b');
  delete from public.affiliates where referral_code in ('t19base_a','t19base_b');
  refresh materialized view public.affiliate_click_baseline;
  -- Sanity: matview row for affiliate_A should be gone after cleanup refresh.
  select count(*) into v_row_count
    from public.affiliate_click_baseline
   where affiliate_id in (v_aff_a, v_aff_b);
  if v_row_count <> 0 then
    raise exception 'cleanup: expected 0 baseline rows for fixture affiliates after refresh, got %', v_row_count;
  end if;
  raise notice 'CLEANUP: fixture rows removed and matview refreshed';

  raise notice 'ALL 5 affiliate_click_baseline tests PASSED';
end;
$$;
