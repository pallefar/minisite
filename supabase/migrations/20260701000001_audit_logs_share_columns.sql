-- Phase 8 Plan 08-01 — audit_logs extension for doctor read-share.
--
-- Extends the Phase 7 audit_logs table (20260601000001_audit_logs.sql) with
-- four columns that let us record `share_view` events with bucketed recipient
-- metadata. Migration ordering: this migration adds the columns + CHECK +
-- partial index + extended action whitelist. The FK on audit_logs.share_id
-- → public.shares(id) is added in the NEXT migration (20260701000002) after
-- the shares table exists.
--
-- Per memory `reference_supabase_migration_gotchas.md`:
--   (Pitfall 2) partial-index expressions must be IMMUTABLE — we use only
--   column-vs-literal comparisons in the WHERE clause, no now()/current_*.
--
-- ME-2 (regulator-audience hardening, threat T-08-I4): recipient_ip_family
-- MUST never carry full dot-quad IPv4 or full IPv6 addresses. The CHECK
-- constraint enforces /16 IPv4 buckets, /48 IPv6 buckets, or the sentinel
-- value 'unknown' — defense-in-depth at the DB layer regardless of how the
-- Edge Function parses x-forwarded-for upstream.
--
-- D-04 (CONTEXT.md): share_view rows carry actor_type='share_recipient' +
-- share_id=<uuid> + user_id=<patient_id> (for RLS scoping). The 13-month
-- retention cron from 20260601000003 already handles share_view rows —
-- they fall under the rolling window (NOT the indefinite-retention skeleton
-- subset). No changes to the cron are needed.

-- 1. Actor type enum. Distinguishes share-recipient writes from regular user
-- writes and system writes (e.g. account-delete skeleton rows). Default
-- `user` matches the semantics of every Phase 7 audit_logs row (they all
-- come from the audit_trigger fired by authenticated user writes).
do $$ begin
  create type public.audit_actor_type as enum ('user', 'share_recipient', 'system');
exception
  when duplicate_object then null;
end $$;

-- 2. New columns. share_id has NO FK here; the FK lands in migration
-- 20260701000002 after public.shares exists (migration-order correctness).
alter table public.audit_logs
  add column actor_type public.audit_actor_type not null default 'user';

alter table public.audit_logs
  add column share_id uuid;

alter table public.audit_logs
  add column recipient_ua_family text;

alter table public.audit_logs
  add column recipient_ip_family text;

-- 3. ME-2 CHECK on recipient_ip_family — defense-in-depth against PII-grade
-- IP precision leaking into audit rows. Allow only:
--   - IPv4 /16 bucket form: `<a>.<b>.0.0/16` (e.g. `192.0.0.0/16`)
--   - IPv6 /48 bucket form: `<hex-prefix>::/48` (e.g. `2001:db8::/48`)
--   - sentinel `unknown` (when Edge Function cannot determine a family)
-- Full dot-quads (`192.0.2.5`) and full IPv6 addresses are explicitly forbidden;
-- callers MUST bucket upstream. The regex anchors `^...$` so partial matches
-- cannot bypass.
alter table public.audit_logs
  add constraint audit_logs_recipient_ip_family_bucketed_chk
  check (
    recipient_ip_family is null
    or recipient_ip_family = 'unknown'
    or recipient_ip_family ~ '^[0-9]{1,3}\.[0-9]{1,3}\.0\.0/16$'
    or recipient_ip_family ~ '^[0-9a-fA-F:]+::/48$'
  );

-- 4. Extend the `action` whitelist to include `share_view`. Postgres's auto-
-- named inline CHECK constraint from 20260601000001 is `audit_logs_action_check`.
-- We DROP IF EXISTS (idempotent against re-runs / repaired-migration order)
-- and ADD the new one with the expanded value set. Preserves all four
-- previously-allowed values from the Phase 7 baseline:
--   insert, update, delete, account_deleted_initiated, account_deleted_finalized
alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (action in (
    'insert', 'update', 'delete',
    'account_deleted_initiated', 'account_deleted_finalized',
    'share_view'
  ));

-- 5. Partial index for the Active-shares-tab aggregate query
-- (count + max(timestamp) of doctor views per share). IMMUTABLE-safe — only
-- the column-vs-literal `actor_type = 'share_recipient'` comparison appears
-- in the WHERE clause (no now()/current_timestamp; per Pitfall 2). The
-- (share_id, timestamp desc) ordering matches Plan 08-03's query shape:
--   select share_id, count(*), max(timestamp) from audit_logs
--   where actor_type='share_recipient' and share_id = any($1) group by share_id.
create index audit_logs_share_recipient_idx
  on public.audit_logs (share_id, timestamp desc)
  where actor_type = 'share_recipient';

-- 6. audit_trigger() function: NO changes needed. share_view rows are NOT
-- written by the trigger — they're written directly by the
-- `log_share_view` SECURITY DEFINER RPC (defined in migration 20260701000003)
-- which the share Edge Function calls. The trigger's action enum domain
-- ('insert' | 'update' | 'delete') is unchanged by this migration; the
-- function continues to lowercase tg_op into those three values only. The
-- app.suppress_audit GUC mechanism from 20260601000017 is unaffected (share_view
-- rows are written directly, not via trigger, so the GUC bypass does not apply).
