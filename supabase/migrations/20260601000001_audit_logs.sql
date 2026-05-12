-- Phase 7 D-04 (audit log foundation — the headline threat-model surface for Phase 7).
--
-- Creates `public.audit_logs`: a single, append-only table that records every
-- cloud write across the 10 sync tables (the 9 Phase 6 sync tables +
-- Phase 5 injections). Companion migrations:
--   20260601000002_audit_triggers.sql       — SECURITY DEFINER trigger + 10 ATTACH statements
--   20260601000003_audit_retention_cron.sql — 13-month retention pg_cron job
--
-- Feeds three downstream stories (per CONTEXT.md):
--   (a) D-03 account-delete skeleton — `action='account_deleted_initiated'` and
--       `action='account_deleted_finalized'` rows survive forever via the
--       retention cron's `action NOT LIKE 'account_deleted_%'` exclusion.
--   (b) Phase 6 D-11 LWW conflict toast — "what was overwritten?" recovery uses
--       (before_hash, after_hash) to prove a row changed without storing PII
--       in the indefinite-retention skeleton path.
--   (c) HBNR breach-tracking — 13 months of full per-write history covers an
--       annual reporting cycle + 1 month buffer.
--
-- Table-count rationale: D-04 was authored when injections was still the only
-- sync table ("9 sync tables" pre-Phase 6 thinking). Phase 6 added 9 more
-- (weights, meals, workouts, supplements, mood, sleep, symptoms, vials,
-- settings). Triggers attach to all 10. `ai_messages` is INTENTIONALLY EXCLUDED
-- — it's the AI conversation log, not medical sync data; D-04 scopes audit_logs
-- to "every cloud write across the sync tables" of medical data.
--
-- STRIDE register (full text lives in 07-08-PLAN.md):
--   T-07-08-01 Tampering: authenticated role cannot directly INSERT/UPDATE/DELETE
--     audit_logs rows. THIS migration intentionally creates ONLY a SELECT policy;
--     the absence of write policies IS the mitigation (default-deny). Only the
--     SECURITY DEFINER `audit_trigger()` function and the service_role can write.
--   T-07-08-04 Information disclosure: RLS `audit_logs_select_own` (auth.uid()
--     = user_id) keeps user A's audit rows invisible to user B. Cross-tenant
--     impersonation proof in e2e/rls-audit-logs.test.ts.
--   T-07-08-05 Reverse-lookup on user_id_hash: accepted — uuid is 128 bits of
--     entropy; sha256 brute-force infeasible.
--
-- Realtime: audit_logs is NOT added to supabase_realtime. It's a server-internal
-- table; clients should not receive postgres_changes broadcasts. (Contrast with
-- injections, which IS in supabase_realtime — see 20260513000000_injections.sql.)

create extension if not exists pgcrypto;
-- Provides digest() for sha256 hashing inside audit_trigger() (migration 20260601000002).
-- Supabase Free/Pro tier ships pgcrypto by default; `if not exists` is the
-- idempotent safety net for re-runs of supabase db push.

create table public.audit_logs (
  id bigserial primary key,
  timestamp timestamptz not null default now(),

  -- user_id is `on delete set null` (NOT cascade) so the skeleton row survives
  -- account deletion per D-03. The auth.users row gets cascade-deleted at T+30d
  -- by the account-delete RPC (Phase 7 plan 07-07), but the audit row remains.
  -- user_id_hash (not-null below) keeps the row attributable to a stable
  -- identifier even after auth.users vanishes.
  user_id uuid references auth.users(id) on delete set null,

  -- sha256(user_id::text) — survives auth.users deletion. Not-null so the
  -- skeleton subset always has an attribution column. Once auth.users is gone,
  -- the hash is no longer "personal data" (uuid is 128 bits of entropy; no
  -- rainbow-table attack feasible — key justification for GDPR/WMHMDA-
  -- compatible indefinite retention of the skeleton subset, per D-03).
  user_id_hash text not null,

  -- Source table for the write (e.g., 'injections', 'weights', ..., 'settings').
  -- Populated from tg_table_name in the trigger function.
  table_name text not null,

  -- Composite-PK row identifier, serialized as text. Works for the 9
  -- composite-PK tables AND for settings (PK = user_id alone — singleton).
  -- Nullable for skeleton rows (action='account_deleted_*') where no
  -- row-level write happened.
  row_id text,

  -- The trigger function lowercases tg_op into 'insert'|'update'|'delete'.
  -- Plan 07-07 (account-delete RPC) will INSERT rows with the skeleton actions
  -- directly via service_role (which bypasses RLS).
  action text not null check (action in (
    'insert', 'update', 'delete',
    'account_deleted_initiated', 'account_deleted_finalized'
  )),

  -- sha256(row_to_json(OLD)::text) — null on INSERT (no pre-state).
  -- 64 lowercase hex chars when present (asserted by the trigger-fires test).
  before_hash text,

  -- sha256(row_to_json(NEW)::text) — null on DELETE (no post-state).
  -- 64 lowercase hex chars when present.
  after_hash text,

  -- sha256(x-forwarded-for) — null when not available (we don't propagate the
  -- client IP into Postgres for sync-table writes; reserved for the
  -- skeleton-row insert path in plan 07-07 where the edge function has the
  -- request context). Tracked for HBNR forensics.
  ip_hash text
);

-- Per-user listing index (newest first) — supports support investigation
-- queries like "show me user X's last 100 audit entries".
create index audit_logs_user_timestamp_idx
  on public.audit_logs (user_id, timestamp desc);

-- Partial index on the skeleton subset — supports the retention cron's
-- `WHERE action NOT LIKE 'account_deleted_%'` exclusion AND
-- "show me all account-delete events in 2026" queries.
create index audit_logs_action_idx
  on public.audit_logs (action) where action like 'account_deleted_%';

alter table public.audit_logs enable row level security;

-- SELECT: users see ONLY their own audit rows. RLS filters silently — user B's
-- SELECT against user A's data returns [] (not 403). Proven at runtime by
-- e2e/rls-audit-logs.test.ts (Task 6 Test 1).
create policy "audit_logs_select_own"
  on public.audit_logs
  for select
  using (auth.uid() = user_id);

-- TAMPERING MITIGATION (STRIDE-T, threat T-07-08-01):
--
-- NO INSERT, UPDATE, or DELETE policy exists for the authenticated role on
-- public.audit_logs. Postgres RLS default-deny semantics mean any direct
-- write attempt from a JWT-scoped client returns 42501 / "violates row-level
-- security". ONLY two write paths exist:
--
--   1. The SECURITY DEFINER `public.audit_trigger()` function attached in
--      migration 20260601000002. It runs as the function-owner role
--      (Supabase `postgres` — non-superuser on managed projects), which
--      bypasses RLS by design for the table-owner.
--   2. The service_role JWT used by edge functions (e.g., plan 07-07's
--      account-delete RPC), which bypasses RLS by Supabase convention.
--
-- This is the negative-space mitigation — the absence of policies is the
-- enforcement. DO NOT add INSERT/UPDATE/DELETE policies for the authenticated
-- role; doing so would defeat the tampering protection.
--
-- Runtime proofs:
--   - src/test/audit-trigger.test.ts Test 4: authenticated INSERT → 42501.
--   - e2e/rls-audit-logs.test.ts Test 2: cross-tenant impersonation INSERT → 42501.

-- NO trigger attachments here — they live in 20260601000002_audit_triggers.sql
-- so that the table exists before the triggers reference it. Migration order
-- is load-bearing.

-- NO realtime publication membership — audit_logs is server-internal.
