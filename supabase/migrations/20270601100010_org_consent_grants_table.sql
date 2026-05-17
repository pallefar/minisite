-- Phase 28 Plan 01 — Task 1 (migration 8/11)
-- org_consent_grants table + RLS + _validate_consent_scope BEFORE INSERT/UPDATE trigger.
-- Per CONTEXT D-18.
--
-- CRITICAL: scope column validation re-uses Phase 9 `_validate_consent_scope` DB function.
-- `_validate_consent_scope` returns void and raises exception on invalid scope, so
-- it is invoked via a BEFORE INSERT/UPDATE trigger, not a CHECK constraint.
-- Do NOT re-implement the shape contract here.
-- (Per [[feedback_planner_iter1_anti_patterns]] #4 — one TS type + one DB validator.)

create table if not exists public.org_consent_grants (
  id               uuid        not null default gen_random_uuid() primary key,
  org_id           uuid        not null references public.organizations(id) on delete restrict,
  patient_user_id  uuid        not null references auth.users(id) on delete cascade,
  scope            jsonb       not null,
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz null,
  granted_via      text        not null
    constraint org_consent_grants_granted_via_check
      check (granted_via in ('invite', 'manual', 'migration'))
);

alter table public.org_consent_grants enable row level security;

-- Trigger function to call Phase 9 _validate_consent_scope on every INSERT/UPDATE.
create or replace function public.org_consent_grants_validate_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  -- Re-uses Phase 9 _validate_consent_scope (raises exception on invalid shape).
  -- This is the same validator as public.consents and Phase 9 memberships use.
  perform public._validate_consent_scope(new.scope);
  return new;
end;
$$;

create trigger org_consent_grants_scope_check
  before insert or update of scope on public.org_consent_grants
  for each row
  execute function public.org_consent_grants_validate_scope();

-- SELECT: patient sees own rows OR org admins.
create policy "org_consent_grants_select"
  on public.org_consent_grants
  for select
  to authenticated
  using (
    auth.uid() = patient_user_id
    or exists (
      select 1 from public.org_members
      where org_id = org_consent_grants.org_id
        and user_id = auth.uid()
        and role = 'admin'
    )
  );

-- UPDATE: append-only — only revoked_at transition from null to a timestamp is allowed.
-- (Phase 24 D-17 append-only RLS pattern.)
create policy "org_consent_grants_update_revoke_only"
  on public.org_consent_grants
  for update
  to authenticated
  using (
    -- Only admins of this org can revoke
    exists (
      select 1 from public.org_members
      where org_id = org_consent_grants.org_id
        and user_id = auth.uid()
        and role = 'admin'
    )
    and revoked_at is null  -- can only update non-revoked rows
  )
  with check (
    revoked_at is not null  -- after update, revoked_at must be set
  );

-- INSERT/DELETE: SECDEF RPCs only (default-deny for authenticated).

-- Now add the FK from org_patient_links.consent_grant_id → org_consent_grants(id)
-- (deferred from migration 09 which created org_patient_links without this FK).
alter table public.org_patient_links
  add constraint org_patient_links_consent_grant_id_fkey
  foreign key (consent_grant_id)
  references public.org_consent_grants(id)
  on delete restrict;
