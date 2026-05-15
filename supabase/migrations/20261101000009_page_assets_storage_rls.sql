-- Phase 15 Plan 01 — Storage RLS policies on `storage.objects` scoped to
-- `bucket_id = 'page-assets'`.
--
-- Threat-model note (T-15-01-07): the SELECT policy below is permissive
-- (bucket_id-only USING clause). This is intentional — assets uploaded to
-- this bucket are by definition going to be served from a public published
-- page. The analog `org_logos_storage` migration ships the same fully-public
-- SELECT pattern. If a future asset-leak scenario emerges (e.g. uploaded
-- previews that should NOT be enumerable), tighten the SELECT policy to
-- `bucket_id = 'page-assets' AND public.is_staff()`. Documented in this
-- migration's header so future maintainers see the decision.
--
-- INSERT / UPDATE / DELETE are gated on `public.is_staff()`. The
-- helper exists from migration 06 (lexicographic ordering — 06 < 09).
--
-- storage.objects already has RLS enabled by Supabase; no `enable row level
-- security` needed. Policies use the idempotent `do $$ … if not exists` block
-- pattern from analog `20260801000003_org_logos_storage.sql`.

-- ----------------------------------------------------------------------------
-- SELECT — fully public per-bucket. (Bucket is private at the bucket level,
-- but Storage URL access uses signed URLs or the public-URL pathway which
-- both go through this policy.)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'pol_page_assets_public_select'
  ) then
    create policy pol_page_assets_public_select on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'page-assets');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- INSERT — staff only.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'pol_page_assets_staff_insert'
  ) then
    create policy pol_page_assets_staff_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'page-assets' and public.is_staff());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- UPDATE — staff only.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'pol_page_assets_staff_update'
  ) then
    create policy pol_page_assets_staff_update on storage.objects
      for update to authenticated
      using (bucket_id = 'page-assets' and public.is_staff())
      with check (bucket_id = 'page-assets' and public.is_staff());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- DELETE — staff only.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'pol_page_assets_staff_delete'
  ) then
    create policy pol_page_assets_staff_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'page-assets' and public.is_staff());
  end if;
end $$;
