-- Phase 5 D-08 + SYNC-01 + SYNC-05 + AUTH-06 (Cross-device sync of injection log).
--
-- public.injections — one row per logged injection, owned by the patient.
--
-- Integrity invariants:
--   - (user_id, log_id) composite primary key. `log_id` is client-generated
--     via crypto.randomUUID() at injection-creation time; remains stable
--     across local-only logging, offline queue, and eventual cloud upsert.
--   - `updated_at` is server-authoritative via the moddatetime trigger
--     (D-08 LWW). Clients MUST NOT pass updated_at on insert/upsert; it
--     defaults to now() at INSERT and is forced to now() at every UPDATE.
--   - RLS: auth.uid() = user_id on SELECT/INSERT/UPDATE/DELETE (default-deny).
--     Service-role bypass for admin operations (account deletion in Phase 7).
--
-- Soft-delete decision (Claude's discretion per 05-CONTEXT line 76):
--   Phase 5 ships HARD DELETE (no deleted_at column). Rationale: LWW resolves
--   "I deleted on phone, edited on laptop" deterministically — the later
--   updated_at wins, and a DELETE arrives as a Realtime DELETE event that
--   removes the row from the other client's Zustand cache. Soft-delete adds
--   schema complexity that pays back only when the audit-trail requirement
--   lands (Phase 7 GDPR compliance) — defer until then. The composite-PK
--   shape supports a soft-delete addition later (just add `deleted_at
--   timestamptz` + update RLS SELECT policy to `... and deleted_at is null`).

create extension if not exists moddatetime schema extensions;
-- moddatetime is standard PostgreSQL contrib (ships with Supabase free tier).
-- Phase 4 precedent: 20260512000002_anon_cleanup_pg_cron.sql uses the same
-- "create extension if not exists" pattern for pg_cron.

create table public.injections (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_id uuid not null,
  primary key (user_id, log_id),

  -- Domain fields mirror src/types/index.ts `Injection` interface.
  -- Phase 5 added log_id to the interface; v6→v7 storage migration back-stamps
  -- existing localStorage rows so the client can upsert with a stable PK.
  medication text not null,            -- e.g., 'ozempic', 'mounjaro' (matches MedicationId union)
  dose text not null,                  -- string per existing Injection.dose ('0.5')
  unit text not null check (unit in ('mg', 'units', 'ml')),  -- matches DoseUnit
  site text,                           -- nullable; matches InjectionSite | null
  notes text not null default '',
  logged_at timestamptz not null,      -- ISO datetime the patient logged (UI-controlled, not server-now)
  pk_engine_version integer not null default 1,  -- PK-05 (Phase 3 D-07)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-user listing index (newest first) for initial pull + admin queries.
create index injections_user_logged_at_idx
  on public.injections (user_id, logged_at desc);

-- updated_at maintenance: moddatetime trigger overwrites on UPDATE.
create trigger injections_set_updated_at
  before update on public.injections
  for each row
  execute function extensions.moddatetime(updated_at);

-- RLS: default-deny, then explicit per-user policies (mirrors ai_messages pattern).
alter table public.injections enable row level security;

create policy "injections_select_own"
  on public.injections
  for select
  using (auth.uid() = user_id);

create policy "injections_insert_own"
  on public.injections
  for insert
  with check (auth.uid() = user_id);

create policy "injections_update_own"
  on public.injections
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "injections_delete_own"
  on public.injections
  for delete
  using (auth.uid() = user_id);

-- Realtime: enable publication membership so postgres_changes fires.
-- Supabase ships the supabase_realtime publication; new tables must be added.
-- Idempotent wrapper: `supabase db push` may re-execute on retry, and
-- `alter publication ... add table` errors if the table is already a member.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'injections'
  ) then
    execute 'alter publication supabase_realtime add table public.injections';
  end if;
end$$;
