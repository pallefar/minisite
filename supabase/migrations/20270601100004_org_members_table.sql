-- Phase 28 Plan 01 — Task 1 (migration 2/11)
-- org_members table + RLS policies + index on user_id (Pitfall 4 — hook latency).
-- Per CONTEXT D-12.

create table if not exists public.org_members (
  id          uuid                   not null default gen_random_uuid() primary key,
  org_id      uuid                   not null references public.organizations(id) on delete restrict,
  user_id     uuid                   not null references auth.users(id) on delete cascade,
  role        public.org_member_role not null,
  joined_at   timestamptz            not null default now(),
  last_active_at timestamptz         null,
  unique (org_id, user_id)
);

-- RLS: enabled; no direct writes from authenticated — SECDEF RPCs own INSERT/UPDATE/DELETE.
alter table public.org_members enable row level security;

-- SELECT: member can see own row + other members of the same org.
create policy "org_members_select"
  on public.org_members
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.org_members om2
      where om2.org_id = org_members.org_id
        and om2.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies for authenticated — SECDEF RPCs own writes.
-- (Default-deny when RLS is on + no policy for that operation.)

-- Index for Custom Access Token Hook latency (Pitfall 4).
-- Hook queries org_members by user_id on every token mint — must stay sub-ms.
create index if not exists org_members_user_id_idx on public.org_members (user_id);

-- Add org_members-based SELECT policy to organizations so P28 RLS tests
-- (which set up users via org_members) can read their org rows.
-- This is a supplemental policy: Postgres ORs multiple SELECT policies,
-- so the existing Phase 9 `orgs_select_by_member` (has_permission) stays.
create policy "organizations_select_by_org_members"
  on public.organizations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = organizations.id
        and user_id = auth.uid()
    )
  );
