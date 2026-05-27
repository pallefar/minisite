-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-03)
-- Phase 65.1 rewrite (2026-05-27) — target public.subscriptions (canonical)
-- =============================================================================
--
-- Mirrors B2B Stripe Tax `tax_id_collection` capture into our DB. Stripe Tax
-- collects EIN / VAT-ID at checkout for B2B (clinic) subscriptions; the webhook
-- handler in Plan 65-04 writes the captured id into public.subscriptions.tax_id
-- (clinic rows — i.e. where clinic_id IS NOT NULL) so we can render it on
-- receipts and inside /admin/tax.
--
-- CANONICAL TABLE — public.subscriptions (Phase 14, migration 20260601000019):
--   Phase 29 D-14 BREAKING CHANGE dropped the prior placeholder clinic-subs
--   table. Clinic subscriptions now live in public.subscriptions WHERE
--   clinic_id IS NOT NULL (CHECK enforces exactly one of user_id / clinic_id
--   is non-null). See 20270601200001_p29_reconcile.sql for the drop lineage.
--
-- IMPORTANT: ALTER TABLE on a production table → use ADD COLUMN IF NOT EXISTS
-- guard per [[reference_rag_sources_source_type_drift]].
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- (last applied on remote at 20290103000005).
--
-- Per [[feedback_planner_vs_archived_schema_drift]] — this migration replaces
-- the original Phase 65-01 body which targeted a dropped placeholder table.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Column: public.subscriptions.tax_id
--    Nullable text — only B2B (clinic) subs collect this; consumer subs leave NULL.
--    Consumer/clinic distinction is the existing `clinic_id IS NOT NULL` filter
--    on the table; no separate column needed.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists tax_id text;

-- ---------------------------------------------------------------------------
-- 2. Index: composite partial btree on (clinic_id, tax_id) for non-null rows.
--    Most rows have tax_id NULL until Stripe Tax collection ramps up; partial
--    keeps the index lean. Predicate is IMMUTABLE-safe (column-only IS NOT NULL,
--    no functions, no now() — per reference_supabase_migration_gotchas Pitfall 1).
--
--    Composite (clinic_id, tax_id) — leading clinic_id supports /admin/tax
--    per-state aggregation queries that filter `clinic_id IS NOT NULL` first
--    then read tax_id.
-- ---------------------------------------------------------------------------

create index if not exists idx_subscriptions_clinic_tax_id
  on public.subscriptions(clinic_id, tax_id)
  where clinic_id is not null and tax_id is not null;

-- RLS unchanged — public.subscriptions already has RLS enabled in 20260601000019.
-- No CREATE POLICY here (per [[feedback_phase_close_out_supabase_gotchas]] (1) —
-- `CREATE POLICY IF NOT EXISTS` is unsupported on remote PG; nothing to add anyway).

-- Consumer rewrite (Phase 65.1):
--   supabase/functions/stripe-webhook/events/checkout-session-completed.ts now
--   writes via `.from('subscriptions').update({tax_id}).eq('id', subId)` where
--   subId is the Stripe sub_xxx text PK.

commit;
