-- =============================================================================
-- Phase 31 Plan 04 — org_onboarding_flows table + RLS + _validate_onboarding_steps + 3 SECDEFs
--
-- TS1 timestamp: 20270601400005 (lexicographically after 20270601310101_p31_01_*)
-- Must be lex-after all P31 branding migrations (20270601400003/400004) from 31-02.
--
-- Provides:
--   1. public.org_onboarding_flows table (D-12 verbatim shape)
--   2. Partial unique index org_onboarding_flows_active_per_org (where is_active)
--   3. RLS: enabled + forced; 4 policies (select/insert-deny/update-deny/delete-deny)
--   4. public._validate_onboarding_steps(p_steps jsonb) returns void
--      — shape guard: mandatory steps, unknown types, custom-on-locked-step
--   5. public.save_org_onboarding_flow(p_org_id, p_steps) returns uuid
--      — version append + atomic is_active swap + advisory lock + audit log
--   6. public.activate_onboarding_flow_version(p_org_id, p_flow_id) returns void
--      — rollback to historical version + audit log
--   7. public.mark_onboarding_complete() returns void
--      — first-clinic-wins idempotent completion stamp on profiles
--
-- Downstream dependencies consumed:
--   - public.has_permission (Plan 31-01 20270601310101)
--   - public.get_caller_role (Plan 31-01 20270601310101)
--   - public.log_admin_action (Phase 24)
--   - public.profiles (P29 reconcile + admin_role column)
--   - public.org_members (Phase 28)
--   - public.organizations (Phase 28)
--
-- DO NOT wrap in BEGIN/COMMIT — Supabase CLI manages transaction per migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: public.org_onboarding_flows
-- ---------------------------------------------------------------------------
-- D-12 verbatim schema. Not using IF NOT EXISTS — fresh table; duplicate create
-- surfaces a diagnostic error if a prior partial push left it behind.

create table public.org_onboarding_flows (
  id          uuid        not null default gen_random_uuid() primary key,
  org_id      uuid        not null references public.organizations(id) on delete restrict,
  steps       jsonb       not null,
  version     int         not null,
  is_active   boolean     not null default true,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.org_onboarding_flows is
  'P31 D-12: versioned per-org onboarding flow. is_active partial-unique per org. Mutations only via save_org_onboarding_flow + activate_onboarding_flow_version SECDEFs.';

-- ---------------------------------------------------------------------------
-- 2. Partial unique index: at most one active flow per org
-- ---------------------------------------------------------------------------
-- IMMUTABLE predicate (boolean column reference) per [[reference_supabase_migration_gotchas]].

create unique index org_onboarding_flows_active_per_org
  on public.org_onboarding_flows (org_id)
  where is_active;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.org_onboarding_flows enable row level security;
alter table public.org_onboarding_flows force row level security;

-- SELECT: any authenticated member of the org can read the org's flows.
create policy org_onboarding_flows_select_org_member
  on public.org_onboarding_flows
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members
      where org_id = org_onboarding_flows.org_id
        and user_id = auth.uid()
    )
  );

-- INSERT: blocked for direct inserts (SECDEF only via save_org_onboarding_flow).
create policy org_onboarding_flows_insert_deny
  on public.org_onboarding_flows
  for insert
  to authenticated
  with check (false);

-- UPDATE: blocked for direct updates (SECDEF only).
create policy org_onboarding_flows_update_deny
  on public.org_onboarding_flows
  for update
  to authenticated
  using (false)
  with check (false);

-- DELETE: blocked for direct deletes.
create policy org_onboarding_flows_delete_deny
  on public.org_onboarding_flows
  for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- 4. Validator: public._validate_onboarding_steps(p_steps jsonb) returns void
-- ---------------------------------------------------------------------------
-- Internal SECDEF (underscore-prefixed). Called by save_org_onboarding_flow.
-- Raises P0001 with structured message codes for client-side dispatch.
-- search_path locked per [[reference_supabase_migration_gotchas]].

create or replace function public._validate_onboarding_steps(
  p_steps jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_step            jsonb;
  v_type            text;
  v_has_medication  boolean := false;
  v_has_consent     boolean := false;
begin
  -- Must be a JSON array.
  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_STEPS_NOT_ARRAY';
  end if;

  for v_step in select * from jsonb_array_elements(p_steps) loop
    v_type := v_step ->> 'type';

    -- type must be non-null and one of the 8 canonical StepType values (D-09).
    if v_type is null or v_type not in (
      'welcome', 'intro_card', 'medication', 'goals',
      'body_stats', 'consent', 'doctor_invite', 'tour'
    ) then
      raise exception using errcode = 'P0001', message = 'UNKNOWN_STEP_TYPE';
    end if;

    -- custom field is only allowed on editable step types (welcome, intro_card).
    if (v_step ? 'custom') and v_type not in ('welcome', 'intro_card') then
      raise exception using errcode = 'P0001', message = 'INVALID_CUSTOM_ON_LOCKED_STEP';
    end if;

    if v_type = 'medication' then v_has_medication := true; end if;
    if v_type = 'consent'    then v_has_consent    := true; end if;
  end loop;

  -- Both mandatory steps must be present.
  if not v_has_medication or not v_has_consent then
    raise exception using errcode = 'P0001', message = 'MISSING_MANDATORY_STEP';
  end if;
end;
$$;

comment on function public._validate_onboarding_steps(jsonb) is
  'P31 D-12/D-09: Internal shape guard called by save_org_onboarding_flow. '
  'Raises P0001 with structured message codes (MISSING_MANDATORY_STEP, UNKNOWN_STEP_TYPE, INVALID_CUSTOM_ON_LOCKED_STEP). '
  'Paired with TS type OnboardingStepNode + StepType in src/types/onboarding-step.ts per [[feedback_planner_iter1_anti_patterns]] #4.';

-- ---------------------------------------------------------------------------
-- 5. SECDEF #1: public.save_org_onboarding_flow(p_org_id, p_steps) returns uuid
-- ---------------------------------------------------------------------------
-- Inserts a new version + atomically flips prior active row to is_active = false.
-- Uses pg_advisory_xact_lock for monotonic versioning under concurrent saves.
-- Logs to audit_logs via log_admin_action (action: org_onboarding_flow.save).
-- Does NOT log p_steps blob (may carry custom welcome text — PHI vector).

create or replace function public.save_org_onboarding_flow(
  p_org_id uuid,
  p_steps  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_next_version int;
  v_new_id       uuid;
begin
  -- Permission gate: onboarding.edit is owner-only per D-03.
  if not public.has_permission(public.get_caller_role(p_org_id), 'onboarding.edit') then
    raise exception 'insufficient_privilege' using errcode = '42501', message = 'insufficient_privilege';
  end if;

  -- Shape validation.
  perform public._validate_onboarding_steps(p_steps);

  -- Advisory lock: prevents split-brain versioning under concurrent saves for same org.
  perform pg_advisory_xact_lock(hashtext('org_onboarding_flow:' || p_org_id::text));

  -- Compute next version number.
  select coalesce(max(version), 0) + 1
    into v_next_version
    from public.org_onboarding_flows
   where org_id = p_org_id;

  -- Atomically deactivate the current active row (if any).
  update public.org_onboarding_flows
     set is_active = false
   where org_id = p_org_id
     and is_active = true;

  -- Insert new version as the active row.
  insert into public.org_onboarding_flows (org_id, steps, version, is_active, created_by)
  values (p_org_id, p_steps, v_next_version, true, auth.uid())
  returning id into v_new_id;

  -- Audit log (metadata only — no PHI steps blob).
  perform public.log_admin_action(
    'org_onboarding_flow.save',
    jsonb_build_object(
      'org_id',  p_org_id,
      'flow_id', v_new_id,
      'version', v_next_version
    )
  );

  return v_new_id;
end;
$$;

comment on function public.save_org_onboarding_flow(uuid, jsonb) is
  'P31 D-12/D-13: Inserts a new onboarding flow version + atomically deactivates prior. '
  'Gates on has_permission(get_caller_role(p_org_id), ''onboarding.edit''). '
  'Writes log_admin_action(org_onboarding_flow.save). Returns new flow id.';

-- ---------------------------------------------------------------------------
-- 6. SECDEF #2: public.activate_onboarding_flow_version(p_org_id, p_flow_id) returns void
-- ---------------------------------------------------------------------------
-- Rollback: sets a historical row to is_active = true; deactivates all others.
-- No-op if the target row is already active.
-- Logs to audit_logs via log_admin_action (action: org_onboarding_flow.activate_version).

create or replace function public.activate_onboarding_flow_version(
  p_org_id   uuid,
  p_flow_id  uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_already_active boolean;
begin
  -- Permission gate: same as save (onboarding.edit).
  if not public.has_permission(public.get_caller_role(p_org_id), 'onboarding.edit') then
    raise exception 'insufficient_privilege' using errcode = '42501', message = 'insufficient_privilege';
  end if;

  -- Verify target flow belongs to this org.
  if not exists (
    select 1 from public.org_onboarding_flows
     where id = p_flow_id and org_id = p_org_id
  ) then
    raise exception 'FLOW_NOT_IN_ORG' using errcode = 'P0001', message = 'FLOW_NOT_IN_ORG';
  end if;

  -- Check if already active — no-op path.
  select is_active into v_already_active
    from public.org_onboarding_flows
   where id = p_flow_id;

  if v_already_active then
    return; -- already active; no state change, no log
  end if;

  -- Lock both the target row and the current active row to prevent races.
  perform 1 from public.org_onboarding_flows
   where (id = p_flow_id or (org_id = p_org_id and is_active = true))
   for update;

  -- Deactivate all other active rows for this org.
  update public.org_onboarding_flows
     set is_active = false
   where org_id = p_org_id
     and is_active = true
     and id <> p_flow_id;

  -- Activate the target row.
  update public.org_onboarding_flows
     set is_active = true
   where id = p_flow_id;

  -- Audit log.
  perform public.log_admin_action(
    'org_onboarding_flow.activate_version',
    jsonb_build_object(
      'org_id',   p_org_id,
      'flow_id',  p_flow_id
    )
  );
end;
$$;

comment on function public.activate_onboarding_flow_version(uuid, uuid) is
  'P31 D-12/D-13: Atomically rolls back to a historical onboarding flow version. '
  'Gates on has_permission(get_caller_role(p_org_id), ''onboarding.edit''). '
  'No-op if target is already active. Writes log_admin_action(org_onboarding_flow.activate_version).';

-- ---------------------------------------------------------------------------
-- 7. SECDEF #3: public.mark_onboarding_complete() returns void
-- ---------------------------------------------------------------------------
-- D-14 first-clinic-wins: writes completed_onboarding_at on profiles for auth.uid().
-- No arguments — only operates on the authenticated caller's own profile.
-- Idempotent: the IS NULL guard makes a second call a no-op.
-- No audit log (patient-side action, not admin; per D-14 + D-16).

create or replace function public.mark_onboarding_complete()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  update public.profiles
     set completed_onboarding_at = now()
   where id = auth.uid()
     and completed_onboarding_at is null;
end;
$$;

comment on function public.mark_onboarding_complete() is
  'P31 D-14: First-clinic-wins onboarding completion stamp. '
  'Writes profiles.completed_onboarding_at = now() for auth.uid() exactly once (IS NULL guard). '
  'Patient-side; no log_admin_action per D-14/D-16.';

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

grant execute on function public._validate_onboarding_steps(jsonb)              to authenticated;
grant execute on function public.save_org_onboarding_flow(uuid, jsonb)           to authenticated;
grant execute on function public.activate_onboarding_flow_version(uuid, uuid)    to authenticated;
grant execute on function public.mark_onboarding_complete()                       to authenticated;
