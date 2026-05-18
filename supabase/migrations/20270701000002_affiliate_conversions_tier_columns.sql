-- Phase 26 Plan 01 — Affiliate conversions tier-stamp columns (D-16).
--
-- Adds the per-row tier snapshot column + anomaly review columns to the
-- existing public.affiliate_conversions table (shipped Phase 19, migration
-- 20270101000002_affiliate_clicks_conversions_payouts.sql).
--
-- AFFTIER-02 success criterion #1 anchor: tier_at_conversion_time is stamped
-- once by the BEFORE INSERT trigger in migration 20270701000003 and never
-- mutated thereafter. The DEFAULT 'standard' applies to pre-migration rows
-- only (single-ALTER backfill — no separate UPDATE needed).
--
-- The Migration 03 BEFORE INSERT trigger OVERWRITES NEW.tier_at_conversion_time
-- on every subsequent INSERT via `NEW.tier_at_conversion_time := v_tier;` —
-- the DEFAULT 'standard' only governs the historical row backfill.
--
-- Columns added:
--   tier_at_conversion_time         text NOT NULL default 'standard' check in (...)
--   recurring_commission_pct_basis  numeric(5,2) — populated by trigger for lifetime tier only
--   anomaly_flagged                 boolean NOT NULL default false
--   anomaly_z_score                 numeric — populated by Phase 26 Plan 02/07 baseline jobs
--   anomaly_reviewed_at             timestamptz — set by anomaly review RPCs
--   anomaly_review_decision         text check in ('clear','fraud_confirmed')
--
-- Index: idx_affiliate_conversions_anomaly_pending supports the operator review
-- queue (Plan 26-02 anomaly tab). IMMUTABLE-safe: equality-to-literal + IS NULL.
--
-- Idempotent.

alter table public.affiliate_conversions
  add column if not exists tier_at_conversion_time text not null default 'standard'
    check (tier_at_conversion_time in ('standard','gold','lifetime'));

alter table public.affiliate_conversions
  add column if not exists recurring_commission_pct_basis numeric(5,2);

alter table public.affiliate_conversions
  add column if not exists anomaly_flagged boolean not null default false;

alter table public.affiliate_conversions
  add column if not exists anomaly_z_score numeric;

alter table public.affiliate_conversions
  add column if not exists anomaly_reviewed_at timestamptz;

alter table public.affiliate_conversions
  add column if not exists anomaly_review_decision text
    check (anomaly_review_decision in ('clear','fraud_confirmed'));

-- Operator review queue: pending anomaly rows per affiliate, newest first.
-- IMMUTABLE-safe per Pitfall 1: equality-to-true + IS NULL.
create index if not exists idx_affiliate_conversions_anomaly_pending
  on public.affiliate_conversions(affiliate_id, created_at desc)
  where anomaly_flagged = true and anomaly_review_decision is null;
