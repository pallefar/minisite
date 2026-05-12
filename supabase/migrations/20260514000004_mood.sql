-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of mood logs).
--
-- public.mood — one row per logged mood entry, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, mood_id) composite primary key (client-generated uuid).
--   - moddatetime LWW; client MUST NOT pass updated_at.
--   - RLS default-deny on SELECT/INSERT/UPDATE/DELETE; service-role bypass
--     for Phase 7 account deletion.
--   - CHECK on mood ∈ [1, 5] mirrors the local 1-5 scale; rejects malformed
--     writes with 23514.
--
-- Soft-delete: HARD DELETE — Phase 5 injections parity.
-- Realtime publication membership: ENABLED.

create extension if not exists moddatetime schema extensions;

create table public.mood (
  user_id uuid not null references auth.users(id) on delete cascade,
  mood_id uuid not null,
  primary key (user_id, mood_id),
  date text not null,
  mood smallint not null check (mood between 1 and 5),
  energy numeric,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mood_user_date_idx on public.mood (user_id, date desc);

create trigger mood_set_updated_at
  before update on public.mood
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.mood enable row level security;

create policy "mood_select_own"
  on public.mood
  for select
  using (auth.uid() = user_id);

create policy "mood_insert_own"
  on public.mood
  for insert
  with check (auth.uid() = user_id);

create policy "mood_update_own"
  on public.mood
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "mood_delete_own"
  on public.mood
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mood'
  ) then
    execute 'alter publication supabase_realtime add table public.mood';
  end if;
end$$;
