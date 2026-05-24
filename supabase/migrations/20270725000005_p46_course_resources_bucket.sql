-- Phase 46 Plan 02 — D-16 / COURSE-06: private Storage bucket for downloadable lesson resources
-- (PDF / MP4 / ZIP) gated to Pro/Lifetime/Trial subscribers + admin-only write.
-- Analog: supabase/migrations/20270720000003_p44_community_media_bucket.sql (same private-bucket
--         + MIME whitelist + idempotent `do $$ if not exists $$` policy guard pattern).
--
-- Decisions implemented:
--   D-16 / COURSE-06: Lesson resource downloads (PDF / MP4 / ZIP) are gated to Pro / Lifetime /
--                     Trial via the tier_effective view (Phase 43). Free tier sees the resource
--                     row but cannot SELECT the storage object.
--   D-13 alignment: 60-min signed URL TTL (3600s) issued by the client; bucket is PRIVATE so
--                   anonymous access is impossible.
--   T-46-06 (Information Disclosure): MIME whitelist enforced at bucket level prevents arbitrary
--                                     upload (e.g. HTML, SVG, executable types). 200 MB cap per
--                                     resource (D-05 lesson cap = 30 min ~ 200 MB at 1080p).
--
-- Bucket layout: course-resources/<course_id>/<lesson_id>/<uuid>.<ext>
-- Writers: admins only (via public.is_staff()); D-05 forbids consumer uploads.
-- Readers: authenticated users with tier_effective.has_active = true.
--
-- Note on tier gate: SELECT predicate uses the BOOLEAN `te.has_active = true` per project
-- preference (also expressed in plan must_haves `key_links`). This matches the boolean-gate
-- pattern over a string-list IN clause for forward-compat with future tier rename.
--
-- Per reference_supabase_migration_gotchas: storage.objects DELETE needs allow_delete_query GUC
-- in some deployment paths. Phase 46 close-out will set the GUC when wiring the admin delete UI.

begin;

-- 1. Insert bucket — idempotent via ON CONFLICT DO NOTHING.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('course-resources', 'course-resources', false, 209715200, array['application/pdf','video/mp4','application/zip']) on conflict (id) do nothing;

-- 2. SELECT policy: tier-gated via tier_effective.has_active = true.
--    Authenticated user; bucket = 'course-resources'; EXISTS subquery on tier_effective.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_course_resources'
  ) then
    create policy objects_select_course_resources on storage.objects
      for select to authenticated
      using (
        bucket_id = 'course-resources'
        and auth.uid() is not null
        -- D-16: Pro/Lifetime/Trial gate via boolean has_active (not tier_label string list)
        and exists (
          select 1 from public.tier_effective te
          where te.user_id = auth.uid()
            and te.has_active = true
        )
      );
  end if;
end $$;

-- 3. INSERT policy: admin-only via public.is_staff().
--    D-05: only admins upload course resources via the admin UI; service-role bypasses RLS.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_insert_course_resources'
  ) then
    create policy objects_insert_course_resources on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'course-resources'
        and public.is_staff()
      );
  end if;
end $$;

-- 4. UPDATE policy: admin-only via public.is_staff() (mirrors INSERT).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_update_course_resources'
  ) then
    create policy objects_update_course_resources on storage.objects
      for update to authenticated
      using (
        bucket_id = 'course-resources'
        and public.is_staff()
      )
      with check (
        bucket_id = 'course-resources'
        and public.is_staff()
      );
  end if;
end $$;

-- 5. DELETE policy: admin-only via public.is_staff().
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_delete_course_resources'
  ) then
    create policy objects_delete_course_resources on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'course-resources'
        and public.is_staff()
      );
  end if;
end $$;

commit;
