-- Phase 24: Extend audit_logs with Phase 24 admin columns + update RLS policies
-- Decision ref: D-14, D-15, D-17
--
-- The Phase 7 audit_logs table already exists with columns:
--   id, timestamp, user_id, user_id_hash, table_name, row_id, action, before_hash, after_hash, ip_hash
--
-- Phase 24 adds the new admin-audit columns needed by log_admin_action() and
-- the Phase 24 PHI triggers (full before/after JSONB, actor/target user IDs,
-- explicit source discriminator, org_id forward-compat for P28).
--
-- The existing Phase 7 trigger + Phase 7 RLS policy (audit_logs_select_own)
-- continue to work unchanged. New Phase 24 columns are nullable so existing
-- rows are unaffected.
--
-- D-17 Append-only RLS: DENY update + delete for ALL roles including service_role.
-- The existing Phase 7 schema had no explicit REVOKE for service_role; this
-- migration adds it to close the gap per the threat model (T-24-03).

-- -----------------------------------------------------------------------
-- 1. Add Phase 24 columns (all nullable for backward compat with Phase 7 rows)
-- -----------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists actor_user_id  uuid references auth.users(id),
  add column if not exists target_user_id uuid references auth.users(id),
  add column if not exists action_name    text,
  add column if not exists row_pk         text,
  add column if not exists before_data    jsonb,
  add column if not exists after_data     jsonb,
  add column if not exists source         text check (source in ('rpc', 'trigger')),
  add column if not exists org_id         uuid;  -- P28 forward-compat, nullable

-- -----------------------------------------------------------------------
-- 2. Indexes for Phase 24 admin queries
-- -----------------------------------------------------------------------
create index if not exists audit_logs_actor_created_idx
  on public.audit_logs (actor_user_id, timestamp desc);

create index if not exists audit_logs_target_created_idx
  on public.audit_logs (target_user_id, timestamp desc);

create index if not exists audit_logs_table_created_idx
  on public.audit_logs (table_name, timestamp desc);

-- -----------------------------------------------------------------------
-- 3. Admin read policy (admin-or-higher can read ALL audit rows)
-- -----------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_logs'
      and policyname = 'audit_logs_select_admin'
  ) then
    create policy "audit_logs_select_admin"
      on public.audit_logs
      for select
      using (public.is_admin_at_least('admin'::public.admin_role));
  end if;
end $$;

-- -----------------------------------------------------------------------
-- 4. Append-only enforcement: DENY update + delete for ALL roles
-- Per D-17: service_role bypasses RLS by default — explicit REVOKE closes gap.
-- -----------------------------------------------------------------------

-- UPDATE deny policy
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_logs'
      and policyname = 'audit_logs_no_update'
  ) then
    create policy "audit_logs_no_update"
      on public.audit_logs
      for update
      using (false)
      with check (false);
  end if;
end $$;

revoke update on public.audit_logs from authenticated, anon, service_role;

-- DELETE deny policy
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_logs'
      and policyname = 'audit_logs_no_delete'
  ) then
    create policy "audit_logs_no_delete"
      on public.audit_logs
      for delete
      using (false);
  end if;
end $$;

revoke delete on public.audit_logs from authenticated, anon, service_role;

-- -----------------------------------------------------------------------
-- 5. Restrict direct INSERT: only postgres (table owner) + SECURITY DEFINER fns
-- -----------------------------------------------------------------------
revoke insert on public.audit_logs from authenticated, anon, service_role;
grant insert on public.audit_logs to postgres;
