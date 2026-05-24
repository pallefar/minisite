-- Phase 48 Plan 03 Task 2: apply_user_moderation SECDEF RPC
-- Single write-path for user_moderation_state (Task 1).
-- - is_staff() gate at entry (T-48-06 mitigation)
-- - Validates p_status enum + expires_at iff temp_suspended
-- - UPSERTs row + records before/after via log_moderation_action (Plan 48-04)
-- - On status='banned' fires pg_net to ban-enforcement Edge Fn (Plan 48-09)
--   using vault-stored service_role_key + hardcoded Fn URL (T-48-13 mitigation)

begin;

create extension if not exists pg_net;

create or replace function public.apply_user_moderation(
  p_user_id     uuid,
  p_status      text,
  p_reason      text,
  p_expires_at  timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_actor       uuid := auth.uid();
  v_before      jsonb;
  v_after       jsonb;
  v_service_key text;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_status not in ('active','muted','banned','temp_suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if p_status = 'temp_suspended' and p_expires_at is null then
    raise exception 'temp_suspended_requires_expires_at' using errcode = '22023';
  end if;

  if p_status <> 'temp_suspended' and p_expires_at is not null then
    raise exception 'expires_at_only_for_temp_suspended' using errcode = '22023';
  end if;

  select to_jsonb(ums.*) into v_before
    from public.user_moderation_state ums
    where ums.user_id = p_user_id;

  insert into public.user_moderation_state (user_id, status, applied_by, reason, expires_at, updated_at)
  values (p_user_id, p_status, v_actor, p_reason, p_expires_at, now())
  on conflict (user_id) do update
    set status     = excluded.status,
        applied_by = excluded.applied_by,
        reason     = excluded.reason,
        expires_at = excluded.expires_at,
        updated_at = now();

  select to_jsonb(ums.*) into v_after
    from public.user_moderation_state ums
    where ums.user_id = p_user_id;

  perform public.log_moderation_action(
    p_action_type => case p_status
                      when 'muted'          then 'mute_applied'
                      when 'banned'         then 'ban_applied'
                      when 'temp_suspended' then 'temp_suspend_applied'
                      else                       'moderation_cleared'
                    end,
    p_target_type => 'user',
    p_target_id   => p_user_id,
    p_before      => v_before,
    p_after       => v_after,
    p_reason      => p_reason
  );

  -- On ban: notify ban-enforcement Edge Fn (Plan 48-09) which performs
  -- direct service-role DELETE on auth.sessions / auth.refresh_tokens.
  -- URL is LITERAL (not row-derived) per T-48-13 STRIDE mitigation.
  if p_status = 'banned' then
    select decrypted_secret into v_service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;

    perform net.http_post(
      url     := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ban-enforcement',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object('user_id', p_user_id)
    );
  end if;
end;
$fn$;

revoke all on function public.apply_user_moderation(uuid, text, text, timestamptz) from public;
grant execute on function public.apply_user_moderation(uuid, text, text, timestamptz) to authenticated;

commit;
