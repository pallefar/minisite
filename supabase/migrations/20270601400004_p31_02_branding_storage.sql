-- =============================================================================
-- Phase 31 Plan 31-02 — Storage buckets + path-prefix RLS (separate migration)
--
-- Kept separate from the schema/SECDEF migration (20270601400003) for crash safety:
-- Storage policy errors will NOT roll back the org_branding ALTER TABLE.
--
-- Creates two public Storage buckets:
--   org-branding          — logos, favicons (SVG allowed for vector logo support)
--   org-onboarding-assets — intro_card images (SVG excluded — T-09-09 XSS concern)
--
-- RLS write gate: org_members.role = 'owner' AND path-prefix matches org_id.
-- Uses role = 'owner' (NOT has_permission) for direct Storage SDK uploads per D-03:
-- Storage RLS evaluates per-request; SECDEF indirection adds query cost without
-- security benefit. D-03 explicitly scopes branding.edit to owner-only in v1.3.
-- If D-03 expands branding.edit to clinicians in v1.4, this policy is revisited.
--
-- SVG tradeoff (T-31-02-08 accept-with-mitigation):
--   SVG is allowed in org-branding (logos) because operators expect vector logo support.
--   SVG is excluded from org-onboarding-assets (Phase 9 T-09-09 XSS concern preserved).
--   The clinic logo is always rendered via <img src=...>, not inline <svg>, so script
--   tags inside the SVG file do not execute in the browser. Future hardening: Edge Fn
--   branding-asset-validate (D-08) can sanitize SVG with DOMPurify-on-server in v1.4.
--
-- NOTE: This migration is committed but NOT pushed from this plan.
--       Plan 31-04 owns the BLOCKING `supabase db push --linked` for the entire phase.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Buckets (on conflict do nothing makes migration safely re-runnable)
-- ---------------------------------------------------------------------------

-- org-branding: public, 500 KB max, PNG/JPG/SVG/ICO allowed.
-- Stores {org_id}/logo.{ext}, {org_id}/favicon.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-branding',
  'org-branding',
  true,
  524288,  -- 500 KB (D-08)
  array[
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon'
  ]
)
on conflict (id) do nothing;

-- org-onboarding-assets: public, 2 MB max, PNG/JPG only (no SVG per T-09-09).
-- Stores {org_id}/intro_card.{ext} — intro_card custom images per D-09.
-- Separate bucket keeps retention/quota domains clean (D-08 + D-09 Claude's Discretion).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-onboarding-assets',
  'org-onboarding-assets',
  true,
  2097152,  -- 2 MB (generous for intro_card images)
  array[
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. RLS policies for `org-branding` bucket
--    Pattern mirrors Phase 9 `org-logos` (20260801000003_org_logos_storage.sql).
--    Path structure: <org_id>/<kind>.<ext> (bucket-relative, NOT prefixed with bucket name).
--    org_id is extracted via (storage.foldername(name))[1] per Pitfall #6 from comments.
-- ---------------------------------------------------------------------------

-- SELECT: public-read — anyone (auth + anon) can read branding assets.
-- Logos rendered BEFORE auth resolves for first-paint (D-07 zero-FOUT).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_org_branding'
  ) then
    create policy objects_select_org_branding on storage.objects
      for select to authenticated, anon
      using (bucket_id = 'org-branding');
  end if;
end $$;

-- INSERT: only org owners can upload to their own org_id prefix.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_insert_org_branding'
  ) then
    create policy objects_insert_org_branding on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'org-branding'
        and exists (
          select 1 from public.org_members
          where org_id = ((storage.foldername(name))[1])::uuid
            and user_id = auth.uid()
            and role = 'owner'
        )
      );
  end if;
end $$;

-- UPDATE: owner can overwrite an existing asset (e.g., re-upload logo).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_update_org_branding'
  ) then
    create policy objects_update_org_branding on storage.objects
      for update to authenticated
      using (
        bucket_id = 'org-branding'
        and exists (
          select 1 from public.org_members
          where org_id = ((storage.foldername(name))[1])::uuid
            and user_id = auth.uid()
            and role = 'owner'
        )
      )
      with check (
        bucket_id = 'org-branding'
        and exists (
          select 1 from public.org_members
          where org_id = ((storage.foldername(name))[1])::uuid
            and user_id = auth.uid()
            and role = 'owner'
        )
      );
  end if;
end $$;

-- DELETE: owner can remove assets (e.g., "Remove logo" from BrandingTab).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_delete_org_branding'
  ) then
    create policy objects_delete_org_branding on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'org-branding'
        and exists (
          select 1 from public.org_members
          where org_id = ((storage.foldername(name))[1])::uuid
            and user_id = auth.uid()
            and role = 'owner'
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. RLS policies for `org-onboarding-assets` bucket
--    Same predicate shape as org-branding; bucket_id differs.
-- ---------------------------------------------------------------------------

-- SELECT: public-read (intro_card images displayed to patients before auth completes).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_org_onboarding_assets'
  ) then
    create policy objects_select_org_onboarding_assets on storage.objects
      for select to authenticated, anon
      using (bucket_id = 'org-onboarding-assets');
  end if;
end $$;

-- INSERT: only org owners can upload intro_card images.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_insert_org_onboarding_assets'
  ) then
    create policy objects_insert_org_onboarding_assets on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'org-onboarding-assets'
        and exists (
          select 1 from public.org_members
          where org_id = ((storage.foldername(name))[1])::uuid
            and user_id = auth.uid()
            and role = 'owner'
        )
      );
  end if;
end $$;

-- UPDATE: owner can overwrite an existing onboarding asset.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_update_org_onboarding_assets'
  ) then
    create policy objects_update_org_onboarding_assets on storage.objects
      for update to authenticated
      using (
        bucket_id = 'org-onboarding-assets'
        and exists (
          select 1 from public.org_members
          where org_id = ((storage.foldername(name))[1])::uuid
            and user_id = auth.uid()
            and role = 'owner'
        )
      )
      with check (
        bucket_id = 'org-onboarding-assets'
        and exists (
          select 1 from public.org_members
          where org_id = ((storage.foldername(name))[1])::uuid
            and user_id = auth.uid()
            and role = 'owner'
        )
      );
  end if;
end $$;

-- DELETE: owner can remove onboarding assets.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_delete_org_onboarding_assets'
  ) then
    create policy objects_delete_org_onboarding_assets on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'org-onboarding-assets'
        and exists (
          select 1 from public.org_members
          where org_id = ((storage.foldername(name))[1])::uuid
            and user_id = auth.uid()
            and role = 'owner'
        )
      );
  end if;
end $$;
