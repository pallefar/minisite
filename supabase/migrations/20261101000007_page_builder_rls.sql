-- Phase 15 Plan 01 — RLS enable + named policies for all 4 new surfaces.
--
-- Surfaces:
--   - public.landing_pages
--   - public.landing_page_revisions
--   - public.leads
--   - public.site_settings
--
-- The named policies below match CONTRACT 8 in 15-01-PLAN.md exactly. Every
-- policy is created inside an idempotent `do $$ … if not exists` block so the
-- migration is safe to re-apply on a partially-applied DB.
--
-- This migration depends on `public.is_staff()` (migration 06).
--
-- Append-only contract for landing_page_revisions (D-07, PAGE-07):
--   - No UPDATE policy and no DELETE policy → RLS denies both by default.
--   - Migration 10 adds defence-in-depth BEFORE UPDATE / BEFORE DELETE triggers.

-- ============================================================================
-- 1. Enable RLS on every new table.
-- ============================================================================
alter table public.landing_pages enable row level security;
alter table public.landing_page_revisions enable row level security;
alter table public.leads enable row level security;
alter table public.site_settings enable row level security;

-- ============================================================================
-- 2. landing_pages policies
-- ============================================================================

-- Public + authenticated may SELECT only rows where status='published'.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'landing_pages'
      and policyname = 'pol_landing_pages_public_select_published'
  ) then
    create policy pol_landing_pages_public_select_published on public.landing_pages
      for select to anon, authenticated
      using (status = 'published');
  end if;
end $$;

-- Staff (is_staff=true) get full CRUD.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'landing_pages'
      and policyname = 'pol_landing_pages_staff_all'
  ) then
    create policy pol_landing_pages_staff_all on public.landing_pages
      for all to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- ============================================================================
-- 3. landing_page_revisions policies
-- ============================================================================

-- Public + authenticated may SELECT a revision IFF it is the published revision
-- of a published page.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'landing_page_revisions'
      and policyname = 'pol_landing_page_revisions_public_select_published'
  ) then
    create policy pol_landing_page_revisions_public_select_published on public.landing_page_revisions
      for select to anon, authenticated
      using (
        exists (
          select 1 from public.landing_pages p
          where p.published_revision_id = landing_page_revisions.id
            and p.status = 'published'
        )
      );
  end if;
end $$;

-- Staff may SELECT every revision (draft access for the editor).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'landing_page_revisions'
      and policyname = 'pol_landing_page_revisions_staff_select_all'
  ) then
    create policy pol_landing_page_revisions_staff_select_all on public.landing_page_revisions
      for select to authenticated
      using (public.is_staff());
  end if;
end $$;

-- Staff may INSERT new revisions (the only way to append-only-grow the table).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'landing_page_revisions'
      and policyname = 'pol_landing_page_revisions_staff_insert'
  ) then
    create policy pol_landing_page_revisions_staff_insert on public.landing_page_revisions
      for insert to authenticated
      with check (public.is_staff());
  end if;
end $$;

-- NOTE: no UPDATE / DELETE policies — append-only is enforced by RLS absence.
-- Migration 10 adds trigger-level defence-in-depth.

-- ============================================================================
-- 4. leads policies
-- ============================================================================

-- Only service_role may INSERT (the lead-capture Edge Function uses it).
-- Public form POST → Edge Function (with own spam/honeypot/rate-limit) →
-- service_role INSERT. anon cannot INSERT directly.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and policyname = 'pol_leads_service_role_insert'
  ) then
    create policy pol_leads_service_role_insert on public.leads
      for insert to service_role
      with check (true);
  end if;
end $$;

-- Only is_staff users may SELECT leads (PII protection).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads'
      and policyname = 'pol_leads_staff_select'
  ) then
    create policy pol_leads_staff_select on public.leads
      for select to authenticated
      using (public.is_staff());
  end if;
end $$;

-- NOTE: no UPDATE / DELETE policies — leads are immutable from app code.
-- (A future "GDPR delete on request" RPC would be SECURITY DEFINER service-role
--  with its own audit trail; deferred to Phase 23 cleanup.)

-- ============================================================================
-- 5. site_settings policies
-- ============================================================================

-- Public + authenticated may SELECT (single row is publicly readable; the
-- renderer reads it server-side anyway, but client-side SEO preview also wants it).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_settings'
      and policyname = 'pol_site_settings_public_select'
  ) then
    create policy pol_site_settings_public_select on public.site_settings
      for select to anon, authenticated
      using (true);
  end if;
end $$;

-- Staff may UPDATE the singleton row.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_settings'
      and policyname = 'pol_site_settings_staff_update'
  ) then
    create policy pol_site_settings_staff_update on public.site_settings
      for update to authenticated
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

-- Staff may INSERT (the singleton index still prevents a second row).
-- This policy exists so a fresh project with the seed-row-missing case can be
-- bootstrapped from the staff UI rather than only via service-role migration.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_settings'
      and policyname = 'pol_site_settings_staff_insert'
  ) then
    create policy pol_site_settings_staff_insert on public.site_settings
      for insert to authenticated
      with check (public.is_staff());
  end if;
end $$;

-- NOTE: no DELETE policy — the singleton row must not be deleted.
