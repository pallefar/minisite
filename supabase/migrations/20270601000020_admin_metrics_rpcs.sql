-- Phase 22 Plan 22-08 — ADMIN-02 + ADMIN-08 server RPCs.
--
-- Two functions:
--   (1) admin_compute_mrr_arr(p_period text) — single-roundtrip aggregator for /admin/metrics.
--   (2) admin_get_cohort_retention(p_weeks int) — paginated cohort_retention proxy for /admin/cohorts.
--
-- D-04 (cross-phase contract from Phase 19): MRR/ARR derived from public.tier_effective view,
--   NOT from raw public.subscriptions.status — tier_effective MAX(current_period_end) reconciles
--   Stripe + (future) RevenueCat providers via has_active boolean.
--
-- D-05 (security boundary): both RPCs are SECURITY DEFINER with an explicit `is_staff` gate
--   in the function body. A non-staff caller receives SQLSTATE 42501 ("forbidden"). Search path
--   is pinned to (public, pg_catalog) per Supabase database-advisors lint 0011_function_search_path_mutable.
--
-- D-08 (k-anonymity contract): admin_get_cohort_retention returns RAW counts including cells
--   where active_users < 10. The CLIENT (CohortHeatmap.tsx) is responsible for rendering "<10"
--   instead of the exact count. This matches the design decision from Plan 22-01 — the view
--   stays general-purpose and the privacy-preserving display is owned by the React component.
--
-- v1.2 SIMPLIFICATION (documented in 22-08-SUMMARY.md follow-ups):
--   public.subscriptions has NO price_cents column at v1.2 — plan_id stores the Stripe price ID
--   (e.g. `price_plus_monthly_xxx`) but the cents value lives in Stripe, not the DB. Until we
--   add a price-catalog table or store cents on the subscription, MRR is computed by counting
--   active paid subscriptions × a constant `PLUS_MONTHLY_USD_CENTS = 999`. ARR = MRR × 12. The
--   churn rate uses count(canceled-last-30d) / count(active-30d-ago). Clinic-seat utilization
--   reads `public.orgs.seat_count` and counts active memberships per clinic.

-- =============================================================================
-- admin_compute_mrr_arr — single-call metrics aggregator for /admin/metrics.
-- =============================================================================
create or replace function public.admin_compute_mrr_arr(
  p_period text default '30d'
) returns jsonb
  security definer
  set search_path = public, pg_catalog
  language plpgsql
as $$
declare
  v_period_days int;
  v_now timestamptz := now();
  v_plus_monthly_cents constant int := 999;  -- v1.2 hardcoded; future: price-catalog lookup.
  v_mrr_cents bigint;
  v_paid_count bigint;
  v_free_count bigint;
  v_past_due_count bigint;
  v_clinic_seat_count bigint;
  v_churned_30d bigint;
  v_active_30d_ago bigint;
  v_churn_pct numeric;
  v_churn_series jsonb;
  v_clinic_utilization jsonb;
begin
  -- Auth gate (D-05). is_staff is checked against profiles.is_staff for auth.uid().
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and is_staff = true
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Period parser — drives only the churn_series resolution (KPIs are point-in-time).
  v_period_days := case p_period
    when '7d'  then 7
    when '30d' then 30
    when '90d' then 90
    when '12m' then 365
    else 30
  end;

  -- Paid-active count via tier_effective (D-04). One row per user_id; has_active = bool_or active/trialing.
  select count(*) into v_paid_count
    from public.tier_effective te
   where te.has_active = true;

  -- Past-due count.
  select count(*) into v_past_due_count
    from public.tier_effective te
   where te.has_past_due = true and te.has_active = false;

  -- Free-tier count = users WITHOUT an active sub row.
  select count(*) into v_free_count
    from auth.users u
   where not exists (
     select 1 from public.tier_effective te
      where te.user_id = u.id and te.has_active = true
   );

  -- Clinic seat-bound subs (counted separately from per-user paid).
  select count(*) into v_clinic_seat_count
    from public.subscriptions
   where clinic_id is not null
     and status in ('active','trialing');

  -- MRR (cents) = paid users × plus monthly price.
  -- Clinic seats are NOT folded in at v1.2 — their per-seat pricing depends on STRIPE_PRICE_CLINIC_OVERAGE
  -- env vars; the price is owed to a future price-catalog table. Documented as a follow-up.
  v_mrr_cents := v_paid_count * v_plus_monthly_cents;

  -- 30-day churn rate: canceled in last 30d / active 30 days ago.
  select count(*) into v_active_30d_ago
    from public.subscriptions
   where status in ('active','trialing')
     and created_at <= v_now - interval '30 days';

  select count(*) into v_churned_30d
    from public.subscriptions
   where status in ('canceled','incomplete_expired')
     and updated_at >= v_now - interval '30 days';

  v_churn_pct := case
    when v_active_30d_ago > 0 then (v_churned_30d::numeric / v_active_30d_ago) * 100
    else 0
  end;

  -- Churn series — monthly bins over the period window for the chart.
  -- jsonb array of {bucket: '2026-04', free: N, paid: N, churn_pct: N}.
  with months as (
    select generate_series(
      date_trunc('month', v_now - (v_period_days || ' days')::interval),
      date_trunc('month', v_now),
      interval '1 month'
    )::date as bucket_start
  ),
  bins as (
    select
      m.bucket_start,
      to_char(m.bucket_start, 'YYYY-MM') as bucket,
      (select count(*) from public.subscriptions s
         where s.created_at <= m.bucket_start + interval '1 month'
           and s.status in ('active','trialing')) as paid_in_bin,
      (select count(*) from auth.users u
         where u.created_at <= m.bucket_start + interval '1 month'
           and not exists (
             select 1 from public.subscriptions s2
              where s2.user_id = u.id
                and s2.created_at <= m.bucket_start + interval '1 month'
                and s2.status in ('active','trialing')
           )) as free_in_bin,
      (select count(*) from public.subscriptions s3
         where s3.status in ('canceled','incomplete_expired')
           and s3.updated_at between m.bucket_start and (m.bucket_start + interval '1 month')) as churned_in_bin
    from months m
  )
  select jsonb_agg(
    jsonb_build_object(
      'bucket', b.bucket,
      'free', b.free_in_bin,
      'paid', b.paid_in_bin,
      'churn_pct', case when b.paid_in_bin > 0
                        then round((b.churned_in_bin::numeric / b.paid_in_bin) * 100, 2)
                        else 0 end
    ) order by b.bucket_start
  ) into v_churn_series
  from bins b;

  -- Clinic-seat utilization — per-clinic seat counts.
  -- orgs.seat_count is the contracted ceiling; memberships count the actual.
  select jsonb_agg(
    jsonb_build_object(
      'clinic_id', o.id,
      'clinic_name', o.name,
      'used', coalesce(mc.member_count, 0),
      'total', o.seat_count,
      'series', '[]'::jsonb  -- v1.2: per-clinic seat history deferred; Sparkline gets flat array.
    ) order by o.name
  ) into v_clinic_utilization
  from public.orgs o
  left join lateral (
    select count(*) as member_count
      from public.memberships m
     where m.org_id = o.id
       and m.revoked_at is null
  ) mc on true
  where exists (
    select 1 from public.subscriptions s
     where s.clinic_id = o.id and s.status in ('active','trialing')
  );

  return jsonb_build_object(
    'period', p_period,
    'mrr_cents', v_mrr_cents,
    'arr_cents', v_mrr_cents * 12,
    'churn_pct_30d', round(v_churn_pct, 2),
    'paid_count', v_paid_count,
    'free_count', v_free_count,
    'past_due_count', v_past_due_count,
    'clinic_seat_count', v_clinic_seat_count,
    'churn_series', coalesce(v_churn_series, '[]'::jsonb),
    'clinic_seat_utilization', coalesce(v_clinic_utilization, '[]'::jsonb),
    'computed_at', v_now
  );
end;
$$;

comment on function public.admin_compute_mrr_arr(text) is
  'ADMIN-02 (Plan 22-08): single-call MRR/ARR/churn aggregator for /admin/metrics. '
  'is_staff-gated (42501 forbidden for non-staff). Reads tier_effective (Phase 19 D-04 contract) '
  'NOT raw subscriptions.tier. v1.2: paid_count × PLUS_MONTHLY_USD_CENTS — future enhancement '
  'is a price-catalog table to track per-plan cents.';

revoke all on function public.admin_compute_mrr_arr(text) from public;
grant execute on function public.admin_compute_mrr_arr(text) to authenticated;

-- =============================================================================
-- admin_get_cohort_retention — paginated proxy over cohort_retention view.
-- =============================================================================
create or replace function public.admin_get_cohort_retention(
  p_weeks int default 13
) returns table (
  cohort_week date,
  day_offset int,
  active_users int,
  retention_pct numeric,
  cohort_size int
)
  security definer
  set search_path = public, pg_catalog
  language plpgsql
as $$
begin
  -- Auth gate (D-05).
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and is_staff = true
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Sanity-cap p_weeks to prevent runaway queries; 52 weeks ≈ 1 year of cohorts.
  if p_weeks is null or p_weeks < 1 then p_weeks := 13; end if;
  if p_weeks > 52 then p_weeks := 52; end if;

  return query
    select
      cr.cohort_week,
      cr.day_offset,
      cr.active_users,
      cr.retention_pct,
      (select count(*)::int from auth.users u
        where date_trunc('week', u.created_at)::date = cr.cohort_week) as cohort_size
    from public.cohort_retention cr
    where cr.cohort_week >= (current_date - (p_weeks * 7))::date
    order by cr.cohort_week desc, cr.day_offset asc;
end;
$$;

comment on function public.admin_get_cohort_retention(int) is
  'ADMIN-08 (Plan 22-08): proxies public.cohort_retention view with is_staff gate (42501 forbidden). '
  'Returns raw active_users counts; k-anonymity guard (active_users < 10 → "<10" display) is '
  'enforced client-side in CohortHeatmap.tsx per T-22-10 mitigation (D-08).';

revoke all on function public.admin_get_cohort_retention(int) from public;
grant execute on function public.admin_get_cohort_retention(int) to authenticated;
