-- Phase 29 Plan 02 — Task 1
-- org_patient_invites table + indexes + RLS.
-- Per CONTEXT D-06 + 28-EXTENSION-CONTRACT §2 RLS template.
--
-- FK: org_id references organizations(id) on delete restrict
--   EXTENSION-CONTRACT §4 OVERRIDES CONTEXT D-06 "cascade" — restrict preserves audit trail.
--   (Per Phase 24 D-17 append-only audit invariant.)
--
-- Status state machine (per [[feedback_status_machine_transition_owner]]):
--   accepted_at IS NULL + expires_at > now()  → pending  (send_org_patient_invite RPC)
--   accepted_at IS NULL + expires_at <= now() → expired  (query-derived; pg_cron cleanup P29-D13)
--   accepted_at IS NOT NULL                   → accepted (accept_org_patient_invite RPC)
--
-- Writes via SECDEF RPCs only (Pattern S1).

BEGIN;

-- ============================================================
-- Table
-- ============================================================
create table if not exists public.org_patient_invites (
  id                uuid        not null default gen_random_uuid() primary key,
  org_id            uuid        not null references public.organizations(id) on delete restrict,
  -- NEVER `on delete cascade` — preserves audit trail (EXTENSION-CONTRACT §4 + Phase 24 D-17).
  patient_email     text        not null,
  invite_token_hash text        not null,
  consent_scope     jsonb       not null,
  invited_by        uuid        references auth.users(id) on delete set null,
  expires_at        timestamptz not null default now() + interval '14 days',
  accepted_at       timestamptz null,
  created_at        timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- Hot path for RLS predicate
create index if not exists org_patient_invites_org_id_idx
  on public.org_patient_invites(org_id);

-- Token hash lookup for preview/accept flow
create index if not exists org_patient_invites_token_hash_idx
  on public.org_patient_invites(invite_token_hash);

-- Partial unique index: no duplicate pending invites per org+email (D-06).
-- IMMUTABLE predicate: accepted_at IS NULL uses no functions — safe per
-- [[reference_supabase_migration_gotchas]].
create unique index if not exists org_patient_invites_pending_unique_idx
  on public.org_patient_invites(org_id, patient_email)
  where accepted_at is null;

-- ============================================================
-- Consent scope validation trigger (per EXTENSION-CONTRACT §8)
-- Reuses Phase 9 _validate_consent_scope — SECDEF, raises on invalid shape.
-- Mirrors org_consent_grants_validate_scope pattern from Phase 28 Plan 01.
-- ============================================================
create or replace function public.org_patient_invites_validate_scope()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
begin
  perform public._validate_consent_scope(new.consent_scope);
  return new;
end;
$$;

create trigger org_patient_invites_validate_scope_trigger
  before insert or update of consent_scope
  on public.org_patient_invites
  for each row
  execute function public.org_patient_invites_validate_scope();

-- ============================================================
-- RLS helper: avoids org_members self-referential policy recursion (42P17).
-- org_members SELECT policy uses EXISTS(org_members om2 WHERE ...) which
-- causes infinite recursion when queried from another table's policy.
-- SECURITY DEFINER bypasses org_members RLS during the membership check.
-- ============================================================
create or replace function public._is_org_admin(p_org_id uuid, p_user_id uuid)
returns boolean
  language sql
  security definer
  stable
  set search_path = pg_catalog, public, extensions
as $$
  SELECT exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id and role = 'admin'
  );
$$;

-- ============================================================
-- RLS (EXTENSION-CONTRACT §2 template)
-- ============================================================
alter table public.org_patient_invites enable row level security;
alter table public.org_patient_invites force row level security;

-- SELECT: org admins of the same org_id may read pending/accepted invites.
-- Uses _is_org_admin SECDEF helper to avoid org_members recursive RLS (42P17).
create policy "org_patient_invites_select_by_org_admin"
  on public.org_patient_invites
  for select
  to authenticated
  using (public._is_org_admin(org_patient_invites.org_id, auth.uid()));

-- NO INSERT / UPDATE / DELETE policy for authenticated role.
-- All writes go through send_org_patient_invite (insert) and
-- accept_org_patient_invite (update accepted_at) SECDEFs (Pattern S1).

-- ============================================================
-- Comment
-- ============================================================
comment on table public.org_patient_invites is
  'P29 D-06 — patient consent invites. Parallel to org_invites (admin role-based). Writes via send_org_patient_invite + accept_org_patient_invite SECDEFs only.';

COMMIT;
