-- Phase 6 D-04 + D-07 + SYNC-06 (Cross-device sync of body photo metadata).
--
-- public.photos — one row per photo. The Blob itself lives in Supabase
-- Storage at storage.objects[photos/{user_id}/photos/{photo_id}.jpg]; this
-- table only carries the metadata + storage_path pointer. SYNC-06 explicit:
-- "Photos move from base64-in-Zustand to Supabase Storage with signed URLs,
-- keeping the Zustand-persisted slice lean."
--
-- Integrity invariants:
--   - (user_id, photo_id) composite PK; photo_id is client-generated uuid
--   - storage_path is the canonical bucket path; client constructs `${user_id}/photos/${photo_id}.jpg` per D-04
--   - moddatetime + RLS + Realtime — same template as Phase 5 injections.sql
--
-- Soft-delete decision (HARD DELETE per D-07): see header note in injections.sql.

create extension if not exists moddatetime schema extensions;

create table public.photos (
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_id uuid not null,
  primary key (user_id, photo_id),

  date text not null,
  weight numeric,
  storage_path text not null,
  mime_type text not null default 'image/jpeg',
  size_bytes integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index photos_user_date_idx on public.photos (user_id, date desc);

create trigger photos_set_updated_at
  before update on public.photos
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.photos enable row level security;

create policy "photos_select_own"
  on public.photos
  for select
  using (auth.uid() = user_id);

create policy "photos_insert_own"
  on public.photos
  for insert
  with check (auth.uid() = user_id);

create policy "photos_update_own"
  on public.photos
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "photos_delete_own"
  on public.photos
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'photos'
  ) then
    execute 'alter publication supabase_realtime add table public.photos';
  end if;
end$$;
