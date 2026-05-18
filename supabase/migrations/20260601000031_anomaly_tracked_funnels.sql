-- Phase 27 plan 27-04 — TAXO-05 config table for funnel-anomaly cron.
--
-- Decision refs: CONTEXT D-14 (tracked funnels admin-configurable);
-- D-19 (5-funnel v1 seed list).
--
-- This table is the single source of truth for which event names the
-- funnel-anomaly cron polls every 5 minutes. Superadmin manages the rows via
-- /admin/anomaly settings (UI shipped in Plan 27-05). The 5-row seed below
-- bootstraps v1 — operators can add/remove/disable rows post-ship without
-- redeploy.
--
-- AUTHZ:
--   SELECT — is_admin_at_least('admin') (anomaly config visible to admin+).
--   INSERT / UPDATE / DELETE — is_admin_at_least('superadmin') (D-14 narrows
--   mutation rights to superadmin; staff/admin read-only).
--
-- Analog seed pattern: supabase/migrations/20270101000010_affiliate_landing_template_seeds.sql.

create table public.anomaly_tracked_funnels (
  funnel_id uuid primary key default gen_random_uuid(),
  event_name text not null unique,
  is_enabled boolean not null default true,
  baseline_lookback_days int not null default 7,
  sigma_threshold numeric not null default 2.0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_anomaly_tracked_funnels_enabled
  on public.anomaly_tracked_funnels (is_enabled)
  where is_enabled = true;

alter table public.anomaly_tracked_funnels enable row level security;

-- SELECT: admin+ (Pattern S1 — UX layer reads the list for the /admin/anomaly
-- settings page; server-side enforcement on mutations below).
create policy "anomaly_tracked_funnels_select_admin"
  on public.anomaly_tracked_funnels
  for select
  using (public.is_admin_at_least('admin'::public.admin_role));

-- INSERT / UPDATE / DELETE: superadmin only (D-14).
create policy "anomaly_tracked_funnels_insert_superadmin"
  on public.anomaly_tracked_funnels
  for insert
  with check (public.is_admin_at_least('superadmin'::public.admin_role));

create policy "anomaly_tracked_funnels_update_superadmin"
  on public.anomaly_tracked_funnels
  for update
  using (public.is_admin_at_least('superadmin'::public.admin_role))
  with check (public.is_admin_at_least('superadmin'::public.admin_role));

create policy "anomaly_tracked_funnels_delete_superadmin"
  on public.anomaly_tracked_funnels
  for delete
  using (public.is_admin_at_least('superadmin'::public.admin_role));

-- v1 seed: 5 funnels per CONTEXT D-19. Idempotent — re-running the migration
-- on a populated table is a no-op.
insert into public.anomaly_tracked_funnels (event_name, is_enabled, baseline_lookback_days, sigma_threshold)
values
  ('signup_completed',          true, 7, 2.0),
  ('activation_event',          true, 7, 2.0),
  ('payment_succeeded',         true, 7, 2.0),
  ('lifetime_grant',            true, 7, 2.0),
  ('helpdesk_ticket_resolved',  true, 7, 2.0)
on conflict (event_name) do nothing;

comment on table public.anomaly_tracked_funnels is
  'Phase 27 plan 27-04 (D-14): admin-configurable list of event names the funnel-anomaly */5 cron polls. 5 v1 seeds.';
