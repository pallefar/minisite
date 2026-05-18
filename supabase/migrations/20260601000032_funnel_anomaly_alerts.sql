-- Phase 27 plan 27-04 — TAXO-05 alert log table.
--
-- Decision refs: CONTEXT D-17 (in-app banner + email routing); D-18 (4h
-- suppression); D-19 (alert row schema); D-23 (append-only RLS posture).
--
-- One row per fired anomaly. Append-only — only the funnel-anomaly cron
-- (service_role) and the funnel_anomaly_acknowledge SECDEF RPC write here.
-- The acknowledge RPC ONLY updates resolution_status / acknowledged_by /
-- acknowledged_at — no other column is mutable post-insert.
--
-- REALTIME — Broadcast channel (NOT postgres_changes):
--   This table is INTENTIONALLY NOT added to the supabase_realtime publication.
--   The cron Edge Function explicitly calls
--     supabase.channel('funnel_anomaly_alerts').send({type:'broadcast', ...})
--   on successful insert, which:
--     (a) avoids the ALTER PUBLICATION dance
--     (b) bypasses postgres_changes' replication-slot latency (~1-3s)
--     (c) gives the cron full control of the payload shape (matches client
--         expectations exactly without depending on row diffs)
--     (d) keeps the broadcast non-PHI by design — no user_id is in the
--         broadcast payload (T-27-04-03 mitigation)
--   Per 27-PATTERNS A5 alternative + CONTEXT D-17.
--
-- IDEMPOTENCY — UNIQUE(funnel_id, tick_bucket) per Pattern S9:
--   tick_bucket is date_trunc('minute', fired_at)::text — a per-minute
--   bucket key. If the cron re-fires within the same minute (network retry,
--   cron jitter), the .upsert({onConflict:..., ignoreDuplicates:true}) call
--   silently drops the duplicate. Outer 4h suppression (D-18) is the
--   intent-level gate; this UNIQUE is the inner safety net.
--
-- AUTHZ:
--   SELECT — is_admin_at_least('admin') (admin+ sees the queue).
--   INSERT / UPDATE / DELETE — NO POLICIES. Pattern S2 (negative-space
--   tampering mitigation per Phase 24 D-17 carry). Service_role cron writes;
--   SECDEF acknowledge RPC writes. Direct authenticated writes return 42501.

create table public.funnel_anomaly_alerts (
  id uuid primary key default gen_random_uuid(),
  funnel_id uuid not null references public.anomaly_tracked_funnels(funnel_id) on delete cascade,
  fired_at timestamptz not null default now(),
  -- date_trunc('minute', fired_at)::text — per Pattern S9 idempotency.
  tick_bucket text not null,
  observed_count int not null,
  expected_mean numeric not null,
  expected_stddev numeric not null,
  z_score numeric not null,
  resolution_status text not null
    check (resolution_status in ('firing','resolved','acknowledged'))
    default 'firing',
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,

  -- Cron idempotency: re-fire within the same minute is a no-op via
  -- .upsert({onConflict:'funnel_id,tick_bucket', ignoreDuplicates:true}).
  unique (funnel_id, tick_bucket)
);

-- Acknowledge queue hot path: filter by resolution_status='firing', newest first.
create index idx_funnel_anomaly_alerts_status_fired
  on public.funnel_anomaly_alerts (resolution_status, fired_at desc);

-- 4h suppression hot path: last fired_at per funnel.
create index idx_funnel_anomaly_alerts_funnel_fired
  on public.funnel_anomaly_alerts (funnel_id, fired_at desc);

alter table public.funnel_anomaly_alerts enable row level security;

-- SELECT: admin+ (queue + history visible to all admin roles).
create policy "funnel_anomaly_alerts_select_admin"
  on public.funnel_anomaly_alerts
  for select
  using (public.is_admin_at_least('admin'::public.admin_role));

-- TAMPERING MITIGATION (Pattern S2 — Phase 24 D-17 carry, T-27-04-04):
--   NO INSERT/UPDATE/DELETE policies. The SECURITY DEFINER
--   funnel_anomaly_acknowledge RPC and the service_role cron are the only
--   write paths. Direct authenticated mutations return 42501.

comment on table public.funnel_anomaly_alerts is
  'Phase 27 plan 27-04 (D-17/D-18/D-19): append-only alert log; cron writes firing, acknowledge RPC writes acknowledged. Realtime via BROADCAST not postgres_changes.';
