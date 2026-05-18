-- Phase 33 Plan 01 — Migration 09
-- etl_cursors table + meta_capi_relay cursor row.
-- Used by meta-capi-relay Edge Function to track last-processed events_mirror row.
-- ON CONFLICT DO NOTHING guards against re-runs if table was created by another phase.
--
-- SECURITY NOTE: This table is admin-only. RLS applied in Migration 10.

begin;

-- Create etl_cursors table if not exists (may have been created by another phase)
create table if not exists public.etl_cursors (
  name        text        primary key,
  value       text        not null default '0',
  updated_at  timestamptz not null default now()
);

-- Insert meta_capi_relay cursor row; idempotent via ON CONFLICT DO NOTHING
insert into public.etl_cursors (name, value, updated_at)
values ('meta_capi_relay', '0', now())
on conflict (name) do nothing;

commit;
