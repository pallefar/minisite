-- Phase 8 Plan 08-01 — public.shares table + RLS + indexes + audit_logs FK.
--
-- This is the load-bearing primitive for Phase 8 (D-02 revocation primitive,
-- D-03 recipient binding). Storing:
--   - id            opaque share identifier (the JWT/cookie claim per D-02(c))
--   - user_id       patient owner — JWT-validated via auth.uid() filter
--   - label         patient-supplied audience label ("Dr. Smith — Q2 review")
--   - token_hash    sha256 of the URL token (1-time return from create_share)
--   - access_code_hash bcrypt of the 6-digit code (1-time return; recipient
--                   delivers out-of-band; single-use)
--   - expires_at    hard ceiling regardless of revoke status
--   - revoked_at    null while live; set by revoke_share — Edge Function checks
--                   on every request (D-02 revocation primitive)
--   - code_consumed_at  set on first successful code redemption (D-03 single-use)
--   - recipient_session_hash  sha256 of the opaque cookie-token issued at redeem;
--                   subsequent share-route requests must match this hash
--   - failed_attempts_count + last_attempt_at  per-share brute-force rate-limit
--                   (Pitfall 5 — per-share, NOT per-user)
--   - created_at    audit anchor
--
-- RLS: owner-SELECT only. NO authenticated INSERT/UPDATE/DELETE policies — the
-- 6 SECURITY DEFINER RPCs in migration 20260701000003 are the ONLY mutation
-- surface. service_role bypasses RLS for Edge Function reads (token-hash
-- lookups happen there).
--
-- Threat register coverage (full text in 08-01-PLAN.md):
--   T-08-T1 (tampering, extend expires_at): no UPDATE policy + revoke_share
--     RPC writes only revoked_at, never expires_at.
--   T-08-I1 (cross-tenant SELECT): RLS shares_select_own; proven at runtime
--     by e2e/rls-shares.test.ts (project rule).
--   T-08-I3 (hash leak via SELECT): owner CAN read their hashes via own-row
--     SELECT, but cannot reverse them (sha256/bcrypt). Plan 08-03's Active-
--     shares-tab UI reads via a safe-columns RPC, not direct SELECT.
--
-- FK migration-order note: audit_logs.share_id was added column-only in
-- migration 20260701000001 (no FK at that point — shares didn't exist yet).
-- This migration adds the FK constraint AFTER public.shares is created.
-- `on delete set null` preserves audit history when a share row is hard-deleted
-- (e.g. via auth.users cascade on patient account deletion); the audit row
-- survives with share_id=null. No app.suppress_audit GUC hook is needed because
-- `set null` on audit_logs.share_id does NOT fire a DELETE cascade on the
-- audit_logs row itself.

create table public.shares (
  id uuid primary key default gen_random_uuid(),

  -- Patient owner. Cascade on delete: when the patient's auth.users row is
  -- finalized-deleted (Phase 7 finalize_account_deletion), all their shares
  -- are removed. This is acceptable because the audit_logs.share_id FK is
  -- `set null` (audit history survives), and the doctor's open tab will hit
  -- 404 / 401 on the next request — same UX as a revoked share.
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Patient-supplied audience label.
  label text not null check (char_length(label) between 1 and 80),

  -- sha256(raw_token, 'hex') — never the raw token. The unique index below
  -- supports Edge Function token lookup: SELECT * FROM shares WHERE
  -- token_hash = encode(digest(:raw_token, 'sha256'), 'hex').
  token_hash text not null,

  -- bcrypt(raw_code, gen_salt('bf', 10)) — verified via crypt() in the
  -- verify_share_code RPC (migration 20260701000003). 10 rounds matches
  -- Supabase auth.users.encrypted_password default.
  access_code_hash text not null,

  -- Hard ceiling. CHECK enforces expires_at > created_at so the row is at
  -- least minimally meaningful.
  expires_at timestamptz not null,

  -- Revocation gate (D-02). Edge Function checks `revoked_at IS NULL AND
  -- expires_at > now()` on EVERY request.
  revoked_at timestamptz,

  -- D-03 single-use code marker. Set by redeem_share on first successful
  -- code entry; second redeem on same row raises P0002.
  code_consumed_at timestamptz,

  -- D-03 recipient binding. sha256 of the opaque cookie token. Edge
  -- Function on subsequent /share/* requests compares
  -- sha256(cookie_value) against this column.
  recipient_session_hash text,

  -- Per-share brute-force rate-limit (Pitfall 5). Incremented by
  -- increment_share_attempt RPC on each failed code-compare. Edge Function
  -- rejects further redeem attempts once this exceeds the threshold (e.g. 5
  -- per share, per-request-window enforced upstream).
  failed_attempts_count integer not null default 0,
  last_attempt_at timestamptz,

  created_at timestamptz not null default now(),

  -- Row-shape sanity. The expiry must be in the future relative to creation.
  constraint shares_expires_after_created_chk
    check (expires_at > created_at)
);

-- Edge Function token-hash lookup (single-result expected; the unique
-- constraint also guards against accidental hash collisions, though sha256
-- collisions are not a realistic concern at v1 scale).
create unique index shares_token_hash_idx
  on public.shares (token_hash);

-- Active-shares listing for the patient's Settings tab — supports
-- "SELECT * FROM shares WHERE user_id = $1 AND revoked_at IS NULL
-- AND expires_at > now() ORDER BY expires_at" pattern. The WHERE clause
-- in the index uses ONLY `revoked_at IS NULL` (column-vs-literal NULL
-- check — IMMUTABLE-safe per Pitfall 2). `expires_at > now()` is applied
-- at query time, NOT inside the index.
create index shares_user_active_idx
  on public.shares (user_id, expires_at)
  where revoked_at is null;

-- Enable RLS. Owner can SELECT own rows; no INSERT/UPDATE/DELETE policies for
-- authenticated role (the 6 RPCs are the ONLY write path; service_role
-- bypasses RLS for Edge Function reads). This is the same "negative-space
-- mitigation" pattern Phase 7 audit_logs uses.
alter table public.shares enable row level security;

create policy "shares_select_own"
  on public.shares
  for select
  using (auth.uid() = user_id);

-- DO NOT add INSERT/UPDATE/DELETE policies. RPCs handle all writes.
-- Direct authenticated writes are intentionally rejected by RLS default-deny
-- — this is the threat-model headline mitigation for T-08-T1 + T-08-T2.

-- Add the FK on audit_logs.share_id NOW that public.shares exists.
-- `on delete set null` preserves the audit history when a share row is
-- removed (cascade from auth.users on account-delete, or future hard-delete
-- paths). This does NOT fire any audit cascade because the audit row itself
-- is not deleted — only the share_id pointer is nulled — so no
-- app.suppress_audit GUC interaction is required.
alter table public.audit_logs
  add constraint audit_logs_share_id_fkey
  foreign key (share_id) references public.shares(id) on delete set null;
