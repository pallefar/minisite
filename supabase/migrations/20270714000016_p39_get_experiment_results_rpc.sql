-- Phase 39 Plan 39-07 — get_experiment_results SECDEF RPC.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-01 (composite_score is the multiplicative gate),
--   D-11 (warned_at + archived_at = 42-day lifecycle banners),
--   D-12 (posterior drives the Bayesian badge tri-state + Ship-Winner gate),
--   PAGEAB-07 (admin reads posterior to render badge),
--   PAYWALL-03/04 (admin reads composite_score + refund rate).
--
-- Purpose:
--   Admin-only RPC returning per-variant ExperimentRow[] for the
--   ExperimentDashboardPage shell (39-06) sub-tab content (39-07/08). Joins
--   variant_config + experiment_results matview + cohort_definitions for the
--   labels. Filters by p_surface so each Pill tab gets only its surface's rows.
--
-- Pattern S2 (Pattern A in 39-PATTERNS.md): SECDEF-only writes, but THIS is
--   a read RPC — the SECDEF wrapper exists so that:
--     (a) the matview / underlying tables can stay strictly admin-RLS (no
--         row-level user filter at the table layer),
--     (b) the gate is enforced ONCE here, by ordinal role comparator, with no
--         direct table grants to authenticated.
--
-- Pattern memory invariants:
--   - [[reference_supabase_migration_gotchas]]: SECURITY DEFINER requires
--     `set search_path = extensions, public, pg_temp`.
--   - [[feedback_rpc_auth_uid_vs_service_role_mismatch]]: this RPC is called
--     from the BROWSER (CACDashboardPage-pattern admin polling), NOT from a
--     service-role Edge Fn — so auth.uid() reflects the admin's identity and
--     is_admin_at_least() works correctly.
--
-- Filename: 20270714000016 — strict 14-digit underscore per
--   [[reference_supabase_migration_filename_regex]]. Pre-flight verified slot
--   16 + 17 are the next free after Plan 39-03's 20270714000015.

create or replace function public.get_experiment_results(p_surface text)
returns table (
  variant_id               uuid,
  variant_name             text,
  surface                  text,
  cohort_id                uuid,
  cohort_label             text,
  sample_size              bigint,
  paid_rate                numeric,
  retention_30d_rate       numeric,
  composite_score          numeric,
  posterior                numeric,
  refund_rate_7d           numeric,
  refund_rate_baseline_30d numeric,
  warned_at                timestamptz,
  archived_at              timestamptz,
  created_at               timestamptz
)
language plpgsql
stable
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  -- D-12 + Pattern S2: admin role gate at the RPC level.
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden_not_admin'
      using errcode = '42501', hint = 'get_experiment_results requires admin role.';
  end if;

  -- Validate the surface filter (mirrors variant_config check constraint).
  if p_surface is null or p_surface not in ('paywall', 'page', 'pharma') then
    raise exception 'invalid_surface'
      using errcode = '22023', hint = 'surface must be one of (paywall, page, pharma).';
  end if;

  return query
  select
    vc.id                                                    as variant_id,
    coalesce(vc.config->>'name', 'variant_' || left(vc.id::text, 8))
                                                             as variant_name,
    vc.surface                                               as surface,
    vc.cohort_id                                             as cohort_id,
    cd.name                                                  as cohort_label,
    coalesce(er.sample_size, 0::bigint)                      as sample_size,
    er.paid_rate                                             as paid_rate,
    er.retention_30d_rate                                    as retention_30d_rate,
    -- D-01 composite: prefer the matview's pre-computed value; fall back to
    -- variant_config.composite_score (populated by the refresh path) when the
    -- matview row hasn't been materialized yet for this variant.
    coalesce(er.composite_score, vc.composite_score)         as composite_score,
    coalesce(er.posterior, vc.posterior)                     as posterior,
    er.refund_rate_7d                                        as refund_rate_7d,
    -- refund_rate_baseline_30d is populated by Wave-2 refresh extension
    -- (Plan 39-10 close-out joins refund baseline computation). Until then
    -- the column surfaces as NULL — the UI tolerates null and the kill-switch
    -- cron path uses its own baseline computation independent of this RPC.
    null::numeric                                            as refund_rate_baseline_30d,
    vc.warned_at                                             as warned_at,
    vc.archived_at                                           as archived_at,
    vc.created_at                                            as created_at
  from public.variant_config vc
  left join public.experiment_results er
    on er.variant_id = vc.id and er.surface = vc.surface
  left join public.cohort_definitions cd
    on cd.id = vc.cohort_id
  where vc.surface = p_surface
  order by vc.created_at desc;
end;
$$;

comment on function public.get_experiment_results(text) is
  'Phase 39 D-01/D-11/D-12: admin-only SECDEF RPC returning per-variant '
  'ExperimentRow[] for the ExperimentDashboardPage sub-tabs. Joins '
  'variant_config + experiment_results matview + cohort_definitions. '
  'Gated by is_admin_at_least(admin). Pattern S2.';

-- Browser-callable from admin context: authenticated + anon, but the
-- SECDEF body short-circuits on non-admin via is_admin_at_least.
revoke all on function public.get_experiment_results(text) from public;
grant execute on function public.get_experiment_results(text)
  to authenticated;
