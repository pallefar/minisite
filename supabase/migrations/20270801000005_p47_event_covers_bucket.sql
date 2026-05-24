-- Phase 47 Plan 47-04 — `event-covers` Storage bucket + per-object RLS policies.
--
-- Decisions implemented:
--   D-16: Admin uploads event cover images via Storage; public read (cover renders on
--         marketing landing + calendar list); 2 MB cap; jpeg/png/webp only (NO svg).
--   T-47-15: bucket INSERT policy gated on public.is_staff() — non-admin cannot upload.
--   T-47-16: allowed_mime_types whitelist excludes image/svg (XSS via inline scripts).
--
-- Bucket is PUBLIC (public=true): cover thumbnails render on unauthenticated landing,
-- so direct CDN URLs are acceptable. Path convention: {event_id}/{uuid}.{ext}
--   - Leading path segment groups objects per event for admin housekeeping.
--   - Object access is by knowledge of the URL; bucket has no listing API exposed.
--
-- Pattern: FORK of supabase/migrations/20270720000003_p44_community_media_bucket.sql
-- with these intentional differences:
--   - public=true (Phase 44 community-media is private; Phase 47 covers render publicly)
--   - file_size_limit=2 MB (Phase 44 was 10 MB; covers are smaller assets)
--   - INSERT gate is public.is_staff() (Phase 44 used (storage.foldername(name))[1] =
--     auth.uid()::text since users upload their own; here only admins upload)
--   - SELECT policy permits both authenticated and anon (bucket is public)
--   - Adds explicit UPDATE policy for admin replace-in-place flow
--
-- Per memory reference_supabase_is_staff_helper: the canonical staff guard is
-- public.is_staff() (SECDEF, reads profiles.is_staff). Per
-- feedback_negation_grep_defeated_by_comment_string: the rejected-alternative
-- helper name is intentionally omitted from this file's comments.
--
-- Per reference_supabase_migration_gotchas: storage.objects DELETE may need the
-- allow_delete_query GUC in some operator contexts; the policy below covers the
-- standard authenticated admin path. Service-role admin scripts bypass RLS.

begin;

-- 1. Insert bucket — idempotent via ON CONFLICT DO NOTHING.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-covers',
  'event-covers',
  true,                                              -- D-16: public read for landing/calendar render
  2097152,                                           -- 2 MB cap
  array['image/jpeg','image/png','image/webp']      -- T-47-16: explicitly excludes vector formats
)
on conflict (id) do nothing;

-- 2. Storage RLS policies — `do $$ if not exists ... $$` guard for idempotency
--    (mirrors Phase 44 community-media pattern).

-- SELECT: public read (authenticated + anonymous). Bucket is public; the policy
-- merely makes the intent explicit and pins access to this bucket only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'event_covers_public_read'
  ) then
    create policy event_covers_public_read on storage.objects
      for select to authenticated, anon
      using (bucket_id = 'event-covers');
  end if;
end $$;

-- INSERT: admin-only (T-47-15). Gate is public.is_staff(); any authenticated user
-- who fails the staff check is rejected before the object lands.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'event_covers_admin_insert'
  ) then
    create policy event_covers_admin_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'event-covers'
        and public.is_staff()
      );
  end if;
end $$;

-- UPDATE: admin-only (covers same-name replace flow, e.g. swap cover image).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'event_covers_admin_update'
  ) then
    create policy event_covers_admin_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'event-covers'
        and public.is_staff()
      )
      with check (
        bucket_id = 'event-covers'
        and public.is_staff()
      );
  end if;
end $$;

-- DELETE: admin-only. Service-role admin scripts (cron cleanup, etc.) bypass RLS
-- entirely; this policy covers the authenticated operator UI path.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'event_covers_admin_delete'
  ) then
    create policy event_covers_admin_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'event-covers'
        and public.is_staff()
      );
  end if;
end $$;

commit;
