-- Phase 22 plan 01 — D-06: DSAR (data subject access request) tracker table + admin reject RPC.
-- Analog: supabase/migrations/20260601000010_pending_account_deletions.sql (RLS-locked-table)
-- Pitfalls applied: feedback_status_machine_transition_owner.md (every status enum value has an
--                   explicit writer in the comments below; admin_reject_dsar RPC included in this
--                   same migration to close the 'rejected' transition gap up-front).
--
-- Status enum value writers (per S6 audit):
--   pending     ← DsarPortalPage submit (plan 22-11) — INSERT via authenticated client.
--   in_progress ← dsar-export Edge Function (plan 22-04) — UPDATE on processing start.
--   completed   ← dsar-export Edge Function (plan 22-04) — UPDATE on success.
--   rejected    ← admin_reject_dsar SECURITY DEFINER RPC (THIS migration) — admin review surface.

create type public.dsar_request_status as enum ('pending', 'in_progress', 'completed', 'rejected');

create table if not exists public.dsar_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  status public.dsar_request_status not null default 'pending',
  rejection_reason text,
  export_path text,
  export_signed_url_expires_at timestamptz
);

create index if not exists dsar_requests_user_idx
  on public.dsar_requests (user_id, requested_at desc);

create index if not exists dsar_requests_status_idx
  on public.dsar_requests (status, requested_at)
  where status in ('pending', 'in_progress');

alter table public.dsar_requests enable row level security;

-- T-22-05 mitigation: select-own only.
create policy "dsar_requests_select_own"
  on public.dsar_requests
  for select to authenticated
  using (auth.uid() = user_id);

-- INSERT: self-only ('pending' default). Status transitions handled by Edge Fn (service_role) + RPC.
create policy "dsar_requests_insert_own"
  on public.dsar_requests
  for insert to authenticated
  with check (auth.uid() = user_id and status = 'pending');

-- NO UPDATE/DELETE policy for authenticated. service_role + admin_reject_dsar are the only writers.

-- =============================================================================
-- admin_reject_dsar — is_staff-gated RPC; sets status='rejected' + records reason.
-- =============================================================================
create or replace function public.admin_reject_dsar(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_target_user uuid;
begin
  if v_caller_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.dsar_requests
     set status = 'rejected',
         rejection_reason = p_reason,
         completed_at = now()
   where id = p_request_id
     and status in ('pending', 'in_progress')
  returning user_id into v_target_user;

  if v_target_user is null then
    raise exception 'dsar_request_not_found_or_finalized' using errcode = 'P0002';
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id
  ) values (
    v_caller_uid,
    encode(digest(v_caller_uid::text, 'sha256'), 'hex'),
    'dsar_requests',
    p_request_id::text,
    'dsar_completed', -- reusing dsar_completed enum for rejection finalization terminal state
    v_target_user
  );
end;
$$;

revoke all on function public.admin_reject_dsar(uuid, text) from public;
grant execute on function public.admin_reject_dsar(uuid, text) to authenticated;
