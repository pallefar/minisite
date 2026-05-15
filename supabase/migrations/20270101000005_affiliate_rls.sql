-- Phase 19 Plan 01 — RLS policies for the 5 affiliate-ledger tables.
--
-- Spec references:
--   - 19-01-PLAN.md Task 2 (14 named policies)
--   - 19-CONTEXT.md D-07 (self-select + admin scaffold), D-21..D-28 (Edge Function writes via
--     service_role only — no authenticated INSERT path)
--   - 19-CONTEXT-ADDENDUM-research.md D-38 (affiliate_impressions service_role insert)
--   - reference_supabase_project.md — every RLS surface gets a cross-tenant impersonation
--     proof test (delivered alongside this migration as tests/rls/affiliates-rls.test.ts)
--   - feedback_rls_per_file_slug_prefix.md — file-scoped slug prefix in test cleanup (honored
--     in the companion test file)
--   - BL-3: pol_affiliates_public_landing_read is the load-bearing policy that lets anon
--     SELECT through affiliates_public_view (defined in 20270101000004); the view's
--     security_invoker=true inherits this policy.
--
-- Idempotency pattern: every policy is created inside a `do $$ if not exists … create policy`
-- block (see 20261101000007_page_builder_rls.sql for the source pattern). Safe to re-apply.
--
-- Anti-pattern note (W-2 cleanup): NO `pol_affiliates_self_update_profile` policy here. Per
-- BL-2 Path A (chosen during iter-1 revision), affiliate self-updates flow through the
-- `partner-profile-update` Edge Function in Plan 19-06 (service-role with JWT auth + column
-- allowlist). RLS does not gate column-level writes; the Edge Function does.

-- =============================================================================
-- 1. affiliates — 3 policies (self-select + staff-all + public-landing-read for view)
-- =============================================================================

-- Self-select: an authenticated user reads only their own affiliate row.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliates'
      and policyname = 'pol_affiliates_self_select'
  ) then
    create policy pol_affiliates_self_select on public.affiliates
      for select to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

-- Staff (is_staff=true) get full CRUD on every row.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliates'
      and policyname = 'pol_affiliates_staff_all'
  ) then
    create policy pol_affiliates_staff_all on public.affiliates
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- BL-3 (NEW): anon + authenticated may SELECT status='approved' rows. This is the policy
-- that affiliates_public_view's security_invoker=true inherits. Without this policy,
-- anon SELECT through the view would return zero rows.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliates'
      and policyname = 'pol_affiliates_public_landing_read'
  ) then
    create policy pol_affiliates_public_landing_read on public.affiliates
      for select to anon, authenticated
      using (status = 'approved');
  end if;
end $$;

-- =============================================================================
-- 2. affiliate_clicks — 3 policies (self-select via affiliate ownership + staff + service-INSERT)
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_clicks'
      and policyname = 'pol_affiliate_clicks_self_select'
  ) then
    create policy pol_affiliate_clicks_self_select on public.affiliate_clicks
      for select to authenticated
      using (
        exists (
          select 1 from public.affiliates a
          where a.id = affiliate_clicks.affiliate_id
            and a.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_clicks'
      and policyname = 'pol_affiliate_clicks_staff_all'
  ) then
    create policy pol_affiliate_clicks_staff_all on public.affiliate_clicks
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- Edge Function `affiliate-attribute` writes via service-role on every /r/{code} hit.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_clicks'
      and policyname = 'pol_affiliate_clicks_service_insert'
  ) then
    create policy pol_affiliate_clicks_service_insert on public.affiliate_clicks
      for insert to service_role
      with check (true);
  end if;
end $$;

-- =============================================================================
-- 3. affiliate_conversions — 3 policies (self-select + staff + service-INSERT for webhook)
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_conversions'
      and policyname = 'pol_affiliate_conversions_self_select'
  ) then
    create policy pol_affiliate_conversions_self_select on public.affiliate_conversions
      for select to authenticated
      using (
        exists (
          select 1 from public.affiliates a
          where a.id = affiliate_conversions.affiliate_id
            and a.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_conversions'
      and policyname = 'pol_affiliate_conversions_staff_all'
  ) then
    create policy pol_affiliate_conversions_staff_all on public.affiliate_conversions
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- stripe-webhook (invoice.paid handler in Plan 19-04) writes via service_role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_conversions'
      and policyname = 'pol_affiliate_conversions_service_insert'
  ) then
    create policy pol_affiliate_conversions_service_insert on public.affiliate_conversions
      for insert to service_role
      with check (true);
  end if;
end $$;

-- =============================================================================
-- 4. affiliate_impressions (D-38) — 3 policies (self-select + staff + service-INSERT)
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_impressions'
      and policyname = 'pol_affiliate_impressions_self_select'
  ) then
    create policy pol_affiliate_impressions_self_select on public.affiliate_impressions
      for select to authenticated
      using (
        exists (
          select 1 from public.affiliates a
          where a.id = affiliate_impressions.affiliate_id
            and a.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_impressions'
      and policyname = 'pol_affiliate_impressions_staff_all'
  ) then
    create policy pol_affiliate_impressions_staff_all on public.affiliate_impressions
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- affiliate-impression Edge Function (Plan 19-08) writes via service_role through
-- public.insert_affiliate_impression() SECURITY DEFINER helper.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_impressions'
      and policyname = 'pol_affiliate_impressions_service_insert'
  ) then
    create policy pol_affiliate_impressions_service_insert on public.affiliate_impressions
      for insert to service_role
      with check (true);
  end if;
end $$;

-- =============================================================================
-- 5. payouts — 3 policies (self-select + staff + service-write for cron)
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payouts'
      and policyname = 'pol_payouts_self_select'
  ) then
    create policy pol_payouts_self_select on public.payouts
      for select to authenticated
      using (
        exists (
          select 1 from public.affiliates a
          where a.id = payouts.affiliate_id
            and a.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payouts'
      and policyname = 'pol_payouts_staff_all'
  ) then
    create policy pol_payouts_staff_all on public.payouts
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- affiliate-payout cron (Plan 19-09) writes payouts rows via service_role; also updates
-- status as transfers complete or fail.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payouts'
      and policyname = 'pol_payouts_service_write'
  ) then
    create policy pol_payouts_service_write on public.payouts
      for all to service_role
      using (true)
      with check (true);
  end if;
end $$;
