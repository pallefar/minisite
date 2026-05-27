-- Phase 66-01 Task 2: mfa_role_requirements
-- Per-role MFA enforcement config. Mutate via set_mfa_role_requirement SECDEF RPC (superadmin only).
-- Read: any authenticated user (so client can check on sign-in whether their role requires MFA).

create table if not exists public.mfa_role_requirements (
  role        text        primary key,
  required    boolean     not null default false,
  since       timestamptz not null default now(),
  updated_by  uuid        null references auth.users(id) on delete set null
);

alter table public.mfa_role_requirements enable row level security;

-- Read: any authenticated user can read (so client can check on sign-in)
create policy "mfa_role_requirements_read_all"
  on public.mfa_role_requirements
  for select
  to authenticated
  using (true);

-- Write: deny direct writes; mutations go through SECDEF RPC below
create policy "mfa_role_requirements_no_direct_write"
  on public.mfa_role_requirements
  for all
  to authenticated
  using (false)
  with check (false);

-- Seed initial rows
insert into public.mfa_role_requirements (role, required) values
  ('superadmin',   true),
  ('admin',        true),
  ('staff',        false),
  ('clinic-admin', false),
  ('user',         false)
on conflict (role) do nothing;

-- SECDEF RPC for admin toggle.
-- Only `superadmin` can mutate (separation of privilege; admin cannot promote/demote MFA reqs).
create or replace function public.set_mfa_role_requirement(p_role text, p_required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  if auth.uid() is null then
    raise exception 'forbidden: authentication required';
  end if;

  select raw_app_meta_data->>'role'
    into caller_role
    from auth.users
   where id = auth.uid();

  if caller_role is null or caller_role not in ('superadmin') then
    raise exception 'forbidden: only superadmin can change MFA role requirements';
  end if;

  insert into public.mfa_role_requirements (role, required, since, updated_by)
    values (p_role, p_required, now(), auth.uid())
  on conflict (role) do update
    set required   = excluded.required,
        since      = now(),
        updated_by = auth.uid();
end;
$$;

revoke all on function public.set_mfa_role_requirement(text, boolean) from public;
grant execute on function public.set_mfa_role_requirement(text, boolean) to authenticated;

comment on table public.mfa_role_requirements is
  'Per-role MFA enforcement config. Mutate via set_mfa_role_requirement SECDEF RPC (superadmin only). Read: all authenticated users.';
comment on function public.set_mfa_role_requirement(text, boolean) is
  'Toggle MFA required for a role. Superadmin-only. Upserts (role, required, since=now(), updated_by=auth.uid()).';
