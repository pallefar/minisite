-- Phase 66.5 Plan 01 Task 1 — SEC-01: Enable RLS on 7 RLS-disabled public tables.
--
-- Source-of-truth: leanshot/.planning/phases/66-consumer-account-security/66-SUPABASE-ADVISORS.json
-- Advisor link:    https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
-- Findings count:  7 ERROR-level rls_disabled_in_public entries.
--
-- Tables (all written by Edge Fns / cron / Stripe webhook via service_role):
--   1. email_send_counters
--   2. ad_spend_facts_y2026m05
--   3. ad_spend_facts_y2026m06
--   4. ad_spend_facts_y2026m07
--   5. ad_spend_facts_y2026m08
--   6. paywall_events
--   7. plan_history
--
-- Policy shape (per Phase 66.5 D-01): "deny-all to authenticated".
--   - service_role is RLS-exempt → no explicit bypass policy needed.
--   - `using (false) with check (false)` blocks all PostgREST access from
--     `authenticated` and `anon` roles (anon hits the same surface).
--   - If a future plan needs a SELECT-only path, add a targeted policy then.
--
-- Drift-safety (per `[[feedback_phase_close_out_supabase_gotchas]]` + Phase 65 lessons):
--   - Each `ALTER TABLE` and `CREATE POLICY` is wrapped in a DO-block with
--     `EXCEPTION WHEN undefined_table THEN ...` so the migration is idempotent
--     against tables that may have been dropped during the Phase 65 / Phase 66
--     `org_subscriptions` drift recovery.
--   - `drop policy if exists` BEFORE `create policy` makes the migration replayable.
--   - `CREATE POLICY IF NOT EXISTS` is NOT used (remote PG rejects it).
--
-- Deploy gate (per Phase 66.5 D-06): forward-dated to 20290106000001;
-- actual `supabase db push` deferred to Phase 70 once 65/66 drift is resolved.

-- ============================================================
-- 1. email_send_counters
-- ============================================================
do $$
begin
  alter table public.email_send_counters enable row level security;
exception when undefined_table then
  raise notice 'public.email_send_counters does not exist on remote; skipping RLS enable (drift)';
end $$;

do $$
begin
  drop policy if exists "email_send_counters_deny_all_authenticated" on public.email_send_counters;
  create policy "email_send_counters_deny_all_authenticated"
    on public.email_send_counters
    for all
    to authenticated
    using (false)
    with check (false);
exception when undefined_table then
  raise notice 'public.email_send_counters does not exist on remote; skipping policy';
end $$;

do $$
begin
  comment on table public.email_send_counters is
    'Service-role-only write; RLS enabled per Phase 66.5 SEC-01.';
exception when undefined_table then null;
end $$;

-- ============================================================
-- 2. ad_spend_facts_y2026m05
-- ============================================================
do $$
begin
  alter table public.ad_spend_facts_y2026m05 enable row level security;
exception when undefined_table then
  raise notice 'public.ad_spend_facts_y2026m05 does not exist on remote; skipping RLS enable (drift)';
end $$;

do $$
begin
  drop policy if exists "ad_spend_facts_y2026m05_deny_all_authenticated" on public.ad_spend_facts_y2026m05;
  create policy "ad_spend_facts_y2026m05_deny_all_authenticated"
    on public.ad_spend_facts_y2026m05
    for all
    to authenticated
    using (false)
    with check (false);
exception when undefined_table then
  raise notice 'public.ad_spend_facts_y2026m05 does not exist on remote; skipping policy';
end $$;

do $$
begin
  comment on table public.ad_spend_facts_y2026m05 is
    'Ad-ETL Edge Fn write; RLS enabled per Phase 66.5 SEC-01.';
exception when undefined_table then null;
end $$;

-- ============================================================
-- 3. ad_spend_facts_y2026m06
-- ============================================================
do $$
begin
  alter table public.ad_spend_facts_y2026m06 enable row level security;
exception when undefined_table then
  raise notice 'public.ad_spend_facts_y2026m06 does not exist on remote; skipping RLS enable (drift)';
end $$;

do $$
begin
  drop policy if exists "ad_spend_facts_y2026m06_deny_all_authenticated" on public.ad_spend_facts_y2026m06;
  create policy "ad_spend_facts_y2026m06_deny_all_authenticated"
    on public.ad_spend_facts_y2026m06
    for all
    to authenticated
    using (false)
    with check (false);
exception when undefined_table then
  raise notice 'public.ad_spend_facts_y2026m06 does not exist on remote; skipping policy';
end $$;

do $$
begin
  comment on table public.ad_spend_facts_y2026m06 is
    'Ad-ETL Edge Fn write; RLS enabled per Phase 66.5 SEC-01.';
exception when undefined_table then null;
end $$;

-- ============================================================
-- 4. ad_spend_facts_y2026m07
-- ============================================================
do $$
begin
  alter table public.ad_spend_facts_y2026m07 enable row level security;
exception when undefined_table then
  raise notice 'public.ad_spend_facts_y2026m07 does not exist on remote; skipping RLS enable (drift)';
end $$;

do $$
begin
  drop policy if exists "ad_spend_facts_y2026m07_deny_all_authenticated" on public.ad_spend_facts_y2026m07;
  create policy "ad_spend_facts_y2026m07_deny_all_authenticated"
    on public.ad_spend_facts_y2026m07
    for all
    to authenticated
    using (false)
    with check (false);
exception when undefined_table then
  raise notice 'public.ad_spend_facts_y2026m07 does not exist on remote; skipping policy';
end $$;

do $$
begin
  comment on table public.ad_spend_facts_y2026m07 is
    'Ad-ETL Edge Fn write; RLS enabled per Phase 66.5 SEC-01.';
exception when undefined_table then null;
end $$;

-- ============================================================
-- 5. ad_spend_facts_y2026m08
-- ============================================================
do $$
begin
  alter table public.ad_spend_facts_y2026m08 enable row level security;
exception when undefined_table then
  raise notice 'public.ad_spend_facts_y2026m08 does not exist on remote; skipping RLS enable (drift)';
end $$;

do $$
begin
  drop policy if exists "ad_spend_facts_y2026m08_deny_all_authenticated" on public.ad_spend_facts_y2026m08;
  create policy "ad_spend_facts_y2026m08_deny_all_authenticated"
    on public.ad_spend_facts_y2026m08
    for all
    to authenticated
    using (false)
    with check (false);
exception when undefined_table then
  raise notice 'public.ad_spend_facts_y2026m08 does not exist on remote; skipping policy';
end $$;

do $$
begin
  comment on table public.ad_spend_facts_y2026m08 is
    'Ad-ETL Edge Fn write; RLS enabled per Phase 66.5 SEC-01.';
exception when undefined_table then null;
end $$;

-- ============================================================
-- 6. paywall_events
-- ============================================================
do $$
begin
  alter table public.paywall_events enable row level security;
exception when undefined_table then
  raise notice 'public.paywall_events does not exist on remote; skipping RLS enable (drift)';
end $$;

do $$
begin
  drop policy if exists "paywall_events_deny_all_authenticated" on public.paywall_events;
  create policy "paywall_events_deny_all_authenticated"
    on public.paywall_events
    for all
    to authenticated
    using (false)
    with check (false);
exception when undefined_table then
  raise notice 'public.paywall_events does not exist on remote; skipping policy';
end $$;

do $$
begin
  comment on table public.paywall_events is
    'Edge Fn / web write; RLS enabled per Phase 66.5 SEC-01.';
exception when undefined_table then null;
end $$;

-- ============================================================
-- 7. plan_history
-- ============================================================
do $$
begin
  alter table public.plan_history enable row level security;
exception when undefined_table then
  raise notice 'public.plan_history does not exist on remote; skipping RLS enable (drift)';
end $$;

do $$
begin
  drop policy if exists "plan_history_deny_all_authenticated" on public.plan_history;
  create policy "plan_history_deny_all_authenticated"
    on public.plan_history
    for all
    to authenticated
    using (false)
    with check (false);
exception when undefined_table then
  raise notice 'public.plan_history does not exist on remote; skipping policy';
end $$;

do $$
begin
  comment on table public.plan_history is
    'Stripe webhook write; RLS enabled per Phase 66.5 SEC-01.';
exception when undefined_table then null;
end $$;
