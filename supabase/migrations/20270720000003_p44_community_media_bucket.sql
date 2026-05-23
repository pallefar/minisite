-- Phase 44 Plan 01 — `community-media` Storage bucket + per-object RLS policies.
--
-- Decisions implemented:
--   D-04: Per-post image cap 10, 60-min signed URLs, private bucket (no public list)
--   T-44-04: MIME whitelist {image/jpeg, image/png, image/webp} — NO SVG (XSS via inline scripts)
--   T-44-04: objects_insert policy enforces (storage.foldername(name))[1] = auth.uid()::text
--             — path-traversal defense: leading path segment MUST be caller's user_id
--
-- Bucket is PRIVATE (public=false): all reads require a signed URL (60-min TTL per D-04).
-- File size limit: 10 MB per image.
-- Path convention: {user_id}/{post_id}/{uuid}.{ext}
--   - Leading segment = auth.uid() text → INSERT/DELETE RLS enforces ownership automatically.
--
-- Pattern: mirrors supabase/migrations/20260801000003_org_logos_storage.sql with:
--   - public=false (vs org-logos which is public=true)
--   - MIME whitelist includes webp (vs jpeg+png for logos)
--   - INSERT path check uses auth.uid()::text directly (not has_permission() helper)
--
-- Per reference_supabase_migration_gotchas: storage.objects DELETE needs allow_delete_query GUC.
-- The delete policy here covers the standard operator UI path; service-role admin deletes in
-- Phase 48 will use the GUC bypass per that gotcha note.

-- 1. Insert bucket — idempotent via ON CONFLICT DO NOTHING
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-media',
  'community-media',
  false,           -- private bucket; signed URLs required for all reads (D-04)
  10485760,        -- 10 MB per image per D-04
  array['image/jpeg','image/png','image/webp']  -- NO image/svg (T-44-04: SVG XSS)
)
on conflict (id) do nothing;

-- 2. Storage RLS policies — `do $$ if not exists ... $$` guard for idempotency
-- (mirrors Phase 9 org-logos-storage.sql pattern lines 41-132)

-- SELECT: any authenticated user may download objects from this bucket.
-- Access is controlled by the signed-URL TTL (60 min); direct anonymous reads are blocked
-- by `public=false` on the bucket AND by this RLS policy requiring auth.uid() IS NOT NULL.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_community_media'
  ) then
    create policy objects_select_community_media on storage.objects
      for select to authenticated
      using (
        bucket_id = 'community-media'
        and auth.uid() is not null
      );
  end if;
end $$;

-- INSERT: authenticated user; leading path segment MUST equal caller's user_id.
-- This is the T-44-04 path-traversal defense:
--   (storage.foldername(name))[1] returns the first directory component of the object name.
--   Object name is BUCKET-RELATIVE (e.g. "abc123.../post456.../image.jpg"), NOT "community-media/...".
--   So foldername returns ["abc123...", "post456..."] and [1] is the user_id segment.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_insert_community_media'
  ) then
    create policy objects_insert_community_media on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'community-media'
        -- T-44-04: leading path segment = caller's user_id prevents cross-user upload
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;

-- DELETE: author-only delete (same path-prefix check as INSERT).
-- Note: Phase 48 admin hard-delete uses service-role client which bypasses RLS entirely.
-- Phase 48 will not require changes to this policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_delete_community_media'
  ) then
    create policy objects_delete_community_media on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'community-media'
        -- Author can delete their own objects (leading segment = their user_id)
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
