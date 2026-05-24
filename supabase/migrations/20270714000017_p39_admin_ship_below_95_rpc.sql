-- Phase 39 Plan 39-07 — admin_ship_below_95 SECDEF RPC + audit table.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-12 (typed-confirmation modal + audit-logged ship-below-95),
--   PAYWALL-04, PAGEAB-05 (Ship-Winner promotion lifecycle).
--
-- STRIDE register (39-07 threat_model in 39-07-PLAN.md):
--   T-39-07-01 Repudiation: mitigated by writing admin_audit_log row BEFORE
--     the browser-initiated ship-winner-flag Edge Fn invocation.
--   T-39-07-02 Elevation: mitigated by is_admin_at_least('superadmin') gate
--     here (NOT 'admin' — strict superadmin requirement per UI-SPEC).
--
-- DEVIATION (Rule 2 — auto-add missing critical functionality):
--   The plan referenced `admin_audit_log` as if it already existed, but no
--   prior migration creates it (verified by `grep -l admin_audit_log
--   supabase/migrations/` returning nothing). The existing public.audit_logs
--   table is user-scoped (RLS auth.uid()=user_id) + has a CHECK-constrained
--   action enum that doesn't include 'ship_below_95'. Widening that enum +
--   re-purposing user-scoped audit for an admin-only table would couple
--   unrelated concerns. Per [[feedback_executor_auto_adds_missing_migration]]
--   the audit table is a SMALL + ISOLATED + STRICTLY required artifact for
--   the T-39-07-01 mitigation to hold, so it ships INLINE here. Documented
--   in 39-07-SUMMARY.md Deviations.
--
-- Split responsibility note (D-12):
--   This RPC writes the audit row ONLY. The browser then invokes the
--   ship-winner-flag Edge Fn separately (verbatim Phase 34/35 contract).
--   Splitting keeps service-role context on the cron path, not the
--   user-action path — and lets the typed-confirmation modal call both
--   surfaces independently without coupling.
--
-- Pattern memory invariants:
--   - [[reference_supabase_migration_gotchas]]: SECURITY DEFINER requires
--     `set search_path = extensions, public, pg_temp`.
--   - Pattern S2 (39-PATTERNS.md): NO INSERT/UPDATE/DELETE RLS policies on
--     admin_audit_log — only this SECDEF RPC writes, mirroring rag_topic_audit
--     (20260519000005) and audit_logs (20260601000001).

-- ============================================================================
-- 1. admin_audit_log table — append-only operator action trail
-- ============================================================================

create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Phase 39 D-12 + T-39-07-01: append-only operator action audit. Writes flow '
  'only through SECDEF RPCs (admin_ship_below_95 + future admin actions). NO '
  'INSERT/UPDATE/DELETE RLS policies — Pattern S2. Distinct from '
  'public.audit_logs (which is user-scoped sync-table audit). actor_id is '
  'set null on auth.users delete so the audit skeleton survives operator '
  'offboarding (mirrors audit_logs D-03).';

create index if not exists admin_audit_log_actor_created_idx
  on public.admin_audit_log (actor_id, created_at desc);

create index if not exists admin_audit_log_action_created_idx
  on public.admin_audit_log (action, created_at desc);

alter table public.admin_audit_log enable row level security;

-- SELECT: admins (any admin role) can read. is_admin_at_least('admin') gates.
create policy pol_admin_audit_log_select_admins
  on public.admin_audit_log
  for select
  to authenticated
  using (public.is_admin_at_least('admin'::public.admin_role));

-- TAMPERING MITIGATION: NO INSERT/UPDATE/DELETE policy. Only SECDEF RPCs +
-- service_role can write. Default-deny IS the mitigation (mirrors
-- audit_logs T-07-08-01 pattern).

-- ============================================================================
-- 2. admin_ship_below_95 SECDEF RPC
-- ============================================================================

create or replace function public.admin_ship_below_95(
  p_variant_id uuid,
  p_reason     text,
  p_posterior  numeric
)
returns uuid
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_audit_id uuid;
begin
  -- T-39-07-02 Elevation: strict superadmin gate.
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden_not_superadmin'
      using errcode = '42501',
            hint = 'admin_ship_below_95 requires superadmin role.';
  end if;

  -- Argument validation: variant_id required.
  if p_variant_id is null then
    raise exception 'invalid_variant_id'
      using errcode = '22023',
            hint = 'p_variant_id must not be null.';
  end if;

  -- D-12: reason must be non-empty (UI's typed-confirmation also enforces,
  -- but defense-in-depth at the data layer).
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required'
      using errcode = '22023',
            hint = 'p_reason must be a non-empty string (D-12).';
  end if;

  -- Posterior bounded sanity check (0..1).
  if p_posterior is null or p_posterior < 0 or p_posterior > 1 then
    raise exception 'invalid_posterior'
      using errcode = '22023',
            hint = 'p_posterior must be in [0, 1].';
  end if;

  v_actor_id := auth.uid();

  -- T-39-07-01 mitigation: append-only audit row.
  insert into public.admin_audit_log (actor_id, action, context)
  values (
    v_actor_id,
    'ship_below_95',
    jsonb_build_object(
      'variant_id', p_variant_id,
      'posterior',  p_posterior,
      'reason',     p_reason
    )
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

comment on function public.admin_ship_below_95(uuid, text, numeric) is
  'Phase 39 D-12 + T-39-07-01/02: superadmin-only SECDEF RPC that writes one '
  'admin_audit_log row with action=ship_below_95 and full context (variant_id, '
  'posterior, reason). Does NOT invoke the ship-winner-flag Edge Fn — the '
  'browser invokes that separately AFTER this RPC succeeds (split responsibility '
  'keeps service-role context on the cron path, not the user-action path).';

revoke all on function public.admin_ship_below_95(uuid, text, numeric) from public;
grant execute on function public.admin_ship_below_95(uuid, text, numeric)
  to authenticated;
