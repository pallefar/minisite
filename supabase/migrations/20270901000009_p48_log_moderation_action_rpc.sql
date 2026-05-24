-- Phase 48 Plan 48-04 — log_moderation_action() SECURITY DEFINER append-only RPC.
--
-- Decision refs: D-16 (mirrors Phase 25 log_phi_access shape), Pattern S1
--   (dual-layer security), Pattern S7 (search_path hardening).
-- Memory refs: feedback_rpc_auth_uid_vs_service_role_mismatch (RPC accepts
--   actor_id=NULL for system callers — claude-moderation Fn via service-role,
--   banned_words_match trigger fired by service-role bypass, temp_suspended
--   cron). action_type disambiguates system vs admin actions.
--   reference_supabase_migration_gotchas (SECDEF needs explicit search_path
--   including extensions to prevent search_path injection).
--
-- Security guarantees:
--   - actor_id is ALWAYS sourced from auth.uid() INSIDE the function body —
--     NEVER from a caller argument. This is the T-48-16 mitigation; parallel
--     to log_phi_access T-25-02-03. Caller-spoofed actor_id is impossible
--     because the RPC signature does not accept actor_id.
--   - set search_path = public, extensions prevents search_path injection
--     attacks (shadowing public.moderation_audit_log with a malicious table).
--   - revoke all from public; grant execute to authenticated AND service_role
--     (the ONLY SECDEF RPC in Phase 48 granted to service_role — required for
--     Edge Fn cron callers that have no user JWT).
--
-- Differs from log_phi_access:
--   - NO null-actor raise guard. v_actor may be null for legitimate system
--     callers; action_type disambiguates ('temp_restore', 'auto_flag',
--     'banned_word_match' indicate system origin).
--   - GRANT EXECUTE includes service_role (log_phi_access is authenticated-only).
--   - No DDL pre-validation on args; target_type CHECK is enforced at table
--     level (single source of truth; avoids defensive-jsonb-contract anti-pattern).

create or replace function public.log_moderation_action(
  p_action_type  text,
  p_target_type  text,
  p_target_id    uuid,
  p_before       jsonb default null,
  p_after        jsonb default null,
  p_reason       text  default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_actor uuid := auth.uid();
begin
  -- v_actor may be null for system-callers (claude-moderation Fn via service-role,
  -- banned_words_match trigger fired by service-role bypass, temp_suspended_restore
  -- cron). action_type disambiguates ('temp_restore', 'auto_flag',
  -- 'banned_word_match' = system origin).
  --
  -- T-48-16: actor_id sourced from auth.uid() (v_actor), never from caller arg.
  insert into public.moderation_audit_log
    (actor_id, action_type, target_type, target_id, before_state, after_state, reason)
  values
    (v_actor, p_action_type, p_target_type, p_target_id, p_before, p_after, p_reason);
end;
$fn$;

-- Revoke from public first (safe: function may not yet exist in public, no-op if so).
revoke all on function public.log_moderation_action(text, text, uuid, jsonb, jsonb, text) from public;

-- Grant EXECUTE to BOTH authenticated AND service_role. Service-role callers
-- (Edge Fns invoked by cron / fire-and-forget background tasks) need it; this
-- is the only Phase 48 SECDEF RPC granted to service_role.
grant execute on function public.log_moderation_action(text, text, uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.log_moderation_action(text, text, uuid, jsonb, jsonb, text) to service_role;
