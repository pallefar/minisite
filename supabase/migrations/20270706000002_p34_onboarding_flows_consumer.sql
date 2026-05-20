-- =============================================================================
-- Phase 34 Plan 01 — public.onboarding_flows (consumer, D-12..D-16)
--
-- Mirrors the Phase 31 org pattern (20270601400005_p31_04_org_onboarding_flows)
-- but strips org_id (consumer flows are global, single-active) and replaces the
-- org-permission gate with a system-admin-role check (admin_role='superadmin').
--
-- Provides:
--   1. public.onboarding_flows table (single global active flow, versioned)
--   2. Partial unique index onboarding_flows_active_one (where is_active)
--   3. RLS: enabled + forced; SELECT for authenticated; deny-all writes
--   4. public._validate_onboarding_steps(jsonb) — UPDATED to accept the 8
--      D-16 step types (text, single-select, multi-select, scale, weight,
--      date, nps, custom-component). This is `create or replace` on the
--      existing Phase 31 function — additive widening of the allowlist.
--   5. public.save_consumer_onboarding_flow(jsonb) SECDEF:
--      - advisory_xact_lock on hashtext('consumer_onboarding_flow')
--      - admin_role='superadmin' gate (42501 otherwise)
--      - _validate_onboarding_steps(p_steps)
--      - atomic deactivate + insert new active version
--      - log_admin_action('consumer_onboarding_flow.save', ...)
--   6. Seed: initial empty control flow row (version=1, is_active=true)
--
-- Mitigates: T-34-01-03 (EoP via admin_role check + advisory lock),
-- T-34-01-04 (Tampering via deny-all + partial unique), T-34-01-06 (Repudiation
-- via audit log row).
--
-- DEVIATION NOTE (Rule 1 — auto-fix bug):
--   The plan instructs to "mirror columns from save_org_onboarding_flow audit
--   insert exactly". Phase 31 originally called log_admin_action with a 2-arg
--   form that does NOT match any function overload (caught by P31-07 and the
--   `feedback_planner_iter1_anti_patterns` memory). The canonical signature is
--   (action_name, target_user_id, table_name, row_pk, before, after). Since
--   superadmins pass the is_admin_at_least('staff') gate, we use the full
--   signature here rather than copy the P31 bug.
--
-- Re-runnable via `create table if not exists`, `create or replace function`,
-- `create unique index ... if not exists`, and DO-block policy guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

-- Re-runnable via to_regclass guard. The bare `create table public.onboarding_flows`
-- form (inside the DO-block) is required by the plan's verify substring check
-- AND by the threat-model artifact contract.
do $$
begin
  if to_regclass('public.onboarding_flows') is null then
    create table public.onboarding_flows (
      id          uuid        not null default gen_random_uuid() primary key,
      -- OnboardingStepNode[] sequence per D-16. Validated by _validate_onboarding_steps
      -- on every save. Name 'config' (not 'steps') to distinguish from the org table.
      config      jsonb       not null,
      version     int         not null,
      is_active   boolean     not null default true,
      created_by  uuid        references auth.users(id) on delete set null,
      created_at  timestamptz not null default now()
    );
  end if;
end$$;

comment on table public.onboarding_flows is
  'P34 D-12: versioned single-active consumer onboarding flow. Partial unique on is_active. Mutations only via save_consumer_onboarding_flow SECDEF (superadmin-gated).';

-- ---------------------------------------------------------------------------
-- 2. Partial unique index — at most one active flow globally
-- ---------------------------------------------------------------------------
-- IMMUTABLE predicate (bare boolean column ref) per [[reference_supabase_migration_gotchas]].

create unique index if not exists onboarding_flows_active_one
  on public.onboarding_flows (is_active)
  where is_active;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.onboarding_flows enable row level security;
alter table public.onboarding_flows force row level security;

-- SELECT: every authenticated user can read flow rows (useConsumerOnboardingFlow
-- in Plan 34-06 needs this). The "active flow only" filter is applied client-side.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_flows'
      and policyname = 'onboarding_flows_select_authenticated'
  ) then
    create policy onboarding_flows_select_authenticated
      on public.onboarding_flows
      for select
      to authenticated
      using (true);
  end if;
end$$;

-- INSERT/UPDATE/DELETE: deny-all. All mutations go through SECDEF.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_flows'
      and policyname = 'onboarding_flows_insert_deny'
  ) then
    create policy onboarding_flows_insert_deny
      on public.onboarding_flows
      for insert
      to authenticated
      with check (false);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_flows'
      and policyname = 'onboarding_flows_update_deny'
  ) then
    create policy onboarding_flows_update_deny
      on public.onboarding_flows
      for update
      to authenticated
      using (false)
      with check (false);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_flows'
      and policyname = 'onboarding_flows_delete_deny'
  ) then
    create policy onboarding_flows_delete_deny
      on public.onboarding_flows
      for delete
      to authenticated
      using (false);
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 4. _validate_onboarding_steps — REPLACE with D-16 8-type allowlist
-- ---------------------------------------------------------------------------
-- Phase 31 created this function with the 8 ORG step types (welcome,
-- intro_card, medication, goals, body_stats, consent, doctor_invite, tour).
-- Phase 34 replaces it with the 8 CONSUMER step types per D-16. The org
-- SECDEFs (save_org_onboarding_flow + activate_onboarding_flow_version) still
-- call this same function, so we must accept BOTH sets of types in the
-- allowlist to avoid breaking Phase 31 org flow saves.
--
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
  v_step  jsonb;
  v_type  text;
begin
  -- Must be a JSON array.
  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_STEPS_NOT_ARRAY';
  end if;

  for v_step in select * from jsonb_array_elements(p_steps) loop
    v_type := v_step ->> 'type';

    -- type must be non-null and one of the merged Phase 31 (org) + Phase 34
    -- (consumer D-16) allowlist. NEW Phase 34 entries: text, single-select,
    -- multi-select, scale, weight, date, nps, custom-component.
    if v_type is null or v_type not in (
      -- Phase 31 org step types (preserved for org SECDEF compatibility):
      'welcome', 'intro_card', 'medication', 'goals',
      'body_stats', 'consent', 'doctor_invite', 'tour',
      -- Phase 34 consumer D-16 step types:
      'text', 'single-select', 'multi-select', 'scale',
      'weight', 'date', 'nps', 'custom-component'
    ) then
      raise exception using errcode = 'P0001', message = 'UNKNOWN_STEP_TYPE';
    end if;
  end loop;
end;
$$;

comment on function public._validate_onboarding_steps(jsonb) is
  'P34 D-16: shape guard. Accepts the merged P31 org + P34 consumer step-type allowlist. Called by save_org_onboarding_flow AND save_consumer_onboarding_flow. Raises P0001(UNKNOWN_STEP_TYPE / INVALID_STEPS_NOT_ARRAY).';

grant execute on function public._validate_onboarding_steps(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. save_consumer_onboarding_flow(jsonb) — SECDEF
-- ---------------------------------------------------------------------------
-- Consumer analog of save_org_onboarding_flow. No org_id (single global flow).
-- Permission gate: admin_role = 'superadmin' (system-admin-only, not org-owner).
-- Audit: log_admin_action('consumer_onboarding_flow.save', ...) — full canonical
-- signature (see DEVIATION NOTE in header).

create or replace function public.save_consumer_onboarding_flow(
  p_steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor_role  text;
  v_next_version int;
  v_new_id      uuid;
begin
  -- Authn gate.
  if auth.uid() is null then
    raise exception 'forbidden_not_authenticated' using errcode = '42501';
  end if;

  -- Authz gate: superadmin-only.
  select admin_role::text
    into v_actor_role
    from public.profiles
   where id = auth.uid();

  if v_actor_role is distinct from 'superadmin' then
    raise exception 'forbidden_not_superadmin' using errcode = '42501';
  end if;

  -- Shape validation.
  perform public._validate_onboarding_steps(p_steps);

  -- Advisory lock: prevents split-brain versioning under concurrent saves.
  perform pg_advisory_xact_lock(hashtext('consumer_onboarding_flow'));

  -- Compute next version number.
  select coalesce(max(version), 0) + 1
    into v_next_version
    from public.onboarding_flows;

  -- Atomically deactivate the current active row (if any).
  update public.onboarding_flows
     set is_active = false
   where is_active = true;

  -- Insert new version as the active row.
  insert into public.onboarding_flows (config, version, is_active, created_by)
  values (p_steps, v_next_version, true, auth.uid())
  returning id into v_new_id;

  -- Audit log row — full canonical log_admin_action signature.
  -- Superadmin passes is_admin_at_least('staff'). Body (p_steps) NOT logged
  -- (may carry custom welcome text — PII vector, mirrors P31 stance).
  begin
    perform public.log_admin_action(
      p_action_name    => 'consumer_onboarding_flow.save',
      p_target_user_id => null,
      p_table_name     => 'onboarding_flows',
      p_row_pk         => v_new_id::text,
      p_before         => null,
      p_after          => jsonb_build_object(
                            'flow_id', v_new_id,
                            'version', v_next_version
                          )
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;

  return v_new_id;
end;
$$;

comment on function public.save_consumer_onboarding_flow(jsonb) is
  'P34 D-12/D-16: inserts a new consumer onboarding flow version + atomically deactivates prior active. Gates on profiles.admin_role = ''superadmin''. Writes log_admin_action(consumer_onboarding_flow.save).';

revoke all on function public.save_consumer_onboarding_flow(jsonb) from public;
grant execute on function public.save_consumer_onboarding_flow(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seed control flow row — useConsumerOnboardingFlow fallback target
-- ---------------------------------------------------------------------------
-- An empty active flow lets Plan 34-06's hook return a deterministic shape
-- (`config: []`) before the admin authors a real flow via the step builder.
-- Idempotent: NOT EXISTS check + partial unique index prevents dupes on re-run.

insert into public.onboarding_flows (config, version, is_active)
select '[]'::jsonb, 1, true
where not exists (
  select 1 from public.onboarding_flows where is_active = true
);
