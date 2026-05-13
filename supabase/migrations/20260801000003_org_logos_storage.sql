-- Phase 9 Plan 09-01 — `org-logos` Storage bucket + per-org RLS.
--
-- Bucket is PUBLIC-READ because logos are displayed in the clinic-context
-- bar BEFORE the operator's JWT has fully resolved (D-09 first-paint
-- requirement) and need to render in the marketing/clinic-invite landing
-- page where the visitor is anonymous. Logos are explicitly non-PHI per
-- D-09 — we accept public visibility as the cost of zero-latency render.
--
-- Allowed MIMEs: PNG and JPEG only. SVG is excluded (T-09-09 — operator-
-- uploaded SVG could carry XSS via inline scripts).
--
-- File size cap: 2 MB. Operators upload via the workspace settings UI;
-- 2 MB is generous for a logo and small enough that a malicious upload
-- can't trivially exhaust storage quota.
--
-- WRITE GATE: only operators with the `org.update` permission on the
-- target org can write into `<org_id>/...`. The org_id is parsed from
-- the object path via `(storage.foldername(name))[1]` per Pitfall #6
-- (object name is BUCKET-RELATIVE: `<org_id>/logo.png`, NOT
-- `org-logos/<org_id>/logo.png`).

-- 1. Bucket. `on conflict do nothing` makes the migration safely re-runnable
-- against an already-bootstrapped instance.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos',
  'org-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg']
)
on conflict (id) do nothing;

-- 2. Policies. The Storage RLS pattern matches Phase 6's photos bucket
-- (20260514000010_storage_bucket.sql) — every policy parses the owning
-- entity from the leading folder of the object name.
--
-- SELECT: anyone (auth + anon) can read any object in the bucket. The
-- bucket is public anyway; the policy is required because Storage RLS is
-- on the storage.objects table regardless of bucket.public flag.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_select_org_logos'
  ) then
    create policy objects_select_org_logos on storage.objects
      for select to authenticated, anon
      using (bucket_id = 'org-logos');
  end if;
end $$;

-- INSERT: only operators with org.update on the parsed org_id can write.
-- The has_permission() helper is created in 20260801000009 (forward
-- reference — resolved at plan time inside the same `supabase db push`).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_insert_org_logos'
  ) then
    create policy objects_insert_org_logos on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'org-logos'
        and public.has_permission(
          auth.uid(),
          ((storage.foldername(name))[1])::uuid,
          'org.update'
        )
      );
  end if;
end $$;

-- UPDATE: same gate as INSERT. Lets the operator overwrite an existing
-- logo (e.g. .png → .jpg with the same path stem after they re-upload).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_update_org_logos'
  ) then
    create policy objects_update_org_logos on storage.objects
      for update to authenticated
      using (
        bucket_id = 'org-logos'
        and public.has_permission(
          auth.uid(),
          ((storage.foldername(name))[1])::uuid,
          'org.update'
        )
      )
      with check (
        bucket_id = 'org-logos'
        and public.has_permission(
          auth.uid(),
          ((storage.foldername(name))[1])::uuid,
          'org.update'
        )
      );
  end if;
end $$;

-- DELETE: same gate as INSERT/UPDATE. Note: delete_org RPC
-- (20260801000011) ALSO deletes the logo via a service-role-style
-- inline DELETE behind the `storage.allow_delete_query` GUC bypass per
-- memory `reference_supabase_migration_gotchas.md` gotcha #3 — that path
-- bypasses this RLS policy. This policy covers operator UI "Remove logo"
-- button (Phase 9 Plan 09-03 owns the UI binding).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'objects_delete_org_logos'
  ) then
    create policy objects_delete_org_logos on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'org-logos'
        and public.has_permission(
          auth.uid(),
          ((storage.foldername(name))[1])::uuid,
          'org.update'
        )
      );
  end if;
end $$;
