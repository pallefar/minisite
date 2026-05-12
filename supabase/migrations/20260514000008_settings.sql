-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of user settings).
--
-- public.settings — singleton per user. ONE row per user_id holding the
-- aggregate User-profile + preferences payload (medication, dose, units,
-- goals, calorie/protein/fiber/water targets, lifting/activity level, etc.)
-- in a single jsonb blob to avoid a wide table that would need a migration
-- for every new preference field.
--
-- Integrity invariants:
--   - user_id is the PK (no surrogate key — singleton-per-user).
--   - moddatetime LWW; client MUST NOT pass updated_at.
--   - RLS default-deny on SELECT/INSERT/UPDATE; DELETE policy intentionally
--     OMITTED per D-13. The singleton is never deleted in normal flow; the
--     `on delete cascade` on the user_id FK wipes the row when the account
--     is deleted (Phase 7).
--
-- INSERT-then-UPDATE flow: the first save inserts via upsert with
-- onConflict='user_id'; subsequent saves update the existing row in place.
-- Realtime publication membership: ENABLED — settings sync needs to fan
-- out across the user's devices (e.g., a dose change on phone reaches the
-- laptop's dose input).

create extension if not exists moddatetime schema extensions;

create table public.settings (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- NO listing index — singleton.

create trigger settings_set_updated_at
  before update on public.settings
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.settings enable row level security;

create policy "settings_select_own"
  on public.settings
  for select
  using (auth.uid() = user_id);

create policy "settings_insert_own"
  on public.settings
  for insert
  with check (auth.uid() = user_id);

create policy "settings_update_own"
  on public.settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE policy intentionally OMITTED per D-13 + 06-RESEARCH §1.C — singleton
-- is never deleted in normal flow. ON DELETE CASCADE on user_id wipes the row
-- when the account is deleted (Phase 7 flow).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'settings'
  ) then
    execute 'alter publication supabase_realtime add table public.settings';
  end if;
end$$;
