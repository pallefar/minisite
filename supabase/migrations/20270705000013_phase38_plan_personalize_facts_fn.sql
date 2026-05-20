-- Phase 38 Plan 38-06 (RECOMMEND-09) — `plan_personalize_facts` RPC.
--
-- Single SQL round-trip backing the `plan-personalize` Edge Function (D-16).
-- The Edge Fn applies a rule cascade to the returned facts; this function
-- ONLY assembles facts and is the hot-path query (must support <50ms p99
-- per D-17, hence the LEFT JOINs against optional tables that may not yet
-- exist in earlier deployments).
--
-- Graceful degradation contract (D-17):
--   - profiles row MUST exist or fn returns NULL (→ 404 at the edge).
--   - paywall_events, activation_events, plan_history are OPTIONAL.
--     This migration creates each table IF NOT EXISTS as a minimal shell
--     so the joins always resolve; later phases (Phase 39 paywall, Phase 14
--     Stripe extensions, future Phase 34 activation) can ALTER TABLE to
--     enrich. Until then the columns are NULL/zero and the rule cascade
--     falls back to extended_trial (R5) safely.
--   - plan_tier is sourced from public.subscriptions (Phase 14):
--       ux_tier='paid' + billing interval = 'month' → 'paid_monthly'
--       ux_tier='paid' + billing interval = 'year'  → 'paid_annual'
--       status='trialing'                            → 'trial'
--       otherwise                                    → 'free'
--
-- Threat-model:
--   - T-38-29 (DoS): single SQL round-trip; indexes on user_id columns.
--   - SECURITY DEFINER: the Edge Fn calls this via service-role anyway,
--     but DEFINER lets the Fn be safely invoked by anon callers without
--     loosening RLS on the underlying tables.
--   - reference_supabase_migration_gotchas Pitfall 2: SET search_path
--     includes extensions for any future pgcrypto/pg_trgm use.

-- ============================================================================
-- 0. Pre-create optional source tables (idempotent — Phase 14/34/39 may have
--    already shipped them with richer schemas; IF NOT EXISTS is a no-op then).
-- ============================================================================

-- paywall_events — Phase 39 will own this fully; minimal shell here so the
-- aggregate join in plan_personalize_facts always resolves.
create table if not exists public.paywall_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_paywall_events_user_dismissed
  on public.paywall_events (user_id)
  where event_type = 'dismissed';

-- activation_events — future Phase 34 owner; minimal shell.
create table if not exists public.activation_events (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activated_at timestamptz,
  activation_score numeric(3, 2) check (activation_score is null or (activation_score >= 0 and activation_score <= 1)),
  updated_at timestamptz not null default now()
);

-- plan_history — future Stripe-extensions owner; minimal shell.
create table if not exists public.plan_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  changed_at timestamptz not null default now(),
  from_plan text,
  to_plan text
);

create index if not exists idx_plan_history_user_changed
  on public.plan_history (user_id, changed_at desc);

-- ============================================================================
-- 1. plan_personalize_facts — the hot-path fact assembler.
-- ============================================================================

create or replace function public.plan_personalize_facts(p_user_id uuid)
returns table (
  signup_at          timestamptz,
  plan_tier          text,
  is_active          boolean,
  activated_at       timestamptz,
  activation_score   numeric,
  paywall_dismissals integer,
  trial_end          timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog, extensions
as $$
  with sub as (
    -- Pick the most recent active/trialing subscription per user.
    select
      s.user_id,
      s.status,
      s.ux_tier,
      s.plan_id,
      s.trial_end,
      s.current_period_end
    from public.subscriptions s
    where s.user_id = p_user_id
    order by s.updated_at desc
    limit 1
  ),
  dismiss as (
    select count(*)::int as cnt
    from public.paywall_events
    where user_id = p_user_id and event_type = 'dismissed'
  )
  select
    p.created_at                                            as signup_at,
    case
      when sub.status = 'trialing'                          then 'trial'
      when sub.ux_tier = 'paid' and sub.plan_id ilike '%annual%' then 'paid_annual'
      when sub.ux_tier = 'paid' and sub.plan_id ilike '%year%'   then 'paid_annual'
      when sub.ux_tier = 'paid'                             then 'paid_monthly'
      else 'free'
    end                                                     as plan_tier,
    coalesce(sub.status in ('active', 'trialing'), false)   as is_active,
    act.activated_at                                        as activated_at,
    act.activation_score                                    as activation_score,
    coalesce(dismiss.cnt, 0)                                as paywall_dismissals,
    sub.trial_end                                           as trial_end
  from public.profiles p
  left join sub on true
  left join public.activation_events act on act.user_id = p.id
  cross join dismiss
  where p.id = p_user_id;
$$;

comment on function public.plan_personalize_facts(uuid) is
  'Phase 38 Plan 38-06 — single-roundtrip fact assembler for plan-personalize Edge Fn. '
  'Returns NULL row when profile does not exist (→ 404 at the edge).';

-- Allow the service_role and authenticated to call (function is SECDEF; RLS
-- bypass is intentional but the function is read-only and returns no PII
-- beyond aggregate counts + tier label).
grant execute on function public.plan_personalize_facts(uuid) to authenticated, service_role;
