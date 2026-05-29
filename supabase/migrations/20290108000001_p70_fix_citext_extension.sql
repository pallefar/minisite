-- Plan 70-07 cascade-39 — remote-DB reconciliation (R2).
--
-- Root cause R2 (see 70-07-UNIT-DRIFT-ROOTCAUSE.md):
--   20270601100011_resolve_clinic_slug_rpc.sql:87 compares
--     `oi.email = v_email::citext`
--   under `set search_path = pg_catalog, public, extensions`, but no migration
--   ever installed the citext extension. Every resolve_clinic_slug() call fails
--   at runtime with `42704 type "citext" does not exist`.
--
-- Fix: install citext into the `extensions` schema (already on the RPC's
-- search_path). Idempotent.
--
-- Affected tests (live remote DB): src/lib/__tests__/resolve-clinic-slug.test.ts
-- T2/T3/T5/T8/T9.

create extension if not exists citext with schema extensions;
