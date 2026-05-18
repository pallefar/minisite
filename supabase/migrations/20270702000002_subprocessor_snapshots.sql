-- =============================================================================
-- Phase 25 Plan 25-01 — subprocessor_snapshots table (append-only)
-- =============================================================================
--
-- Purpose: Append-only ledger for weekly subprocessor list snapshots.
--   The Plan 25-08 subprocessor-diff cron reads vendor subprocessor URLs,
--   hashes the content, and inserts a new row only when content changes.
--   The unique index on (vendor_name, content_hash) provides idempotency.
--
-- Decisions honored: Phase 25 D-12 (BAA expiry + subprocessor-diff alert;
--   nightly + weekly cron routes alerts to admin banner + email-to-founder +
--   audit-log entry).
--
-- Pattern 2 (subprocessor-diff cron, per Phase 25 RESEARCH):
--   1. Cron fetches URL, hashes content, compares to last snapshot.
--   2. If content_hash differs: INSERT new row → trigger admin banner + email.
--   3. If content_hash matches: no new row (unique index silently no-ops).
--   service_role INSERT is retained (cron runs as service_role).
--   service_role UPDATE + DELETE are REVOKED (append-only by privilege level).
--
-- STRIDE register:
--   T-25-01-04 Tampering — append-only via absence of INSERT/UPDATE/DELETE
--     policies for the authenticated role; `revoke update,delete from service_role`
--     closes the elevated-privilege path; unique index on (vendor_name, content_hash)
--     prevents duplicate-content writes.
--   T-25-01-05 Information disclosure — staff-only select policy;
--     patient/clinician roles cannot read subprocessor payloads.
--
-- Status machine: no status column. Rows are immutable after insert.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.subprocessor_snapshots (
  id            bigserial    primary key,
  vendor_name   text         not null references public.vendor_baa_chain(vendor_name) on delete restrict,
  captured_at   timestamptz  not null default now(),
  source_url    text         not null,
  content_hash  text         not null,
  payload       jsonb        not null
);

comment on table public.subprocessor_snapshots is
  'HIPAA-12/13: Append-only ledger of weekly subprocessor page snapshots per vendor. '
  'Rows are IMMUTABLE after insert. Diff logic lives in Plan 25-08 baa-expiry-check cron.';

-- ---------------------------------------------------------------------------
-- 2. Indexes
--    idempotency: same (vendor_name, content_hash) = no new row inserted
--    lookup: most-recent snapshot per vendor (used by diff cron)
-- ---------------------------------------------------------------------------
create unique index subprocessor_snapshots_vendor_hash_idx
  on public.subprocessor_snapshots (vendor_name, content_hash);

create index subprocessor_snapshots_vendor_captured_idx
  on public.subprocessor_snapshots (vendor_name, captured_at desc);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.subprocessor_snapshots enable row level security;

-- Select: staff tier or above (admin Compliance UI reads diff history)
create policy subprocessor_snapshots_select_staff
  on public.subprocessor_snapshots
  for select
  using (public.is_admin_at_least('staff'::public.admin_role));

-- NO insert/update/delete policy for authenticated role.
-- Only service_role may INSERT (cron is service-role-only).
-- The explicit REVOKE below removes UPDATE + DELETE from service_role too,
-- making this table truly append-only at the privilege level.

-- Negative-space tamper comment: there is intentionally no DELETE policy.
-- Removing subprocessor snapshots would undermine the audit trail that
-- compliance reviewers need to verify subprocessor change detection.
-- If a row was inserted in error, use a corrective INSERT with a note in payload.

-- ---------------------------------------------------------------------------
-- 4. service_role REVOKE (Pattern S2 — RESEARCH Pitfall 6)
--    RLS does NOT block service_role by default.
--    INSERT retained for service_role (diff cron needs it).
--    UPDATE + DELETE revoked — rows are immutable after insert.
-- ---------------------------------------------------------------------------
revoke update, delete on public.subprocessor_snapshots from service_role;
