-- Phase 19 Plan 01 — Schema-shape assertions for the 5 affiliate tables.
--
-- Spec reference: 19-01-PLAN.md Task 2 File 2.
-- Run via: psql "$LOCAL_DB_URL" -f supabase/tests/affiliate_schema.test.sql
-- Assertions raise `notice` on success, `exception` on failure (psql ON_ERROR_STOP=1 exits).
--
-- Covers:
--   - 5 tables exist with RLS enabled
--   - affiliate_conversions.invoice_id has UNIQUE constraint (D-36 idempotency)
--   - affiliates.tax_threshold_cents default = 50000 (D-31)
--   - affiliates.template_choice default = 'coach' + check ('coach','story','method') (BL-3)
--   - FK affiliate_clicks.user_id -> auth.users(id) ON DELETE SET NULL (NOT cascade)
--   - FK affiliate_impressions.affiliate_id -> affiliates(id) ON DELETE CASCADE (D-38)
--   - FK payouts.affiliate_id -> affiliates(id) ON DELETE RESTRICT (D-33 step 4)
--   - payouts.status check does NOT contain 'reversed' (W-4 / D-39)
--   - affiliates_public_view exposes exactly 8 non-PII columns + no email or audience_size

do $$
declare
  v_rls_count integer;
  v_check_def text;
  v_view_col_count integer;
  v_has_email boolean;
  v_has_audience boolean;
  v_fk_rule text;
begin
  -- ----- 5 tables exist + RLS enabled -----
  select count(*) into v_rls_count
  from pg_class
  where relname in ('affiliates','affiliate_clicks','affiliate_conversions','affiliate_impressions','payouts')
    and relnamespace = 'public'::regnamespace
    and relrowsecurity = true;
  if v_rls_count <> 5 then
    raise exception 'expected 5 affiliate tables with RLS enabled, got %', v_rls_count;
  end if;
  raise notice 'PASS: 5 affiliate tables exist with RLS enabled';

  -- ----- affiliate_conversions.invoice_id UNIQUE -----
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.affiliate_conversions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%(invoice_id)%'
  ) then
    raise exception 'expected UNIQUE constraint on affiliate_conversions.invoice_id (D-36 idempotency)';
  end if;
  raise notice 'PASS: affiliate_conversions.invoice_id has UNIQUE constraint';

  -- ----- affiliates.tax_threshold_cents default 50000 (D-31) -----
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'affiliates'
      and column_name = 'tax_threshold_cents' and column_default = '50000'
  ) then
    raise exception 'expected affiliates.tax_threshold_cents default = 50000 (D-31)';
  end if;
  raise notice 'PASS: affiliates.tax_threshold_cents default = 50000';

  -- ----- affiliates.template_choice default 'coach' + check (BL-3) -----
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'affiliates'
      and column_name = 'template_choice' and column_default = '''coach''::text'
  ) then
    raise exception 'expected affiliates.template_choice default = ''coach'' (BL-3)';
  end if;
  select pg_get_constraintdef(oid) into v_check_def
  from pg_constraint
  where conrelid = 'public.affiliates'::regclass
    and conname = 'affiliates_template_choice_check';
  if v_check_def is null or v_check_def not like '%coach%' or v_check_def not like '%story%' or v_check_def not like '%method%' then
    raise exception 'affiliates.template_choice check must contain coach/story/method, got: %', v_check_def;
  end if;
  raise notice 'PASS: affiliates.template_choice default + check correct';

  -- ----- FK affiliate_clicks.user_id -> auth.users(id) ON DELETE SET NULL -----
  select rc.delete_rule into v_fk_rule
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
  where kcu.table_schema = 'public' and kcu.table_name = 'affiliate_clicks'
    and kcu.column_name = 'user_id';
  if v_fk_rule is null or v_fk_rule <> 'SET NULL' then
    raise exception 'expected affiliate_clicks.user_id FK ON DELETE SET NULL, got: %', v_fk_rule;
  end if;
  raise notice 'PASS: affiliate_clicks.user_id FK ON DELETE SET NULL (IRS retention)';

  -- ----- FK affiliate_impressions.affiliate_id -> affiliates(id) ON DELETE CASCADE (D-38) -----
  select rc.delete_rule into v_fk_rule
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
  where kcu.table_schema = 'public' and kcu.table_name = 'affiliate_impressions'
    and kcu.column_name = 'affiliate_id';
  if v_fk_rule is null or v_fk_rule <> 'CASCADE' then
    raise exception 'expected affiliate_impressions.affiliate_id FK ON DELETE CASCADE (D-38), got: %', v_fk_rule;
  end if;
  raise notice 'PASS: affiliate_impressions.affiliate_id FK ON DELETE CASCADE';

  -- ----- FK payouts.affiliate_id -> affiliates(id) ON DELETE RESTRICT (D-33 step 4) -----
  select rc.delete_rule into v_fk_rule
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
  where kcu.table_schema = 'public' and kcu.table_name = 'payouts'
    and kcu.column_name = 'affiliate_id';
  if v_fk_rule is null or v_fk_rule <> 'RESTRICT' then
    raise exception 'expected payouts.affiliate_id FK ON DELETE RESTRICT (D-33 step 4), got: %', v_fk_rule;
  end if;
  raise notice 'PASS: payouts.affiliate_id FK ON DELETE RESTRICT';

  -- ----- payouts.status check does NOT contain 'reversed' (W-4 / D-39) -----
  select pg_get_constraintdef(oid) into v_check_def
  from pg_constraint
  where conrelid = 'public.payouts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%';
  if v_check_def is null then
    raise exception 'expected payouts.status check constraint';
  end if;
  if v_check_def like '%reversed%' then
    raise exception 'payouts.status check MUST NOT contain ''reversed'' at v1.2 (W-4 / D-39); got: %', v_check_def;
  end if;
  raise notice 'PASS: payouts.status check excludes ''reversed'' (D-39)';

  -- ----- affiliates_public_view: exactly 8 columns, no email/audience_size -----
  select count(*) into v_view_col_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'affiliates_public_view';
  if v_view_col_count <> 8 then
    raise exception 'expected affiliates_public_view to expose 8 columns (BL-3), got %', v_view_col_count;
  end if;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'affiliates_public_view'
      and column_name = 'email'
  ) into v_has_email;
  if v_has_email then
    raise exception 'affiliates_public_view MUST NOT expose email column';
  end if;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'affiliates_public_view'
      and column_name = 'audience_size'
  ) into v_has_audience;
  if v_has_audience then
    raise exception 'affiliates_public_view MUST NOT expose audience_size column';
  end if;
  raise notice 'PASS: affiliates_public_view exposes 8 columns (no email, no audience_size)';

  raise notice 'AFFILIATE SCHEMA TEST — ALL ASSERTIONS PASSED';
end $$;
