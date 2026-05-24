-- Phase 51 Plan 51-01 — is_retained(p_user_id, p_audience, p_window_days) SECDEF helper.
-- Decision refs: D-16 (cohort retention curves per channel D1/D7/D14/D30/D60),
-- CONTEXT §Specifics retention semantics.
-- Requirements: TRAFFIC-09.
--
-- Per-audience retention rule:
--   • consumer    — has any activity event in events_mirror within the window.
--   • clinic-org  — is org_member of an org whose public.subscriptions row has
--                   status='active' and current_period_end >= (now - window).
--   • affiliate   — has at least one paid/confirmed conversion within the
--                   window where they are the affiliate user.
--
-- The plan text references columns subscriptions.is_paid_seat /
-- subscriptions.activated_at / affiliate_referral_conversions.{affiliate_user_id,
-- converted_at} that DO NOT exist on this codebase (per 51-01 schema-existence
-- preflight 2026-05-24 against the linked project's migration set). The helper
-- has been adjusted to use the actual canonical columns:
--   • public.subscriptions (Phase 14): user_id, clinic_id, status, current_period_end
--   • public.affiliates (Phase 26): user_id (affiliate), id (affiliate FK)
--   • public.affiliate_conversions (Phase 26): affiliate_id, status, invoice_paid_at
--   • public.events_mirror (Phase 24): user_id, distinct_id, created_at
-- Rename documented in 51-01-SUMMARY.md §Deviations (Rule 3 — preflight fix).
--
-- SECURITY DEFINER is required because the helper crosses RLS boundaries
-- (consumer audience reads events_mirror which is admin-only). Stable since
-- output is deterministic given input + a snapshot of these tables. The
-- function is used in matview SELECTs at refresh time only (per RESEARCH
-- Pitfall 2; never in a partial-index expression — IMMUTABLE constraint per
-- reference_supabase_migration_gotchas does NOT apply).
--
-- Migration timestamp note: renamed from 20270712000004 to 20271102000004
-- per 51-01 execute-time preflight (reference_supabase_back_dated_migration_blocks_push).

create or replace function public.is_retained(
  p_user_id     uuid,
  p_audience    text,
  p_window_days int
) returns boolean
  language plpgsql
  security definer
  stable
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_threshold timestamptz := now() - make_interval(days => p_window_days);
begin
  if p_user_id is null or p_window_days is null or p_window_days <= 0 then
    return false;
  end if;

  if p_audience = 'consumer' then
    -- Any tracked activity event within the window. We match on either
    -- user_id (post-stitch) or distinct_id (pre-stitch) since events_mirror
    -- carries both.
    return exists (
      select 1
      from public.events_mirror em
      where em.created_at >= v_threshold
        and (em.user_id = p_user_id or em.distinct_id = p_user_id::text)
    );

  elsif p_audience = 'clinic-org' then
    -- Org has at least one active paid subscription whose period has not
    -- yet expired beyond the retention window. Active org membership is
    -- the user-side condition; the org_members → subscriptions JOIN routes
    -- through clinic_id (org subscriptions key on clinic_id; consumer
    -- subscriptions key on user_id).
    return exists (
      select 1
      from public.org_members om
      join public.subscriptions s on s.clinic_id = om.org_id
      where om.user_id = p_user_id
        and s.status = 'active'
        and s.current_period_end >= v_threshold
    );

  elsif p_audience = 'affiliate' then
    -- The user owns an affiliates row and at least one of their
    -- conversions has been paid/confirmed within the window.
    return exists (
      select 1
      from public.affiliates a
      join public.affiliate_conversions ac on ac.affiliate_id = a.id
      where a.user_id = p_user_id
        and ac.status in ('confirmed', 'paid')
        and ac.invoice_paid_at is not null
        and ac.invoice_paid_at >= v_threshold
    );

  else
    return false;
  end if;
end;
$$;

-- Service-role only. Matview refresh path runs as service-role; user JWT
-- paths must NOT call this directly (they read the materialized columns).
revoke execute on function public.is_retained(uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.is_retained(uuid, text, int)
  to service_role;

comment on function public.is_retained(uuid, text, int) is
  'Phase 51 / D-16 — Per-audience retention probe. consumer: events_mirror activity within window. clinic-org: any active org subscription whose period_end >= threshold. affiliate: paid/confirmed affiliate_conversions within window. Used by matview refresh only (SECDEF; service-role only).';
