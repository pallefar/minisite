-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of sleep logs).
--
-- public.sleep — one row per logged sleep entry, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, sleep_id) composite primary key (client-generated uuid).
--   - moddatetime LWW; client MUST NOT pass updated_at.
--   - RLS default-deny on SELECT/INSERT/UPDATE/DELETE; service-role bypass
--     for Phase 7 account deletion.
--
-- Soft-delete: HARD DELETE — Phase 5 injections parity.
-- Realtime publication membership: ENABLED.

create extension if not exists moddatetime schema extensions;

create table public.sleep (
  user_id uuid not null references auth.users(id) on delete cascade,
  sleep_id uuid not null,
  primary key (user_id, sleep_id),
  date text not null,
  hours numeric not null,
  wakings smallint not null,
  quality numeric,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sleep_user_date_idx on public.sleep (user_id, date desc);

create trigger sleep_set_updated_at
  before update on public.sleep
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.sleep enable row level security;

create policy "sleep_select_own"
  on public.sleep
  for select
  using (auth.uid() = user_id);

create policy "sleep_insert_own"
  on public.sleep
  for insert
  with check (auth.uid() = user_id);

create policy "sleep_update_own"
  on public.sleep
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "sleep_delete_own"
  on public.sleep
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sleep'
  ) then
    execute 'alter publication supabase_realtime add table public.sleep';
  end if;
end$$;
