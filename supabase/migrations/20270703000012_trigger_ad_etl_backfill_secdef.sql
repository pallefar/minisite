-- Phase 33 Plan 01 — Migration 12
-- trigger_ad_etl_backfill(p_network text, p_date date) SECURITY DEFINER RPC.
--
-- plan-checker BLOCKER 2 fix: Admin "Backfill" button in Plan 33-05 cannot directly invoke
-- a service-role-gated Edge Function from the browser anon client. This SECDEF bridges
-- the gap — authenticated admin browser → supabase.rpc('trigger_ad_etl_backfill') →
-- SECDEF checks is_admin() → invokes Edge Fn with service-role Bearer via vault secret.
--
-- Authorization: is_admin(auth.uid()) — non-admins get errcode 42501 (forbidden).
-- Audit: writes to admin_notifications for audit trail.
-- Vault pattern: service_role_key from vault.decrypted_secrets (no GUC — plan-checker BLOCKER fix).
-- URL pattern: hardcoded project URL (stable across environments per memory ref).
--
-- GRANT EXECUTE to authenticated so browser client can call it; is_admin() inside blocks non-admins.

begin;

create or replace function public.trigger_ad_etl_backfill(p_network text, p_date date)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_fn_name text;
begin
  -- Authorization: only admins may trigger backfills.
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Validate network parameter.
  if p_network not in ('meta', 'google', 'tiktok') then
    raise exception 'invalid network: %', p_network using errcode = '22023';
  end if;

  v_fn_name := 'ad-spend-cron-' || p_network;

  -- Invoke ETL Edge Function with backfill payload via service-role Bearer.
  -- Vault pattern: service_role_key from vault.decrypted_secrets (per 20270101000014_service_role_key_vault_load.sql).
  perform net.http_post(
    url     := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/' || v_fn_name,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'service_role_key'
        limit 1
      )
    ),
    body    := jsonb_build_object(
      'backfill_date',   p_date::text,
      'backfill_window', '24h'
    )
  );

  -- Audit trail: write to admin_notifications so admins can see who triggered what.
  insert into public.admin_notifications (title, body, type)
  values (
    'Backfill triggered',
    format('Network %s, date %s, by admin %s', p_network, p_date, auth.uid()),
    'ad_etl_backfill'
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.trigger_ad_etl_backfill(text, date) from public;
grant execute on function public.trigger_ad_etl_backfill(text, date) to authenticated;

commit;
