-- Phase 33 Plan 01 — Migration 10
-- RLS deny policies for all 7 ad ETL tables: admin-only via is_admin() SECDEF (Phase 24).
--
-- Cross-tenant denial proof (reference_supabase_project.md rule):
-- Non-admin authenticated users MUST receive zero rows on SELECT from all 7 tables.
-- Each table has a vitest RLS denial test in Plan 33-05.
-- Expected behavior: anon + non-admin authenticated → RLS blocks all access (zero rows).
-- Only users where public.is_admin(auth.uid()) returns TRUE can read/write.
--
-- Tables covered:
--   1. ad_spend_facts       (partitioned — RLS applies to parent + auto-cascades to partitions)
--   2. ad_network_config
--   3. fx_rates
--   4. ad_etl_health
--   5. ad_etl_gaps
--   6. growth_targets
--   7. cac_alerts
--   8. etl_cursors          (guarded via DO block if table exists)

begin;

-- =============================================================================
-- 1. ad_spend_facts (partitioned — RLS on parent cascades to all partitions)
-- =============================================================================
alter table public.ad_spend_facts enable row level security;

create policy "ad_spend_facts_admin_all"
  on public.ad_spend_facts
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =============================================================================
-- 2. ad_network_config
-- =============================================================================
alter table public.ad_network_config enable row level security;

create policy "ad_network_config_admin_all"
  on public.ad_network_config
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =============================================================================
-- 3. fx_rates
-- =============================================================================
alter table public.fx_rates enable row level security;

create policy "fx_rates_admin_all"
  on public.fx_rates
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =============================================================================
-- 4. ad_etl_health
-- =============================================================================
alter table public.ad_etl_health enable row level security;

create policy "ad_etl_health_admin_all"
  on public.ad_etl_health
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =============================================================================
-- 5. ad_etl_gaps
-- =============================================================================
alter table public.ad_etl_gaps enable row level security;

create policy "ad_etl_gaps_admin_all"
  on public.ad_etl_gaps
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =============================================================================
-- 6. growth_targets
-- =============================================================================
alter table public.growth_targets enable row level security;

create policy "growth_targets_admin_all"
  on public.growth_targets
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =============================================================================
-- 7. cac_alerts
-- =============================================================================
alter table public.cac_alerts enable row level security;

create policy "cac_alerts_admin_all"
  on public.cac_alerts
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =============================================================================
-- 8. etl_cursors (RLS guard — applied via DO block in case table was pre-created
--    by another phase without RLS enabled)
-- =============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'etl_cursors'
  ) then
    execute 'alter table public.etl_cursors enable row level security';

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'etl_cursors'
        and policyname = 'etl_cursors_admin_all'
    ) then
      execute $policy$
        create policy "etl_cursors_admin_all"
          on public.etl_cursors
          for all
          using (public.is_admin(auth.uid()))
          with check (public.is_admin(auth.uid()))
      $policy$;
    end if;
  end if;
end;
$$;

commit;
