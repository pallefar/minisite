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

  -- REVIEW WR-08 defense-in-depth: the EXECUTE grant is already revoked from
  -- public/anon/authenticated (see end of file), so user JWTs cannot reach
  -- here directly today. This check guards the future case where a
  -- migration accidentally grants matview SELECT directly to authenticated
  -- (which would expose this helper as a user-existence enumeration oracle).
  -- Service-role runs (matview refresh, cron) and admin-role JWTs (manual
  -- diagnostics) are allowed; everything else returns false.
  if current_setting('role', true) is distinct from 'service_role'
     and not coalesce(public.is_admin_at_least('admin'::public.admin_role), false) then
    return false;
  end if;

  if p_audience = 'consumer' then
    -- REVIEW WR-02: enumerate the user's COMPLETE anon_id set via
    -- user_traffic_attribution so pre-stitch events captured under a
    -- different anon_id (multi-device returning user, new incognito visit,
    -- etc.) still count as activity. The previous `em.distinct_id =
    -- p_user_id::text` branch only matched post-stitch events; a user who
    -- installed on D0, signed in on D5, then re-engaged from a phone with
    -- a new anon_id on D7 was incorrectly reported as not D7-retained.
    --
    -- The join is bound to user_traffic_attribution.user_id = p_user_id
    -- (preserves WR-01 invariant — never cross-user aggregation), and the
    -- IN-list also covers the original two branches as a fallback so
    -- pre-recorder backfill events (which may have no utat row) still
    -- match by their post-stitch user_id.
    return exists (
      select 1
      from public.events_mirror em
      where em.created_at >= v_threshold
        and (
          em.user_id = p_user_id
          or em.distinct_id = p_user_id::text
          or em.distinct_id in (
            select utat.anon_id
            from public.user_traffic_attribution utat
            where utat.user_id = p_user_id
          )
        )
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
  'Phase 51 / D-16 — Per-audience retention probe. consumer: events_mirror activity within window. clinic-org: any active org subscription whose period_end >= threshold. affiliate: paid/confirmed affiliate_conversions within window. Used by matview refresh only (SECDEF; service-role only).

DESIGN — INDIRECT CROSS-RLS READ (REVIEW WR-01):
This helper crosses RLS boundaries on purpose: it reads events_mirror
(admin-only) and subscriptions (org-scoped) and surfaces a single boolean
into the matview. Each branch is keyed on the user_id passed in, so the
returned value is a function of THAT user only — never aggregated across
orgs. A future contributor MUST preserve this invariant:
  - consumer: predicate ties to em.user_id = p_user_id (or distinct_id::text)
  - clinic-org: org_members join binds to om.user_id = p_user_id; the
    subscriptions join keys on om.org_id, so only the caller user''s orgs
    are considered.
  - affiliate: affiliates.user_id = p_user_id binds the conversions JOIN.
Adding a SELECT that does NOT bind every joined table to p_user_id would
turn this helper into a cross-org data-leak channel via matview reads.
Test coverage lives in 51-10 RLS-traffic-attribution fixture.';
