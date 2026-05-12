-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of vials).
--
-- public.vials — one row per medication vial, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, vial_id) composite primary key (client-generated uuid).
--     Note: the local Zustand Vial shape (src/types/index.ts) does not yet
--     carry vial_id — Plan 06-03's store.ts addVial action back-stamps via
--     crypto.randomUUID() so the cloud upsert has a stable PK.
--   - moddatetime LWW; client MUST NOT pass updated_at.
--   - RLS default-deny on SELECT/INSERT/UPDATE/DELETE; service-role bypass
--     for Phase 7 account deletion.
--
-- Soft-delete: HARD DELETE — Phase 5 injections parity.
-- Realtime publication membership: ENABLED.

create extension if not exists moddatetime schema extensions;

create table public.vials (
  user_id uuid not null references auth.users(id) on delete cascade,
  vial_id uuid not null,
  primary key (user_id, vial_id),
  name text not null,
  doses_per_vial smallint not null,
  doses_used smallint not null,
  start_date text not null,
  expiration_date text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vials_user_start_idx on public.vials (user_id, start_date desc);

create trigger vials_set_updated_at
  before update on public.vials
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.vials enable row level security;

create policy "vials_select_own"
  on public.vials
  for select
  using (auth.uid() = user_id);

create policy "vials_insert_own"
  on public.vials
  for insert
  with check (auth.uid() = user_id);

create policy "vials_update_own"
  on public.vials
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "vials_delete_own"
  on public.vials
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vials'
  ) then
    execute 'alter publication supabase_realtime add table public.vials';
  end if;
end$$;
