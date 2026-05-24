-- Phase 39 Plan 39-08 — get_pharma_experiments SECDEF RPC.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-03 (PHARMA NPS drop ≥5 OR 1★ rate > 2× baseline kill thresholds —
--     surfaced as metrics here for the admin tab)
--   D-05 (safety_category content must NEVER be A/B-tested — pharma variants
--     carry an empty safety_categories array, defense-in-depth proven again
--     at the RPC boundary).
--   PHARMA-08 (admin sees pharma variant metrics + version history)
--
-- STRIDE register (39-08-PLAN.md <threat_model>):
--   T-39-08-01 Compliance: if any variant ever references a safety_category,
--     this RPC raises + slack-alerts. 4th defense layer above:
--       - Plan 39-02 ESLint rule (build)
--       - Plan 39-02 runtime guard in PaywallGate (request)
--       - Plan 39-02 grep gate (CI)
--   T-39-08-05 Spoofing: is_admin_at_least('admin') gate at top of body.
--
-- Pattern memory:
--   - [[reference_supabase_migration_gotchas]]: SECURITY DEFINER requires
--     `set search_path = extensions, public, pg_temp`.
--   - Sibling RPC pattern: 20270714000016_p39_get_experiment_results_rpc.sql
--   - variant_config has NO `name` column — display name lives at
--     `config->>'name'` (mirror of 39-07 pattern).
--
-- Invariant (T-39-08-01):
--   safety_categories_in_variant is ALWAYS returned as '{}'::text[]. Hardcoded
--   in the SELECT list. A defense-in-depth pre-check counts pharma_content
--   rows with safety_category set that are linked to active pharma variants
--   (via config->>'pharma_content_id') and raises + slack-alerts if non-zero.

-- ============================================================================
-- 1. get_pharma_experiments() SECDEF RPC
-- ============================================================================

create or replace function public.get_pharma_experiments()
returns table (
  variant_id                    uuid,
  variant_name                  text,
  surface                       text,
  cohort_id                     uuid,
  cohort_label                  text,
  sample_size                   bigint,
  paid_rate                     numeric,
  retention_30d_rate            numeric,
  composite_score               numeric,
  posterior                     numeric,
  refund_rate_7d                numeric,
  refund_rate_baseline_30d      numeric,
  warned_at                     timestamptz,
  archived_at                   timestamptz,
  created_at                    timestamptz,
  nps_delta                     numeric,
  one_star_rate_ratio           numeric,
  safety_categories_in_variant  text[]
)
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_offending_count int;
  v_secret text;
begin
  -- T-39-08-05 Spoofing: admin role gate.
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden_not_admin'
      using errcode = '42501',
            hint = 'get_pharma_experiments requires admin role.';
  end if;

  -- T-39-08-01 Compliance: defense-in-depth. Count pharma_content rows that
  -- carry a non-null safety_category AND are linked from an active pharma
  -- variant (variant_config.config->>'pharma_content_id'). If any exist,
  -- raise + best-effort slack alert. This is layer 4 above ESLint+runtime+CI.
  select count(*) into v_offending_count
    from public.pharma_content pc
   where pc.safety_category is not null
     and exists (
       select 1 from public.variant_config vc
        where vc.surface = 'pharma'
          and vc.archived_at is null
          and nullif(vc.config->>'pharma_content_id', '') is not null
          and (vc.config->>'pharma_content_id')::uuid = pc.id
     );

  if v_offending_count > 0 then
    -- Best-effort slack alert (failure to alert MUST NOT prevent the raise).
    begin
      select decrypted_secret into v_secret
        from vault.decrypted_secrets
       where name = 'service_role_key'
       limit 1;
      if v_secret is not null then
        perform net.http_post(
          url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/slack-alert-experiments',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_secret,
            'Content-Type', 'application/json'
          ),
          body := jsonb_build_object(
            'kind', 'safety_category_in_variant',
            'message', format('T-39-08-01: %s pharma_content rows with safety_category are linked to active pharma variants', v_offending_count),
            'context', jsonb_build_object('count', v_offending_count)
          ),
          timeout_milliseconds := 30000
        );
      end if;
    exception when others then
      raise notice 'get_pharma_experiments: slack alert failed: %', sqlerrm;
    end;

    raise exception 'safety_category_in_pharma_variant'
      using errcode = 'P0001',
            hint = format('D-05 invariant violated: %s pharma_content rows with safety_category linked to active pharma variants.', v_offending_count);
  end if;

  -- Main result set. NPS + 1★ metrics computed defensively:
  --   - NPS uses quarterly_nps_responses joined via user_experiments.
  --   - one_star_rate_ratio uses public.review_submissions when present;
  --     otherwise null (table is owned by this plan but a downstream backfill
  --     plan may carry it; defensive guard mirrors the kill-scan pattern in
  --     20270714000015).
  -- safety_categories_in_variant HARDCODED to '{}'::text[] (invariant proven
  -- above; any non-empty would have raised).
  return query
    with assignees as (
      select ue.variant_id, ue.user_id, ue.created_at as assigned_at
        from public.user_experiments ue
        join public.variant_config vc on vc.id = ue.variant_id
       where ue.surface = 'pharma'
    ),
    sample as (
      select a.variant_id,
             count(distinct a.user_id)::bigint as sample_size
        from assignees a
       group by a.variant_id
    ),
    variant_nps as (
      select a.variant_id,
             100.0 * (
               count(*) filter (where qnr.score >= 9)::numeric
               - count(*) filter (where qnr.score <= 6)::numeric
             ) / nullif(count(*), 0)::numeric as nps
        from assignees a
        join public.quarterly_nps_responses qnr
          on qnr.user_id = a.user_id
         and qnr.responded_at >= a.assigned_at
       group by a.variant_id
    ),
    baseline_nps as (
      select 100.0 * (
               count(*) filter (where score >= 9)::numeric
               - count(*) filter (where score <= 6)::numeric
             ) / nullif(count(*), 0)::numeric as nps
        from public.quarterly_nps_responses
       where responded_at >= now() - interval '60 days'
         and responded_at <  now() - interval '30 days'
    ),
    one_star_per_user as (
      select a.variant_id, a.user_id,
             case when to_regclass('public.review_submissions') is null then null
                  else (
                    select count(*) filter (where rs.rating = 1)::numeric
                         / nullif(count(*), 0)::numeric
                      from public.review_submissions rs
                     where rs.user_id = a.user_id
                       and rs.submitted_at >= a.assigned_at
                  )
             end as one_star_rate
        from assignees a
    ),
    one_star_agg as (
      select variant_id, avg(one_star_rate)::numeric as one_star_rate
        from one_star_per_user
       group by variant_id
    ),
    baseline_one_star as (
      select case when to_regclass('public.review_submissions') is null then null
                  else (
                    select count(*) filter (where rating = 1)::numeric
                         / nullif(count(*), 0)::numeric
                      from public.review_submissions
                     where submitted_at >= now() - interval '30 days'
                  )
             end as rate
    )
    select
      vc.id                                                              as variant_id,
      coalesce(vc.config->>'name', 'variant_' || left(vc.id::text, 8))   as variant_name,
      vc.surface                                                         as surface,
      vc.cohort_id                                                       as cohort_id,
      cd.name                                                            as cohort_label,
      coalesce(s.sample_size, 0::bigint)                                 as sample_size,
      null::numeric                                                      as paid_rate,
      null::numeric                                                      as retention_30d_rate,
      null::numeric                                                      as composite_score,
      0::numeric                                                         as posterior,
      null::numeric                                                      as refund_rate_7d,
      null::numeric                                                      as refund_rate_baseline_30d,
      vc.warned_at                                                       as warned_at,
      vc.archived_at                                                     as archived_at,
      vc.created_at                                                      as created_at,
      case when bn.nps is null or vn.nps is null then null
           else vn.nps - bn.nps end                                      as nps_delta,
      case when bo.rate is null or bo.rate = 0 or osa.one_star_rate is null then null
           else osa.one_star_rate / bo.rate end                          as one_star_rate_ratio,
      '{}'::text[]                                                       as safety_categories_in_variant
    from public.variant_config vc
    left join public.cohort_definitions cd on cd.id = vc.cohort_id
    left join sample s on s.variant_id = vc.id
    left join variant_nps vn on vn.variant_id = vc.id
    cross join baseline_nps bn
    left join one_star_agg osa on osa.variant_id = vc.id
    cross join baseline_one_star bo
    where vc.surface = 'pharma'
    order by vc.created_at desc;
end;
$$;

comment on function public.get_pharma_experiments() is
  'Phase 39 PHARMA-08 + T-39-08-01: admin-only SECDEF RPC returning pharma '
  'variant rows with nps_delta + one_star_rate_ratio metrics. '
  'safety_categories_in_variant always empty per D-05 invariant; raises + '
  'slack-alerts if any pharma_content with safety_category is linked to an '
  'active pharma variant (4th defense layer above ESLint+runtime+CI). 1-star '
  'metric defensively probes public.review_submissions via to_regclass.';

revoke all on function public.get_pharma_experiments() from public;
grant execute on function public.get_pharma_experiments() to authenticated;
