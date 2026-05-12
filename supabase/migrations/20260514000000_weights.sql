-- Phase 6 D-13 + D-14 + SYNC-02 (Cross-device sync of weights).
--
-- public.weights — one row per body-weight log, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, weight_id) composite primary key. `weight_id` is
--     client-generated via crypto.randomUUID() at log creation time; stable
--     across local-only logging, offline queue, and eventual cloud upsert.
--   - `updated_at` is server-authoritative via the moddatetime trigger
--     (D-08 LWW). Clients MUST NOT pass updated_at on insert/upsert.
--   - RLS: auth.uid() = user_id on SELECT/INSERT/UPDATE/DELETE (default-deny).
--     Service-role bypass for admin operations (Phase 7 account deletion).
--
-- Soft-delete decision: HARD DELETE — mirrors Phase 5 injections rationale.
-- LWW resolves cross-device delete-vs-edit deterministically; the composite
-- PK shape supports a future deleted_at column without breaking changes.
--
-- Realtime publication membership: ENABLED — D-14 channel topology demands
-- one channel per table; weights joins supabase_realtime so postgres_changes
-- fires for the per-user subscriber.

create extension if not exists moddatetime schema extensions;

create table public.weights (
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_id uuid not null,
  primary key (user_id, weight_id),
  date text not null,
  weight numeric not null,
  body_fat numeric,
  ts bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index weights_user_date_idx on public.weights (user_id, date desc);

create trigger weights_set_updated_at
  before update on public.weights
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.weights enable row level security;

create policy "weights_select_own"
  on public.weights
  for select
  using (auth.uid() = user_id);

create policy "weights_insert_own"
  on public.weights
  for insert
  with check (auth.uid() = user_id);

create policy "weights_update_own"
  on public.weights
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "weights_delete_own"
  on public.weights
  for delete
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'weights'
  ) then
    execute 'alter publication supabase_realtime add table public.weights';
  end if;
end$$;
