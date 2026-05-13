-- Phase 9 Plan 09-01 — extend audit_actor_type enum (split from 20260801000001).
--
-- Postgres rejects using a newly-added enum value in the same transaction
-- ("unsafe use of new value of enum type", SQLSTATE 55P04). The supabase
-- migration runner wraps each migration file in a transaction, so the
-- partial-index `where actor_type in ('org_operator','org_member')` in
-- 20260801000001 fails when the enum-add lives in the same file.
--
-- This migration ONLY adds the two new enum values (each in its own statement
-- per the Postgres ALTER TYPE ADD VALUE rule). The follow-on migration
-- 20260801000001 then uses those values in column defaults, check constraints,
-- and the partial index WHERE clause.
--
-- IF NOT EXISTS makes the migration safely re-runnable.

alter type public.audit_actor_type add value if not exists 'org_operator';
alter type public.audit_actor_type add value if not exists 'org_member';
