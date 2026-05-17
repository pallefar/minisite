-- Phase 28 Plan 01 — Task 1 (migration 5/11)
-- org_invite_status enum + org_invites table + RLS.
-- Per CONTEXT D-13 + addendum A2.
--
-- Status state machine (per [[feedback_status_machine_transition_owner]]):
--   (none)  → pending   : send_org_invite SECDEF RPC (Plan 28-01)
--   pending → accepted  : accept_org_invite SECDEF RPC (consumed by P31 onboarding UI)
--   pending → expired   : pg_cron org_invites_expiry_purge at 04:00 UTC daily (Plan 28-01)
--   pending → revoked   : revoke_org_invite SECDEF RPC (Plan 28-01)

do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_invite_status') then
    create type public.org_invite_status as enum ('pending', 'accepted', 'expired', 'revoked');
  end if;
end $$;

create table if not exists public.org_invites (
  id               uuid                      not null default gen_random_uuid() primary key,
  org_id           uuid                      not null references public.organizations(id) on delete restrict,
  email            text                       not null,
  invited_role     public.org_member_role    not null,
  invite_token_hash text                     not null,
  status           public.org_invite_status  not null default 'pending',
  expires_at       timestamptz               not null default now() + interval '7 days',
  accepted_at      timestamptz               null,
  revoked_at       timestamptz               null,
  created_at       timestamptz               not null default now(),
  created_by       uuid                      null references auth.users(id) on delete set null
);

alter table public.org_invites enable row level security;

-- SELECT: org admins only.
create policy "org_invites_select_admins"
  on public.org_invites
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_invites.org_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  );

-- INSERT/UPDATE/DELETE: SECDEF RPCs only (default-deny for authenticated).

-- Partial index on pending invites for cron expiry query efficiency.
-- Expression uses only the immutable column value comparison — no functions.
create index if not exists org_invites_status_expires_idx
  on public.org_invites (status, expires_at)
  where status = 'pending';
