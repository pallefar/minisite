-- Phase 14 Plan 01 — Stripe subscription schema.
--
-- Schema name reconciliation (MANDATORY per 14-01-PLAN.md <interfaces>):
--   Executor pre-check found the Phase 9 DB uses:
--     - `public.orgs`       (NOT `public.clinics`)
--     - `public.memberships` (NOT `public.clinic_memberships`)
--   FK targets, RLS USING clauses, and function body use orgs/memberships
--   throughout this migration.
--
-- Patient role reconciliation:
--   The Phase 9 DB has 3 system roles: Owner, Coach, View-only.
--   Patients accept invites and get the default 'View-only' role.
--   There is no explicit 'patient' role name — patients = View-only members.
--   `count_active_patients()` counts memberships where roles.name = 'View-only'
--   AND revoked_at IS NULL AND recent activity exists.
--
-- Landmine annotations (reference_supabase_migration_gotchas):
--   Pitfall 1: Partial-index predicates MUST be IMMUTABLE.
--     - `WHERE user_id IS NOT NULL` — column IS NULL is IMMUTABLE-safe.
--     - `WHERE clinic_id IS NOT NULL` — same. Column-only predicate, no time functions.
--   Pitfall 2: SECURITY DEFINER functions MUST `SET search_path = public, extensions`
--     so pgcrypto/digest() resolve. Applied to count_active_patients() below.
--
-- Timestamp note: 20260601000001 was already used by audit_logs (Phase 7).
-- This migration uses 20260601000019 (next available in the 20260601 date block).

-- =============================================================================
-- 1. stripe_customers — web-tier user → Stripe customer mapping
-- =============================================================================
create table public.stripe_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 2. clinic_stripe_customers — clinic-tier org → Stripe customer mapping
-- =============================================================================
create table public.clinic_stripe_customers (
  clinic_id uuid primary key references public.orgs(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 3. subscriptions — one row per user OR clinic subscription
--   id = Stripe sub_xxx (natural PK per 14-PLAN.md iter-1 BL-2:
--   webhook upserts on Stripe sub ID; uuid PK + separate stripe_subscription_id
--   column would require a 2-step lookup and break the upsert contract).
-- =============================================================================
create table public.subscriptions (
  id text primary key,
  provider text not null default 'stripe' check (provider in ('stripe','revenuecat')),
  user_id uuid references auth.users(id) on delete cascade,
  clinic_id uuid references public.orgs(id) on delete cascade,
  stripe_customer_id text,
  status text not null,
  ux_tier text not null check (ux_tier in ('free','paid','past_due')),
  plan_id text,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly-one constraint: either a user sub OR a clinic sub — never both, never neither.
  check ((user_id is null) <> (clinic_id is null))
);

-- Partial indexes — IMMUTABLE-safe per reference_supabase_migration_gotchas Pitfall 1.
-- Column IS NOT NULL predicates are IMMUTABLE (no functions, no now()).
create index idx_subscriptions_user on public.subscriptions(user_id) where user_id is not null;
create index idx_subscriptions_clinic on public.subscriptions(clinic_id) where clinic_id is not null;

-- =============================================================================
-- 4. subscription_events — append-only Stripe webhook log
--   event_id = Stripe evt_xxx (UNIQUE = idempotency anchor per RESEARCH §Pattern 1)
-- =============================================================================
create table public.subscription_events (
  event_id text primary key,
  event_type text not null,
  subscription_id text references public.subscriptions(id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create index idx_subscription_events_type_received
  on public.subscription_events(event_type, received_at desc);

-- =============================================================================
-- 5. Enable RLS on all 4 tables
-- =============================================================================
alter table public.stripe_customers enable row level security;
alter table public.clinic_stripe_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;

-- =============================================================================
-- 6. RLS Policies
-- =============================================================================

-- stripe_customers: user reads their own row only.
create policy "users read own customer" on public.stripe_customers
  for select to authenticated
  using (auth.uid() = user_id);

-- clinic_stripe_customers: Owner-role members of the clinic can read.
-- Using EXISTS on memberships + roles join (not has_permission) because
-- 'billing' is not a registered permission key in Phase 9's permissions catalog.
create policy "clinic admins read clinic customer" on public.clinic_stripe_customers
  for select to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
      where m.org_id = clinic_stripe_customers.clinic_id
        and m.user_id = auth.uid()
        and m.revoked_at is null
        and r.name = 'Owner'
    )
  );

-- subscriptions: user reads own (user-tier) OR clinic Owner reads clinic-tier.
create policy "users read own sub" on public.subscriptions
  for select to authenticated
  using (
    auth.uid() = user_id
    or (
      clinic_id is not null
      and exists (
        select 1
        from public.memberships m
        join public.roles r on r.id = m.role_id
        where m.org_id = subscriptions.clinic_id
          and m.user_id = auth.uid()
          and m.revoked_at is null
          and r.name = 'Owner'
      )
    )
  );

-- subscription_events: service_role only; no policies = deny-all for authenticated.
-- The webhook handler (14-03) writes these rows as service_role (RLS-bypassed).
-- An authenticated user forging a fake webhook event would need to INSERT into this
-- table, which RLS denies (T-14-04 mitigated).

-- =============================================================================
-- 7. count_active_patients — SECURITY DEFINER billing counter
--
-- Returns the count of "active" patients in an org for metered billing.
-- Active = View-only member (the patient-tier role) with revoked_at IS NULL
-- AND at least 1 row in {injections, weights, meals, workouts, symptoms}
-- in the last 30 rolling days (D-02).
--
-- Auth gating: when called by authenticated (clinic billing surface in
-- Wave 3), the caller MUST be an Owner of the clinic. Service-role callers
-- (monthly true-up Edge Function) bypass gating via auth.uid() = NULL.
--
-- Pitfall 2: SET search_path = public, extensions (SECURITY DEFINER + pgcrypto).
-- LANGUAGE plpgsql (not sql) to allow RAISE EXCEPTION on unauthorized callers.
-- STABLE volatility — does not mutate data, safe for RLS plan caching.
-- =============================================================================
create or replace function public.count_active_patients(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  -- Service-role bypass: Edge Function / cron callers have no JWT; auth.uid() = NULL.
  -- Authenticated bypass: require Owner role on the clinic.
  if v_uid is not null then
    if not exists (
      select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
      where m.org_id = p_clinic_id
        and m.user_id = v_uid
        and m.revoked_at is null
        and r.name = 'Owner'
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- Count distinct patients: View-only members (patient-tier) with recent activity.
  -- View-only is the default role patients receive on invite acceptance (Phase 9).
  select count(distinct m.user_id)::integer into v_count
  from public.memberships m
  join public.roles r on r.id = m.role_id
  where m.org_id = p_clinic_id
    and m.revoked_at is null
    and r.name = 'View-only'
    and exists (
      select 1 from public.injections i
        where i.user_id = m.user_id and i.created_at > now() - interval '30 days'
      union all
      select 1 from public.weights w
        where w.user_id = m.user_id and w.created_at > now() - interval '30 days'
      union all
      select 1 from public.meals me
        where me.user_id = m.user_id and me.created_at > now() - interval '30 days'
      union all
      select 1 from public.workouts wo
        where wo.user_id = m.user_id and wo.created_at > now() - interval '30 days'
      union all
      select 1 from public.symptoms s
        where s.user_id = m.user_id and s.created_at > now() - interval '30 days'
      limit 1
    );

  return v_count;
end;
$$;

revoke all on function public.count_active_patients(uuid) from public;
grant execute on function public.count_active_patients(uuid) to service_role;
grant execute on function public.count_active_patients(uuid) to authenticated;
