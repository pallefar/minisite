-- Migration: ses_suppression_list — Phase 25 Plan 25-03 (HIPAA-05, Pattern S2)
--
-- Purpose: Append-only table storing hashed recipient addresses that have
-- bounced or triggered complaint events via AWS SES / SNS. The email-router
-- consults this table before every PHI send; the ses-bounce-webhook inserts
-- into it via service_role only.
--
-- Security design (Pattern S2 — negative-space comment):
--   - INSERT: service_role only (ses-bounce-webhook Edge Function). No RLS
--     insert policy exists; Postgres will deny inserts from authenticated/anon
--     roles because RLS is enabled and there is no matching policy.
--   - SELECT: staff-and-above admins only (is_admin_at_least('staff')).
--     Regular users and the anon role cannot enumerate suppressed recipients.
--   - UPDATE / DELETE: REVOKED from service_role explicitly. The suppression
--     list is forensic evidence; post-write mutations violate T-25-03-T1.
--     The only way to un-suppress a recipient is via a superadmin-signed
--     one-off migration (deliberate friction).
--   - recipient_hash is a SHA-256 hex of the lowercased recipient address,
--     never the raw address, satisfying T-25-03-I1.
--   - sns_message_id UNIQUE ensures idempotent webhook re-deliveries produce
--     no duplicate rows (T-25-03-R1).

create table public.ses_suppression_list (
  recipient_hash    text        not null,
  suppression_reason text       not null check (suppression_reason in ('bounce', 'complaint')),
  suppressed_at     timestamptz not null default now(),
  sns_message_id    text        not null unique,
  raw_payload       jsonb       not null,
  created_at        timestamptz not null default now(),
  constraint ses_suppression_list_pkey primary key (recipient_hash, sns_message_id)
);

comment on table public.ses_suppression_list is
  'Append-only AWS SES bounce/complaint suppression list. '
  'Inserts via service_role (ses-bounce-webhook Edge Fn) only. '
  'SELECT visible to staff+ admins. UPDATE/DELETE revoked. '
  'recipient_hash = sha256(lower(email)); raw email never stored. '
  'Phase 25 Plan 25-03, HIPAA-05, Pattern S2.';

comment on column public.ses_suppression_list.recipient_hash is
  'SHA-256 hex of lowercased recipient email address. Never store raw address.';
comment on column public.ses_suppression_list.suppression_reason is
  'bounce or complaint (per AWS SES notification type).';
comment on column public.ses_suppression_list.sns_message_id is
  'AWS SNS MessageId — UNIQUE ensures idempotent webhook re-delivery.';
comment on column public.ses_suppression_list.raw_payload is
  'Full SNS notification JSON for audit purposes. No filtering.';

-- Index: allow fast range scans for compliance reporting.
create index ses_suppression_list_suppressed_at_idx
  on public.ses_suppression_list (suppressed_at desc);

-- RLS: enable row-level security.
alter table public.ses_suppression_list enable row level security;

-- SELECT policy: staff-level admins and above only.
create policy "ses_suppression_list_select_staff"
  on public.ses_suppression_list
  for select
  using (public.is_admin_at_least('staff'::public.admin_role));

-- Negative space: no INSERT policy — service_role bypasses RLS.
-- Negative space: no UPDATE policy — service_role UPDATE/DELETE explicitly revoked below.
-- Negative space: no DELETE policy — forensic record; superadmin migration required to remove.

-- Revoke UPDATE and DELETE from service_role to enforce append-only invariant (T-25-03-T1).
-- service_role normally bypasses RLS; the REVOKE strips the underlying table privilege.
revoke update, delete on public.ses_suppression_list from service_role;
