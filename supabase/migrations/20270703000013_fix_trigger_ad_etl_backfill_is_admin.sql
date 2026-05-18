-- Phase 33 — corrective migration.
--
-- 20270703000012_trigger_ad_etl_backfill_secdef.sql shipped with `public.is_admin(auth.uid())`
-- which does NOT exist in this project. The established admin-check helper is
-- `public.is_admin_at_least('admin'::public.admin_role)` (see anomaly_tracked_funnels.sql
-- + admin_palette_recent_rpc.sql for the canonical pattern). This migration replaces the
-- trigger function with the correct admin gate. Surfaced when migration 10 RLS push
-- failed with the same is_admin(uuid) missing — fixed in 10 via in-place edit before
-- push; migration 12 had already applied, so requires this CREATE OR REPLACE corrective.
--
-- Risk: low. The function body is otherwise identical. The audit insert preserves
-- the original `auth.uid()` for traceability.

begin;

create or replace function public.trigger_ad_etl_backfill(p_network text, p_date date)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $fn$
declare
  v_fn_name text;
begin
  -- Authorization: only admins may trigger backfills.
  -- Fixed: was public.is_admin(auth.uid()) which doesn't exist.
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_network not in ('meta','google','tiktok') then
    raise exception 'invalid network: %', p_network using errcode = '22023';
  end if;
  v_fn_name := 'ad-spend-cron-' || p_network;
  perform net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/' || v_fn_name,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := jsonb_build_object('backfill_date', p_date::text, 'backfill_window', '24h')
  );
  -- Audit trail
  insert into public.admin_notifications (title, body, type)
  values (
    'Backfill triggered',
    format('Network %s, date %s, by admin %s', p_network, p_date, auth.uid()),
    'ad_etl_backfill'
  )
  on conflict do nothing;
end;
$fn$;

revoke execute on function public.trigger_ad_etl_backfill(text, date) from public;
grant execute on function public.trigger_ad_etl_backfill(text, date) to authenticated;

commit;
