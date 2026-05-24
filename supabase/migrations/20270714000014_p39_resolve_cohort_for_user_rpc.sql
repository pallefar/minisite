-- Phase 39 Plan 39-01 — resolve_cohort_for_user(uid) SECDEF RPC.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-07 (per-cohort variant routing reads cohort_id at assignment time),
--   D-08 (5 default cohorts seeded in 20270714000008),
--   D-10 (resolver consults cohort FIRST, falls back to UTM — this RPC owns
--   the cohort half of that lookup; UTM half lives in utm_variant_map joins).
--
-- Signature contract (must match Wave 2 variant-resolver Edge Fn expectations):
--   public.resolve_cohort_for_user(uid uuid) returns uuid
--
-- T-39-01-03 mitigation (RPC auth pattern from feedback_rpc_auth_uid_vs_service_role_mismatch):
--   - Takes EXPLICIT uid uuid parameter.
--   - Function body resolves identity from the parameter only.
--   - SECURITY DEFINER + set search_path = public, extensions (per
--     reference_supabase_migration_gotchas SECDEF + extensions requirement).
--   - Safe to call from service-role Edge Fn context (cron, fire-and-forget)
--     where the JWT-derived caller identity is absent.
--
-- Body logic:
--   Returns the FIRST cohort_definitions.id whose membership row matches the
--   provided uid in public.cohort_membership (populated every 15 min by
--   cohort_membership_rebuild()). Returns NULL when the user is in no Phase 39
--   cohort — the resolver then falls back to UTM (D-10 precedence).
--
-- Deterministic ordering: ORDER BY cd.created_at ASC ties first-seeded cohort
--   wins on multi-match. Wave 2 may refine ordering once business specifies
--   per-cohort priority; for now first-created is stable and predictable.

create or replace function public.resolve_cohort_for_user(uid uuid)
returns uuid
language sql
security definer
stable
set search_path = public, extensions
as $$
  select cd.id
    from public.cohort_membership cm
    join public.cohort_definitions cd on cd.id = cm.cohort_id
    where cm.user_id = uid
      and cd.status = 'active'
    order by cd.created_at asc
    limit 1;
$$;

comment on function public.resolve_cohort_for_user(uuid) is
  'Phase 39 D-07/D-10: returns the first matching active cohort_definitions.id '
  'for the given uid via cohort_membership lookup. Returns NULL if no cohort '
  'matches; resolver Edge Fn then falls back to UTM (D-10 precedence). Takes '
  'explicit uid param so it is safe to call from service-role contexts '
  '(feedback_rpc_auth_uid_vs_service_role_mismatch).';

revoke all on function public.resolve_cohort_for_user(uuid) from public;
grant execute on function public.resolve_cohort_for_user(uuid) to service_role;
grant execute on function public.resolve_cohort_for_user(uuid) to authenticated;
