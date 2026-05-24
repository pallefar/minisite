-- Phase 51 Plan 51-04 — compute_channel_stage_rate SECDEF RPC + admin_notifications widening.
-- Decision refs: D-06 / D-08 (per-channel × audience × stage anomaly alerting).
-- Requirements: TRAFFIC-11.
-- Threat refs: T-51-21..24.
--
-- ORCHESTRATOR PREFLIGHT (worktree-mode, db push deferred to Plan 51-10):
--   Live `supabase db query --linked` not executed in this worktree dispatch
--   (push gate owned by 51-10). admin_notifications schema is inferred from
--   committed code references:
--     • supabase/functions/_shared/ad-etl-utils.ts:206 — uses columns
--       (title, body, type) on .insert(); no `kind` / `dedup_key` / `payload`.
--     • supabase/migrations/20270703000012_trigger_ad_etl_backfill_secdef.sql:59
--     • supabase/migrations/20270703000013_fix_trigger_ad_etl_backfill_is_admin.sql:43
--   No `create table public.admin_notifications` is tracked in this repo — the
--   table predates the tracked migration window (Phase 27 created it via path
--   not present on `main`). The plan-level pre-write requires `kind`,
--   `dedup_key`, `payload` columns. We treat this as preflight outcome #2 +
--   structural-widening:
--     • Add `kind text` (nullable; new alerts populate, legacy rows null).
--     • Add `dedup_key text` (nullable; UNIQUE so upsert(onConflict:'dedup_key')
--       works for the new traffic_funnel_drop kind).
--     • Add `payload jsonb` (nullable; structured anomaly metric envelope).
--   No CHECK constraint on `kind` is declared (open text); if the live db
--   already has one, Plan 51-10's push step will surface the conflict before
--   deploy and the operator widens inline. This is the "no new table" path
--   per plan must_haves.
--
-- RPC contract (matches Plan 51-04 must_haves):
--   compute_channel_stage_rate(
--     p_channel_group text,
--     p_audience      text,
--     p_stage_in      text,
--     p_stage_out     text,
--     p_window_days   int default 7
--   ) returns table (
--     observed_rate   numeric,
--     expected_rate   numeric,
--     expected_stddev numeric
--   )
--
-- Read path: public.traffic_funnel_rollup (matview revoked from public/anon/
-- authenticated in 20271102000012; SECURITY DEFINER bypasses on owner-grant).
--
-- Caller: funnel-anomaly-cron Edge Fn under SUPABASE_SERVICE_ROLE_KEY. The
-- function body has NO logged-in-user lookup — per memory
-- `feedback_rpc_auth_uid_vs_service_role_mismatch`, SECDEF RPCs reachable from
-- cron service-role context must not gate on the per-session user identifier.
--
-- Migration timestamp: 20271102000014 (orchestrator preflight: 20271102000013
-- already taken by `20271102000013_traffic_matview_refresh_cron.sql`).

-- ---------------------------------------------------------------------------
-- 1. Widen admin_notifications with kind / dedup_key / payload columns.
-- ---------------------------------------------------------------------------
alter table public.admin_notifications
  add column if not exists kind        text,
  add column if not exists dedup_key   text,
  add column if not exists payload     jsonb;

-- UNIQUE on dedup_key (nullable column, partial index so legacy rows with
-- NULL dedup_key are NOT constrained). Required for the
-- onConflict:'dedup_key' upsert path used by the cron extension.
create unique index if not exists admin_notifications_dedup_key_uq
  on public.admin_notifications (dedup_key)
  where dedup_key is not null;

comment on column public.admin_notifications.kind is
  'Phase 51 / Plan 51-04 — Structured alert kind (e.g. ''traffic_funnel_drop''). Legacy rows pre-Phase 51 may have NULL kind; downstream consumers must tolerate.';
comment on column public.admin_notifications.dedup_key is
  'Phase 51 / Plan 51-04 — Multi-dimensional dedup key for onConflict upsert (e.g. ''traffic_funnel_drop:Paid Search:consumer:signup_activation:2027-11-02''). UNIQUE when not null.';
comment on column public.admin_notifications.payload is
  'Phase 51 / Plan 51-04 — Structured JSON metric envelope (channel_group, audience, stage_in, stage_out, observed_rate, expected_rate, expected_stddev, sigmas, date).';

-- ---------------------------------------------------------------------------
-- 2. compute_channel_stage_rate(text, text, text, text, int) SECDEF.
-- ---------------------------------------------------------------------------
create or replace function public.compute_channel_stage_rate(
  p_channel_group text,
  p_audience      text,
  p_stage_in      text,
  p_stage_out     text,
  p_window_days   int default 7
)
returns table (
  observed_rate   numeric,
  expected_rate   numeric,
  expected_stddev numeric
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, extensions
as $$
begin
  -- Service-role-only RPC; the cron caller's session has no logged-in user.
  -- DO NOT introduce a session-user lookup in this body
  -- (memory: feedback_rpc_auth_uid_vs_service_role_mismatch).

  return query
  with windowed as (
    select tfr.day, tfr.rate
    from public.traffic_funnel_rollup tfr
    where tfr.channel_group = p_channel_group
      and tfr.audience      = p_audience
      and tfr.stage_in      = p_stage_in
      and tfr.stage_out     = p_stage_out
      and tfr.day          >= (current_date - make_interval(days => p_window_days))
      and tfr.day          <  current_date
      and tfr.rate is not null
  ),
  today as (
    select tfr.rate as today_rate
    from public.traffic_funnel_rollup tfr
    where tfr.channel_group = p_channel_group
      and tfr.audience      = p_audience
      and tfr.stage_in      = p_stage_in
      and tfr.stage_out     = p_stage_out
      and tfr.day           = current_date
    limit 1
  )
  select
    coalesce((select today_rate from today), 0)::numeric         as observed_rate,
    coalesce(avg(w.rate), 0)::numeric                            as expected_rate,
    coalesce(stddev_samp(w.rate), 0)::numeric                    as expected_stddev
  from windowed w;
end;
$$;

revoke execute on function public.compute_channel_stage_rate(text, text, text, text, int)
  from public, anon, authenticated;
grant  execute on function public.compute_channel_stage_rate(text, text, text, text, int)
  to service_role;

comment on function public.compute_channel_stage_rate(text, text, text, text, int) is
  'Phase 51 / D-06 / D-08 — Per (channel_group × audience × stage_pair) anomaly RPC. Reads traffic_funnel_rollup over rolling p_window_days baseline (default 7) excluding today; returns observed_rate (today) + expected_rate (avg over baseline) + expected_stddev (sample stddev). Caller: funnel-anomaly-cron Edge Fn under service_role; no session-user lookup.';
