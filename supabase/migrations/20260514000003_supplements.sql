-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of supplements).
--
-- public.supplements — Option A flattening per 06-RESEARCH §1.B
-- (researcher recommendation, planner-confirmed). One row per
-- (user, date, supplement_name) tuple — the SQL representation flattens the
-- v2 Zustand shape `supplements: Record<dateString, Record<supplementName, boolean>>`
-- into row-per-event semantics. `taken=false` rows are intentionally NOT
-- persisted in the cloud — the natural "row exists" predicate IS the taken
-- flag.
--
-- Integrity invariants:
--   - Composite PK (user_id, date, supplement_name). NO surrogate uuid —
--     the natural key uniqueness contract IS the PK.
--   - moddatetime LWW; client MUST NOT pass updated_at.
--   - RLS default-deny on SELECT/INSERT/UPDATE/DELETE; service-role bypass
--     for Phase 7 account deletion.
--
-- Soft-delete: HARD DELETE — Phase 5 injections parity. A user un-toggling
-- a supplement deletes the row; re-toggling re-inserts.
-- Realtime publication membership: ENABLED.

create extension if not exists moddatetime schema extensions;

create table public.supplements (
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  supplement_name text not null,
  primary key (user_id, date, supplement_name),
  taken boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplements_user_date_idx on public.supplements (user_id, date desc);

create trigger supplements_set_updated_at
  before update on public.supplements
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.supplements enable row level security;

create policy "supplements_select_own"
  on public.supplements
  for select
  using (auth.uid() = user_id);

create policy "supplements_insert_own"
  on public.supplements
  for insert
  with check (auth.uid() = user_id);

create policy "supplements_update_own"
  on public.supplements
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "supplements_delete_own"
  on public.supplements
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'supplements'
  ) then
    execute 'alter publication supabase_realtime add table public.supplements';
  end if;
end$$;
