-- =============================================================================
-- Phase 25 Plan 25-01 — vendor_baa_chain table
-- =============================================================================
--
-- Purpose: Load-bearing schema for HIPAA vendor BAA chain tracking.
--   Closes HIPAA-12 (storage half) and HIPAA-13 (expiry-tracking half).
--   Every other Phase 25 plan depends on this table for vendor BAA state
--   tracking, subprocessor diffing, and the admin Compliance UI (Plan 25-08).
--
-- Decisions honored: Phase 25 D-01 (6-vendor BAA chain, costs), D-12 (expiry
--   + subprocessor-diff alerting, admin banner + email-to-founder + audit-log).
--
-- STRIDE register (T-25-01-01 through T-25-01-03):
--   T-25-01-01 Tampering — NO INSERT/UPDATE/DELETE policy for `authenticated`
--     role; only `is_admin_at_least('staff')` select + superadmin insert/update;
--     service_role REVOKE update,delete prevents Edge-Function bypass.
--   T-25-01-02 Information disclosure — select policy
--     `public.is_admin_at_least('staff'::public.admin_role)` ensures only
--     staff/admin/superadmin can read vendor names + BAA dates; patient and
--     clinician roles cannot.
--   T-25-01-03 Repudiation — append-only-by-policy (no delete); updated_at
--     trigger gives change history; audit_logs integration wired in Plan 25-08.
--
-- Status column writer-ownership (per feedback_status_machine_transition_owner):
--   'pending' — this migration seed (Plan 25-01)
--   'signed'  — founder UI SECURITY DEFINER RPC in Plan 25-08
--   'expired' — baa-expiry-check cron Edge Function in Plan 25-08
--
-- Pattern S2 (dual-layer security): RLS + explicit service_role REVOKE.
-- Pattern S7 (SECURITY DEFINER): updated_at trigger uses standard plpgsql body
--   (no SECURITY DEFINER needed for a plain trigger function; safe to run as
--   invoking role since it only sets NEW.updated_at).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Status enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.vendor_baa_status as enum ('pending', 'signed', 'expired');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
create table public.vendor_baa_chain (
  vendor_name              text                     primary key,
  baa_signed_at            timestamptz,
  baa_expiry_at            timestamptz,
  monthly_cost_usd         numeric(10,2)            not null default 0,
  scope_summary            text,
  subprocessor_list        jsonb                    not null default '[]'::jsonb,
  subprocessor_last_diff_at timestamptz,
  contact_email            text,
  status                   public.vendor_baa_status not null default 'pending',
  created_at               timestamptz              not null default now(),
  updated_at               timestamptz              not null default now()
);

comment on table public.vendor_baa_chain is
  'HIPAA-12/13: Tracks BAA status, expiry, and subprocessor lists for all 6 critical vendors. '
  'Status writer-ownership: pending=Plan25-01 seed; signed=Plan25-08 founder UI RPC; '
  'expired=Plan25-08 baa-expiry-check cron.';

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger
--    Table-specific function following the pattern in affiliates_schema.sql.
--    Plain plpgsql trigger (no SECURITY DEFINER needed — reads/writes only NEW).
-- ---------------------------------------------------------------------------
create or replace function public.vendor_baa_chain_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_vendor_baa_chain_set_updated_at on public.vendor_baa_chain;
create trigger trg_vendor_baa_chain_set_updated_at
  before update on public.vendor_baa_chain
  for each row execute function public.vendor_baa_chain_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.vendor_baa_chain enable row level security;

-- (a) Select: any staff-tier or above may read
create policy vendor_baa_chain_select_staff
  on public.vendor_baa_chain
  for select
  using (public.is_admin_at_least('staff'::public.admin_role));

-- (b) Insert: superadmin only
create policy vendor_baa_chain_insert_superadmin
  on public.vendor_baa_chain
  for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and admin_role = 'superadmin'
    )
  );

-- (c) Update: superadmin only
create policy vendor_baa_chain_update_superadmin
  on public.vendor_baa_chain
  for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and admin_role = 'superadmin'
    )
  );

-- NO delete policy — BAA records are append-only by intent; history is preserved.
-- Absence of DELETE policy means no role (including authenticated superadmin) can
-- delete rows via PostgREST or the JS client. This is intentional: removing a BAA
-- record would obscure the compliance audit trail. Hard deletes are blocked even for
-- superadmins. If a vendor must be removed, set status='expired' and add a comment.

-- ---------------------------------------------------------------------------
-- 5. service_role REVOKE (Pattern S2 — RESEARCH Pitfall 6)
--    RLS does NOT block service_role by default. Explicit REVOKE enforces
--    the append-only contract at the privilege level, not just policy level.
--    INSERT is retained for service_role (cron may eventually need it).
--    UPDATE and DELETE are revoked — status transitions MUST go through the
--    SECURITY DEFINER RPC in Plan 25-08, not a raw service_role client call.
-- ---------------------------------------------------------------------------
revoke update, delete on public.vendor_baa_chain from service_role;

-- ---------------------------------------------------------------------------
-- 6. Seed rows (D-01 cost figures + status='pending')
--    on conflict do nothing makes re-runs safe (idempotent).
-- ---------------------------------------------------------------------------
insert into public.vendor_baa_chain
  (vendor_name, baa_signed_at, baa_expiry_at, monthly_cost_usd,
   scope_summary, subprocessor_list, subprocessor_last_diff_at,
   contact_email, status)
values
  ('Supabase', null, null, 924.00,
   'Database + Auth + Storage + Edge Functions (HIPAA add-on on Team plan)',
   '[]'::jsonb, null, null, 'pending'),
  ('Vercel', null, null, 350.00,
   'Hosting + Edge Runtime + AI Gateway (HIPAA add-on on Pro plan, self-serve since 2025)',
   '[]'::jsonb, null, null, 'pending'),
  ('Sentry', null, null, 80.00,
   'Error monitoring + session replay (Business plan with BAA)',
   '[]'::jsonb, null, null, 'pending'),
  ('Anthropic', null, null, 1500.00,
   'Clinical-credential LLM (Enterprise + BAA + ZDR addendum; sales-assisted)',
   '[]'::jsonb, null, null, 'pending'),
  ('AWS SES', null, null, 10.00,
   'PHI email delivery (BAA via AWS Artifact, self-serve same-day)',
   '[]'::jsonb, null, null, 'pending'),
  ('PostHog', null, null, 0.00,
   'Product analytics + session replay (scrub-only tier per D-04; revisit Boost only if clinician-replay becomes active blocker)',
   '[]'::jsonb, null, null, 'pending')
on conflict (vendor_name) do nothing;
