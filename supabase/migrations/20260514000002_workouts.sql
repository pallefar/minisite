-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of workouts).
--
-- public.workouts — one row per logged workout, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, workout_id) composite primary key (client-generated uuid).
--   - moddatetime LWW; client MUST NOT pass updated_at.
--   - RLS default-deny on SELECT/INSERT/UPDATE/DELETE; service-role bypass
--     for Phase 7 account deletion.
--   - CHECK on type — restricted to the v2 Workout taxonomy. Server-side
--     enforcement so a malformed client write is rejected with 23514.
--
-- Soft-delete: HARD DELETE — Phase 5 injections parity.
-- Realtime publication membership: ENABLED.

create extension if not exists moddatetime schema extensions;

create table public.workouts (
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null,
  primary key (user_id, workout_id),
  date text not null,
  type text not null check (type in ('cardio', 'strength', 'flexibility', 'sport', 'walk', 'other')),
  name text not null,
  minutes numeric not null,
  rpe numeric,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workouts_user_date_idx on public.workouts (user_id, date desc);

create trigger workouts_set_updated_at
  before update on public.workouts
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.workouts enable row level security;

create policy "workouts_select_own"
  on public.workouts
  for select
  using (auth.uid() = user_id);

create policy "workouts_insert_own"
  on public.workouts
  for insert
  with check (auth.uid() = user_id);

create policy "workouts_update_own"
  on public.workouts
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "workouts_delete_own"
  on public.workouts
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workouts'
  ) then
    execute 'alter publication supabase_realtime add table public.workouts';
  end if;
end$$;
