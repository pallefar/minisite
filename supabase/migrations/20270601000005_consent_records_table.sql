-- Phase 22 plan 01 — D-07: cookie consent + email-preferences records table.
-- Analog: supabase/migrations/20260601000010_pending_account_deletions.sql (RLS-locked-table)
-- Pitfalls applied: Pitfall 1 (no partial index with now()), per-file slug prefix in tests.
--
-- WRITER OWNERSHIP per feedback_status_machine_transition_owner.md (no enum here, but the implicit
-- "active vs revoked" lifecycle of the consent record DOES need writer owners):
--   1. Cookie banner onChange callback in plan 22-10 — UPSERT cookie_categories.
--   2. /settings/email-preferences Save action in plan 22-11 — UPSERT email_preferences.
--   3. "Withdraw consent" CTA → UPDATE setting revoked_at = now() (owned by 22-10/22-11).
--
-- user_id is NULLABLE: anonymous visitors record consent against `anonymous_id` BEFORE signup.
-- On signup the application back-fills user_id and the row is migrated to authenticated scope.

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  anonymous_id text,
  cookie_categories jsonb not null default '{}'::jsonb,
  email_preferences jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  consent_revision int not null default 1,
  user_agent text,
  ip_inet inet,
  country_code text
);

create index if not exists consent_records_user_idx
  on public.consent_records (user_id, recorded_at desc)
  where user_id is not null;

create index if not exists consent_records_anon_idx
  on public.consent_records (anonymous_id, recorded_at desc)
  where anonymous_id is not null;

alter table public.consent_records enable row level security;

-- T-22-04 mitigation: select-own only for authenticated users.
create policy "consent_records_select_own"
  on public.consent_records
  for select to authenticated
  using (auth.uid() = user_id);

-- INSERT: authenticated users may insert their own row OR rows still in anonymous mode
-- (user_id IS NULL — pre-signup banner persists). Cross-user inserts denied via with-check.
create policy "consent_records_insert_self_or_anon"
  on public.consent_records
  for insert to authenticated
  with check (auth.uid() = user_id or user_id is null);

-- Anon users may insert pre-signup consent rows with NULL user_id.
create policy "consent_records_insert_anon"
  on public.consent_records
  for insert to anon
  with check (user_id is null);

-- UPDATE: own rows only (Withdraw consent / re-record cookie categories).
create policy "consent_records_update_own"
  on public.consent_records
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- NO DELETE policy — consent history is append-only for GDPR Article 7(1) burden-of-proof.
