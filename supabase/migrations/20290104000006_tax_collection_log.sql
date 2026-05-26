-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-01 audit trail)
-- =============================================================================
--
-- Records every Stripe Tax calculation hitting checkout. The stripe-webhook
-- handler (Plan 65-02 extension) inserts one row per `automatic_tax.status ==
-- 'complete'` event, capturing customer state/postal + tax breakdown for nexus
-- monitoring (Plan 65-08) and audit.
--
-- Threat model:
--   T-65-01-03 Information Disclosure: staff-only SELECT via public.is_staff();
--     customer_state is not PII alone but tax_amount_cents is sensitive.
--
-- Schema decisions:
--   - id is surrogate uuid PK (per [[reference_dual_auth_submission_table_pk_pattern]]).
--   - Both subscription_id (text) AND org_subscription_id (uuid) FKs exist —
--     a checkout produces exactly one of them.
--     CHECK: at least one of subscription_id / org_subscription_id is non-null.
--   - org_subscription_id references org_subscriptions(org_id) — that table's
--     PK is org_id (Phase 28 schema), NOT a separate id column. (Rule 1 fix.)
--   - subscription_id is TEXT (Phase 14 stripe_subscriptions.id is text).
--   - automatic_tax_status mirrors Stripe's `automatic_tax.status` enum.
--   - Index by customer_state powers the matview in 20290104000008.
--
-- No CREATE POLICY IF NOT EXISTS ([[feedback_phase_close_out_supabase_gotchas]]).
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.tax_collection_log
-- ---------------------------------------------------------------------------

create table public.tax_collection_log (
  id                          uuid        not null default gen_random_uuid() primary key,
  subscription_id             text        references public.subscriptions(id) on delete set null,
  org_subscription_id         uuid        references public.org_subscriptions(org_id) on delete set null,
  stripe_session_id           text,
  stripe_payment_intent_id    text,
  customer_state              text,                                -- US state code (e.g. 'CA', 'TX')
  customer_postal             text,
  tax_amount_cents            integer     not null check (tax_amount_cents >= 0),
  subtotal_cents              integer     not null,
  total_cents                 integer     not null,
  tax_rate_percent            numeric(5,3),
  automatic_tax_status        text        check (automatic_tax_status in (
                                            'requires_location_inputs',
                                            'complete',
                                            'failed'
                                          )),
  created_at                  timestamptz not null default now(),
  -- Exactly-one-or-both: every row must reference at least one subscription.
  constraint tax_collection_log_sub_or_org_check
    check (subscription_id is not null or org_subscription_id is not null)
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Nexus rollup — per-state aggregation feeds the matview in 20290104000008.
create index idx_tax_collection_log_state_created_at
  on public.tax_collection_log(customer_state, created_at desc)
  where customer_state is not null;

create index idx_tax_collection_log_subscription_id
  on public.tax_collection_log(subscription_id)
  where subscription_id is not null;

create index idx_tax_collection_log_org_subscription_id
  on public.tax_collection_log(org_subscription_id)
  where org_subscription_id is not null;

create index idx_tax_collection_log_session_id
  on public.tax_collection_log(stripe_session_id)
  where stripe_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security.
-- ---------------------------------------------------------------------------

alter table public.tax_collection_log enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — bare CREATE POLICY (no IF NOT EXISTS).
-- ---------------------------------------------------------------------------

-- Service role: full read/write (webhook handler writes; nexus cron reads).
create policy "service_role_all_tax_collection_log"
  on public.tax_collection_log
  for all
  to service_role
  using (true)
  with check (true);

-- Staff: SELECT for /admin/tax nexus dashboard.
create policy "staff_select_tax_collection_log"
  on public.tax_collection_log
  for select
  to authenticated
  using (public.is_staff());

commit;
