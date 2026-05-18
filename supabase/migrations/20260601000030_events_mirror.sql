-- Phase 27 plan 27-04 — RESEARCH question #5 resolution.
--
-- Closes RESEARCH question #5: Phase 24 ships _shared/posthog-server.ts that
-- captures events server-side to PostHog (TAXO-02), but does NOT ship a local
-- mirror table. The Phase 27 funnel-anomaly-cron tick at */5 must compute a
-- baseline (24h count + 7d HOD stats + 4w DOW stats) every 5 minutes. PostHog
-- REST has rate-limit + lag risk at that cadence — see
-- [[reference_vendor_gated_send_health_check]] / decision to dual-write.
--
-- This migration ships a local events_mirror table; the captureServer() helper
-- in _shared/posthog-server.ts is extended (Task 3) to dual-write here
-- best-effort (fire-and-forget; never blocks the PostHog send).
--
-- Schema mirrors PostHog distinct_id + event + properties shape so the
-- baseline_compute SECDEF function (Task 2) can SUM/COUNT against it directly.
--
-- TAMPERING MITIGATION (Pattern S2 — append-only RLS):
--   RLS is ENABLED with ZERO policies. The only write path is the
--   service_role admin client invoked from posthog-server.ts (bypasses RLS by
--   Supabase convention). The only read path is the SECURITY DEFINER
--   funnel_anomaly_baseline_compute() function (table-owner bypass).
--   Authenticated and anon roles have NO access — the absence of policies IS
--   the enforcement.
--
-- INFORMATION DISCLOSURE MITIGATION (T-27-04-02):
--   No SELECT policy → no JWT-scoped client can read user behavior data.
--   Anomaly cron operates inside service_role context only.
--
-- RETENTION: deferred to v1.4 (no retention cron in this migration).
-- The baseline_compute function naturally bounds reads via WHERE clauses
-- (last 24h / last 7d / last 4w windows), so storage growth without
-- retention only affects disk usage, not query latency.

create table public.events_mirror (
  id bigserial primary key,
  event_name text not null,
  -- user_id is nullable because some PostHog captures use distinct_id without
  -- an authenticated Supabase user (e.g., pre-signup landing-page events).
  user_id uuid,
  properties jsonb default '{}'::jsonb,
  distinct_id text,
  created_at timestamptz not null default now()
);

-- Hot path for funnel_anomaly_baseline_compute(): every baseline query
-- filters by event_name AND windows on created_at DESC. Composite index in
-- this column order matches the access pattern.
create index idx_events_mirror_event_name_created
  on public.events_mirror (event_name, created_at desc);

-- TAMPERING / DISCLOSURE MITIGATION — Pattern S2 (Phase 24 D-17 + 27-PATTERNS):
--   ENABLE RLS but DEFINE NO POLICIES.
--   service_role + SECDEF table-owner are the only access paths.
alter table public.events_mirror enable row level security;

-- NO policies defined intentionally. The absence is the enforcement.
-- Direct authenticated reads/writes return 42501.

comment on table public.events_mirror is
  'Phase 27 plan 27-04: local mirror of PostHog captureServer() events for funnel-anomaly cron. Service_role write + SECDEF read only. RESEARCH q#5 resolution.';
