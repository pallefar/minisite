-- Phase 25 Plan 02 — log_phi_access() SECURITY DEFINER write path for PHI access audit.
--
-- Decision refs: D-07 (explicit RPC per sensitive UI surface), Pattern S1 (dual-layer
--   security), Pattern S7 (search_path hardening), RESEARCH Pitfall 5 (search_path
--   injection without set search_path = public, extensions, pg_catalog).
--
-- Security guarantees:
--   - Caller MUST be authenticated (auth.uid() NOT NULL; raises 28000 otherwise).
--   - actor_user_id is ALWAYS sourced from auth.uid() — NEVER from a caller argument.
--     This is the T-25-02-03/T-25-02-04 mitigation; parallel to ai-chat T-04-04.
--   - Pattern S7: set search_path = public, extensions, pg_catalog prevents an attacker
--     who issued SET search_path from shadowing public.phi_access_log with a malicious
--     table (RESEARCH Pitfall 5).
--   - DO NOT pre-validate accessed_fields length in plpgsql — the DDL check on
--     phi_access_log enforces array_length >= 1 (single source of truth; avoids
--     "defensive jsonb contracts" anti-pattern per feedback_planner_iter1_anti_patterns).
--   - revoke all from public; grant execute to authenticated.

create or replace function public.log_phi_access(
  p_accessed_user_id uuid,
  p_accessed_fields  text[],
  p_reason           text,
  p_accessed_org_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- T-25-02-04: unauthenticated caller must be rejected before any DML.
  if v_actor is null then
    raise exception 'not_authenticated'
      using errcode = '28000';
  end if;

  -- Guard: accessed_user_id must be provided.
  if p_accessed_user_id is null then
    raise exception 'invalid_arguments: p_accessed_user_id required'
      using errcode = '22023';
  end if;

  -- T-25-02-03: actor_user_id = auth.uid() (v_actor) — never from caller arg.
  insert into public.phi_access_log
    (actor_user_id, accessed_user_id, accessed_org_id, accessed_fields, reason)
  values
    (v_actor, p_accessed_user_id, p_accessed_org_id, p_accessed_fields, p_reason);
end;
$$;

-- Revoke from public first (safe: function may not yet exist in public, no-op if so).
revoke all on function public.log_phi_access(uuid, text[], text, uuid) from public;

-- Grant execute to authenticated only. The SECURITY DEFINER body enforces the auth
-- check — the grant alone is not sufficient (auth.uid() null ⟹ raise 28000).
grant execute on function public.log_phi_access(uuid, text[], text, uuid) to authenticated;
