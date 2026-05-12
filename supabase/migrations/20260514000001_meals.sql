-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of meals).
--
-- public.meals — one row per logged meal/snack, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, meal_id) composite primary key (client-generated uuid).
--   - moddatetime LWW; client MUST NOT pass updated_at.
--   - RLS default-deny on SELECT/INSERT/UPDATE/DELETE; service-role bypass
--     for Phase 7 account deletion.
--
-- Soft-delete: HARD DELETE — Phase 5 injections parity.
-- Realtime publication membership: ENABLED.

create extension if not exists moddatetime schema extensions;

create table public.meals (
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_id uuid not null,
  primary key (user_id, meal_id),
  date text not null,
  name text not null,
  calories numeric not null,
  protein numeric not null,
  fiber numeric not null,
  hunger numeric,
  satisfaction numeric,
  ts bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meals_user_date_idx on public.meals (user_id, date desc);

create trigger meals_set_updated_at
  before update on public.meals
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.meals enable row level security;

create policy "meals_select_own"
  on public.meals
  for select
  using (auth.uid() = user_id);

create policy "meals_insert_own"
  on public.meals
  for insert
  with check (auth.uid() = user_id);

create policy "meals_update_own"
  on public.meals
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "meals_delete_own"
  on public.meals
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meals'
  ) then
    execute 'alter publication supabase_realtime add table public.meals';
  end if;
end$$;
