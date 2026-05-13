-- Phase 9 Plan 09-01 — memberships table.
--
-- The memberships table is the relationship layer between auth.users and
-- orgs (Pitfall #8 single-identity invariant: ONE auth.users per email,
-- N memberships per user). Every operator/patient relationship lives here.
--
-- Load-bearing constraint (Pitfall #8):
--   `unique (user_id, org_id) where revoked_at is null`
--   — a user can be in an org AT MOST ONCE while not revoked. The
--   partial index allows revoked-then-re-invited (the new membership
--   row gets the same (user_id, org_id) pair but the prior row has a
--   non-null revoked_at). The IMMUTABLE-safe predicate uses only column
--   IS NULL (no now()/expressions).
--
-- consent_scope is mutable (D-06: patient can edit). The frozen-at-
-- acceptance snapshot lives on the invites row (D-18:
-- invites.consent_scope_at_acceptance) — these two columns serve
-- different audit purposes.
--
-- RLS contract:
--   - SELECT own: patient sees their own membership rows always
--     (auth.uid() = user_id). Required so the patient's "Active
--     organizations" tab can render even when they don't have
--     `members.list` on the org.
--   - SELECT by org member: any active org member with `members.list` can
--     see all memberships in that org (operator's roster).
--   - NO INSERT / UPDATE / DELETE — only SECURITY DEFINER RPCs in
--     20260801000011 (`accept_invite_*`, `revoke_membership`,
--     `update_consent_scope`, `update_member_role`) write.

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  consent_scope jsonb not null default '{}'::jsonb,
  -- FK constraint deferred to invites migration (08) since invites doesn't exist yet.
  invited_from_invite_id uuid,
  joined_at timestamptz not null default now(),
  -- Mirrors invites.accepted_at; the redundancy lets us index without joining.
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_scope_changed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Pitfall #8 single-identity invariant. IMMUTABLE-safe predicate.
create unique index if not exists memberships_user_org_idx
  on public.memberships (user_id, org_id)
  where revoked_at is null;

-- Active-members-by-org index (operator's roster query).
create index if not exists memberships_org_active_idx
  on public.memberships (org_id)
  where revoked_at is null;

-- Per-user lookup (patient's "Active organizations" tab).
create index if not exists memberships_user_idx
  on public.memberships (user_id);

-- Audit-trail back-reference (set in accept_invite_* RPCs).
create index if not exists memberships_invite_idx
  on public.memberships (invited_from_invite_id);

alter table public.memberships enable row level security;

-- SELECT own — patient context.
create policy memberships_select_own on public.memberships
  for select to authenticated
  using (auth.uid() = user_id);

-- SELECT by any org member with `members.list` — operator roster.
create policy memberships_select_by_org_member on public.memberships
  for select to authenticated
  using (public.has_permission(auth.uid(), org_id, 'members.list'));

-- NO INSERT / UPDATE / DELETE policies — RPCs only.

-- Realtime publication membership. The Phase 9 broadcast trigger
-- (20260801000013) calls realtime.broadcast_changes() — that primitive
-- does NOT require the table to be in the publication, but adding it
-- here keeps the door open for future postgres_changes-based listeners
-- (e.g., a debug surface) without requiring another migration.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'memberships'
  ) then
    execute 'alter publication supabase_realtime add table public.memberships';
  end if;
end $$;
