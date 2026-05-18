-- Phase 25 Plan 25-04 — log_baa_guard_refusal RPC (HIPAA-04 SC #1 audit writer).
--
-- Wraps Phase 24 `public.audit_logs` insert for ai-chat BAA guard refusals.
-- Phase 24 revoked INSERT on audit_logs from service_role + authenticated;
-- only SECURITY DEFINER functions and triggers may write. This RPC is the
-- write seam for ai-chat refusal events (refusals come from any caller — the
-- log captures WHO TRIED to call a non-BAA model, regardless of role).
--
-- audit_logs columns used (Phase 24 additions in migration 20270601000028):
--   actor_user_id  uuid — the user whose JWT triggered the ai-chat call
--   target_user_id uuid — same as actor (refusal is self-affecting)
--   action_name    text — 'anthropic_baa_guard_refused'
--   table_name     text — 'ai_chat_refusals' (logical source, not a real table)
--   after_data     jsonb — p_payload (reason, modelId, orgId)
--   source         text — 'rpc' (satisfies check (source in ('rpc','trigger')))
--
-- STRIDE: T-25-04-R1 mitigation — refusal events are never silently dropped.

create or replace function public.log_baa_guard_refusal(
  p_user_id uuid,
  p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  insert into public.audit_logs (
    actor_user_id, target_user_id, action_name,
    table_name, after_data, source
  )
  values (
    p_user_id, p_user_id, 'anthropic_baa_guard_refused',
    'ai_chat_refusals', p_payload, 'rpc'
  );
end;
$$;

revoke all on function public.log_baa_guard_refusal(uuid, jsonb) from public;
grant execute on function public.log_baa_guard_refusal(uuid, jsonb) to anon, authenticated, service_role;
