-- Phase 36 Plan 36-04 Task 1 — REVIEW-07 funnel-aggregate SECDEF RPC.
--
-- CONTEXT references:
--   - REVIEW-07: per-funnel dashboard (Surface E) — funnel chart + per-variant breakdown.
--   - B2 + W5 fix (plan-checker iter-1):
--     by_variant breakdown is sourced DIRECTLY from review_prompt_history.copy_variant.
--     The column is added in 36-01 Task 1; Wave 2 writes it on every history INSERT.
--     NO events_mirror fallback path exists — the history table is the
--     authoritative source for variant attribution.
--
-- Per [[reference_supabase_migration_gotchas]]:
--   - SECURITY DEFINER + SET search_path = public, extensions.
--   - REVOKE from public/anon; GRANT to authenticated for admin RPC.
--
-- Per [[reference_rpc_auth_uid_vs_service_role_mismatch]]:
--   - This RPC references auth.uid() and MUST be called with a forwarded user JWT
--     (anon-key + Authorization header), NOT service-role.
--
-- Threat coverage (from 36-04 PLAN.md threat_model):
--   - T-36-21: Pattern S1 server-side admin gate (mirror of Wave 1 RPCs).
--   - T-36-24: returns aggregate counts only; no user_id rows leak in the result set.
--   - T-36-38: B2/W5 — copy_variant is read directly from review_prompt_history,
--             eliminating the variant-attribution drift surface that an
--             events_mirror fallback would introduce.

begin;

-- ============================================================================
-- review_funnel_aggregate(p_window_days int)
-- Returns 1 row { prompts_shown, rated_internal, external_clicked, by_variant }.
-- ============================================================================
create or replace function public.review_funnel_aggregate(
  p_window_days int
) returns table (
  prompts_shown   bigint,
  rated_internal  bigint,
  external_clicked bigint,
  by_variant      jsonb
)
language plpgsql
security definer
stable
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_admin_role text;
  v_cutoff timestamptz;
  v_prompts bigint;
  v_rated bigint;
  v_external bigint;
  v_by_variant jsonb;
begin
  -- Admin gate (Pattern S1 — mirrors Wave 1 SECDEF RPCs in 20270710000005).
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  select admin_role into v_admin_role from public.profiles where id = v_user_id;
  if v_admin_role is null or v_admin_role not in ('admin','superadmin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Defensive window normalization: clamp to non-negative integers.
  if p_window_days is null or p_window_days < 0 then
    p_window_days := 30;
  end if;

  v_cutoff := now() - (p_window_days || ' days')::interval;

  -- Global funnel counts (prompts_shown + rated_internal in one pass).
  select
    count(*),
    count(*) filter (where rating_value is not null)
  into v_prompts, v_rated
  from public.review_prompt_history
  where fired_at > v_cutoff;

  -- by_variant: GROUP BY copy_variant directly on review_prompt_history (B2/W5).
  -- COALESCE folds NULL legacy rows into the 'control' bucket. NO events_mirror
  -- join — the history table is the single source of truth for variant
  -- attribution per Wave 1's B2 column ship.
  select coalesce(
    jsonb_object_agg(
      bucket,
      jsonb_build_object(
        'prompts_shown', cnt_total,
        'rated_internal', cnt_rated
      )
    ),
    '{}'::jsonb
  )
  into v_by_variant
  from (
    select
      coalesce(copy_variant, 'control') as bucket,
      count(*) as cnt_total,
      count(*) filter (where rating_value is not null) as cnt_rated
    from public.review_prompt_history
    where fired_at > v_cutoff
    group by coalesce(copy_variant, 'control')
  ) per_variant;

  -- external_clicked: stays on events_mirror (Pitfall 10 — client-side window.open
  -- path captures via nps-cta-click-log Edge Fn which dual-writes to events_mirror).
  -- This is the ONLY events_mirror reference in the function — it is for the
  -- global external_clicked count, NOT for by_variant attribution.
  select count(*)
  into v_external
  from public.events_mirror
  where event_name = 'external_review_clicked'
    and captured_at > v_cutoff;

  return query select
    coalesce(v_prompts, 0)::bigint,
    coalesce(v_rated, 0)::bigint,
    coalesce(v_external, 0)::bigint,
    coalesce(v_by_variant, '{}'::jsonb);
end;
$fn$;

revoke execute on function public.review_funnel_aggregate(int) from public, anon;
grant  execute on function public.review_funnel_aggregate(int) to authenticated;

comment on function public.review_funnel_aggregate(int) is
  'REVIEW-07 funnel aggregation (Surface E admin dashboard). Admin-gated SECDEF. '
  'by_variant reads copy_variant DIRECTLY from review_prompt_history (B2/W5 fix); '
  'NO events_mirror fallback. external_clicked counts events_mirror only.';

commit;
