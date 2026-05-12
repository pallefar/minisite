-- Phase 6 D-04 + D-06 + D-07 — photos Storage bucket + folder-prefix RLS.
-- Idempotent via ON CONFLICT DO UPDATE (Pitfall #11 — Studio-drift correction).
--
-- Folder layout: `{userId}/photos/{photoId}.jpg`. Storage RLS enforces
-- per-user folder isolation via `(storage.foldername(name))[1]` which
-- returns the first path segment (the user UUID as text).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = excluded.public;

-- Storage RLS — folder-prefix isolation: `{userId}/photos/{photoId}.jpg`.
-- (storage.foldername(name))[1] returns the first path segment (the user UUID).

create policy "photos_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
