-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of symptom logs).
--
-- public.symptoms — one row per logged symptom entry, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, symptom_id) composite primary key (client-generated uuid).
--   - moddatetime LWW; client MUST NOT pass updated_at.
--   - RLS default-deny on SELECT/INSERT/UPDATE/DELETE; service-role bypass
--     for Phase 7 account deletion.
--   - CHECK on severity ∈ [1, 5] mirrors the local 1-5 scale; rejects
--     malformed writes with 23514.
--
-- Soft-delete: HARD DELETE — Phase 5 injections parity.
-- Realtime publication membership: ENABLED.

create extension if not exists moddatetime schema extensions;

create table public.symptoms (
  user_id uuid not null references auth.users(id) on delete cascade,
  symptom_id uuid not null,
  primary key (user_id, symptom_id),
  date text not null,
  symptom text not null,
  severity smallint not null check (severity between 1 and 5),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index symptoms_user_date_idx on public.symptoms (user_id, date desc);

create trigger symptoms_set_updated_at
  before update on public.symptoms
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.symptoms enable row level security;

create policy "symptoms_select_own"
  on public.symptoms
  for select
  using (auth.uid() = user_id);

create policy "symptoms_insert_own"
  on public.symptoms
  for insert
  with check (auth.uid() = user_id);

create policy "symptoms_update_own"
  on public.symptoms
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "symptoms_delete_own"
  on public.symptoms
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'symptoms'
  ) then
    execute 'alter publication supabase_realtime add table public.symptoms';
  end if;
end$$;
