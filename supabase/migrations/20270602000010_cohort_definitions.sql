-- Phase 27 Plan 27-02 — ADMIN-05 + TAXO-03 cohort definitions table + profile view.
--
-- CONTEXT references:
--   - D-05: JSONB rule tree + visual builder UI.
--   - D-06: 15-field allowlist.
--   - D-07: matview + indexed read consumer pattern.
--   - D-09: cohort lifecycle status enum.
--   - D-20: schema additions list.
--
-- This migration ships THREE objects:
--   1. `cohort_definitions` — the catalog of cohorts. Each row stores the
--      user-authored rule (jsonb), the TS-translator-emitted SQL fragment
--      (compiled_sql text — single source of truth for what gets executed at
--      rebuild time), and a status enum {draft, active, archived}.
--   2. `cohort_profile_view` — a security_invoker view exposing the 15
--      cohort-eligible fields on profiles, with `null::<type>` placeholders
--      for fields whose backing columns don't yet exist (active_streak_days
--      pre-P35, anomaly_flagged pre-P26 wiring, etc.). The cohort rebuild
--      routine joins against this view by alias `p`, so the TS translator
--      can emit `p.tier`, `p.country`, etc. unconditionally.
--   3. RLS — SELECT for admins, NO INSERT/UPDATE/DELETE policies (SECDEF
--      RPCs in 20260601000012_cohort_rpcs.sql are the only writers, per
--      Pattern S2).
--
-- Matview vs table for cohort_membership: see 20260601000011 — we use a
-- regular materialized TABLE because each cohort needs its own dynamic SQL
-- WHERE clause (the translator output), which a static `create materialized
-- view` body cannot express.

-- ============================================================================
-- 1. cohort_definitions
-- ============================================================================
create table if not exists public.cohort_definitions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  rule         jsonb not null,
  compiled_sql text not null,
  status       text not null default 'draft'
               check (status in ('draft', 'active', 'archived')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.cohort_definitions is
  'ADMIN-05 + TAXO-03: catalog of admin-authored cohorts. `rule` is the JSONB '
  'tree shown in the visual builder; `compiled_sql` is the TS-translator '
  'output used at matview rebuild time (single source of truth). Status enum: '
  'draft (just created), active (populated into cohort_membership), archived '
  '(excluded from rebuild). Writes go through SECDEF RPCs only.';

comment on column public.cohort_definitions.compiled_sql is
  'TS rule-tree-to-sql.ts output. Always references columns on '
  'public.cohort_profile_view via the `p` alias. Plpgsql cohort_validate_rule '
  'gates the jsonb shape at insert time (defense-in-depth layer #3).';

-- Index on status for the rebuild routine's `where status='active'` predicate.
create index if not exists cohort_definitions_status_idx
  on public.cohort_definitions(status);

-- ============================================================================
-- 2. RLS — admin-readable; SECDEF RPCs are the only writers
-- ============================================================================
alter table public.cohort_definitions enable row level security;

-- SELECT policy: any admin can list cohorts (needed for AdminCohortList UI).
create policy pol_cohort_definitions_admin_select
  on public.cohort_definitions
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- NO insert/update/delete policies — Pattern S2: writes only via SECDEF RPCs
-- (cohort_define, cohort_set_status, cohort_archive in 20260601000012). The
-- absence of policies = denial-by-default under RLS.

-- ============================================================================
-- 3. cohort_profile_view — the 15-field surface the translator targets
-- ============================================================================
-- This view aliases to `p` in the cohort_membership_rebuild loop. Each column
-- matches a FIELD_ALLOWLIST entry from leanshot/src/lib/cohort/field-allowlist.ts.
-- Fields whose backing column does not yet exist on `public.profiles` are
-- emitted as `null::<type>` — the translator's SQL fragment still parses, but
-- the comparison yields NULL → row is excluded (correct for v1 ship before
-- consumer plans wire each column).
--
-- security_invoker = true so this view honors the caller's RLS on `profiles`;
-- the rebuild routine runs SECURITY DEFINER (postgres role) so it bypasses RLS
-- intentionally at rebuild time.

create or replace view public.cohort_profile_view
  with (security_invoker = true)
as
select
  p.id                                                              as id,
  null::text                                                        as tier,
  case
    when p.admin_role is not null then p.admin_role::text
    else 'patient'
  end                                                               as role,
  greatest(0, extract(day from (now() - u.created_at)))::int        as days_since_signup,
  case
    when u.last_sign_in_at is null then null::int
    else greatest(0, extract(day from (now() - u.last_sign_in_at)))::int
  end                                                               as days_since_last_login,
  null::bigint                                                      as total_paid_amount_cents,
  null::int                                                         as active_streak_days,
  coalesce(t.has_active, false)                                     as has_active_subscription,
  null::text                                                        as signup_source,
  null::text                                                        as country,
  null::text                                                        as language,
  (p.primary_org_id is not null)                                    as has_org,
  (p.completed_onboarding_at is not null)                           as has_completed_onboarding,
  null::boolean                                                     as is_affiliate,
  null::boolean                                                     as anomaly_flagged,
  'active'::text                                                    as account_state
from public.profiles p
left join auth.users u on u.id = p.id
left join public.tier_effective t on t.user_id = p.id;

comment on view public.cohort_profile_view is
  'Phase 27 Plan 27-02: 15-field surface for cohort rule evaluation. Maps to '
  'FIELD_ALLOWLIST in leanshot/src/lib/cohort/field-allowlist.ts. Fields whose '
  'backing column does not yet exist on public.profiles are emitted as '
  'null::<type> placeholders (will yield 0-row matches until consumer phases '
  'wire each column). Joined as `p` by cohort_membership_rebuild().';

grant select on public.cohort_profile_view to service_role;

-- ============================================================================
-- 4. updated_at trigger (consistency with Phase 24 audit-trigger pattern)
-- ============================================================================
create or replace function public.cohort_definitions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cohort_definitions_set_updated_at on public.cohort_definitions;
create trigger cohort_definitions_set_updated_at
  before update on public.cohort_definitions
  for each row
  execute function public.cohort_definitions_updated_at();
