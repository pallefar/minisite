-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-03)
-- =============================================================================
--
-- Mirrors B2B Stripe Tax `tax_id_collection` capture into our DB. Stripe Tax
-- collects EIN / VAT-ID at checkout for B2B (clinic) subscriptions; the webhook
-- handler in Plan 65-04 writes the captured id into public.org_subscriptions
-- so we can render it on receipts and inside /admin/tax.
--
-- IMPORTANT: ALTER TABLE on a production table → use ADD COLUMN IF NOT EXISTS
-- guard per the rag_sources.source_type drift pattern
-- ([[reference_rag_sources_source_type_drift]]).
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- (Phase 64 ended at 20290103000005).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Column: org_subscriptions.tax_id
--    Nullable text — only B2B (clinic) subs collect this; consumer subs leave NULL.
-- ---------------------------------------------------------------------------

alter table public.org_subscriptions
  add column if not exists tax_id text;

-- ---------------------------------------------------------------------------
-- 2. Index: partial btree on non-null tax_id rows only.
--    Most rows will be NULL until Stripe Tax collection ramps up; partial keeps
--    the index lean and IMMUTABLE-safe (IS NOT NULL predicate).
-- ---------------------------------------------------------------------------

create index if not exists idx_org_subscriptions_tax_id
  on public.org_subscriptions(tax_id)
  where tax_id is not null;

-- RLS unchanged — table already has RLS enabled in 20270601100008.

commit;
