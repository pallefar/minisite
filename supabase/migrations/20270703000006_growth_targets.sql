-- Phase 33 Plan 01 — Migration 06
-- growth_targets table: admin-tunable CAC alert thresholds (D-13/ADETL-07).
-- cac-alert-cron reads this table to evaluate 7d-rolling CAC vs threshold.
--
-- PLACEHOLDER VALUE NOTICE:
-- target_ltv_usd=200.00 is a PLACEHOLDER. Flagged for user confirmation in
-- plan-checker iter-1 before phase ships. Edit this row via admin CAC dashboard
-- "Alerts" settings panel after phase deploys — no code deploy required.
--
-- Formula: alert fires when 7d CAC > target_ltv_usd × cac_multiplier (default 0.5)
-- i.e. when spend per acquired user > 50% of estimated LTV.
--
-- SECURITY NOTE: This table is admin-only. RLS applied in Migration 10.

begin;

create table if not exists public.growth_targets (
  id                  uuid          not null default gen_random_uuid() primary key,
  source              text          not null,   -- network name or 'all'
  target_ltv_usd      numeric(10,2) not null,
  cac_multiplier      numeric(6,4)  not null default 0.5,
  enabled             boolean       not null default true,
  updated_at          timestamptz   not null default now(),
  updated_by_admin_id uuid          references auth.users(id)
);

-- Placeholder row per D-13 — target_ltv_usd=200 needs user confirmation before phase ships.
insert into public.growth_targets (source, target_ltv_usd, cac_multiplier, enabled)
values ('all', 200.00, 0.5, true)
on conflict do nothing;

commit;
