-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-04 reference data)
-- =============================================================================
--
-- Reference table mapping each US state to its economic-nexus threshold (the
-- revenue + optional transaction-count that triggers sales-tax registration).
-- Seeded inline with 12 representative states. The nexus-monitor cron (Plan
-- 65-08) joins this against the tax_nexus_state_revenue matview to compute
-- threshold-proximity %.
--
-- Threat model:
--   T-65-01-05 Tampering (accept): authenticated SELECT only; mutations gated
--     by Supabase project access (operator-controlled).
--
-- Seed-data notes:
--   - threshold_amount_cents is the gross-revenue trigger (in USD cents).
--   - threshold_period_days is either 365 (rolling 12-month) or 730 (some
--     states use trailing 24-month windows historically; none in initial
--     seed but the column accepts it).
--   - transaction_count_threshold is NULL when state uses revenue-only.
--   - States covered: CA, TX, NY, FL, WA, IL, PA, GA, NC, NJ, VA, AZ (n=12).
--
-- No CREATE POLICY IF NOT EXISTS ([[feedback_phase_close_out_supabase_gotchas]]).
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.tax_nexus_thresholds
-- ---------------------------------------------------------------------------

create table public.tax_nexus_thresholds (
  state                          text        not null primary key
                                             check (length(state) = 2),
  state_name                     text        not null,
  threshold_amount_cents         bigint      not null check (threshold_amount_cents > 0),
  threshold_period_days          integer     not null
                                             check (threshold_period_days in (365, 730)),
  transaction_count_threshold    integer,                   -- NULL = revenue-only test
  notes                          text,
  updated_at                     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Enable Row Level Security.
-- ---------------------------------------------------------------------------

alter table public.tax_nexus_thresholds enable row level security;

-- ---------------------------------------------------------------------------
-- 3. RLS Policies — bare CREATE POLICY.
-- ---------------------------------------------------------------------------

-- Service role: full read/write (operator updates via SQL; cron reads).
create policy "service_role_all_tax_nexus_thresholds"
  on public.tax_nexus_thresholds
  for all
  to service_role
  using (true)
  with check (true);

-- Authenticated: SELECT (public reference data — feeds /admin/tax UI).
create policy "auth_select_tax_nexus_thresholds"
  on public.tax_nexus_thresholds
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 4. Seed data — US economic-nexus thresholds (12 representative states).
--    Citations from each state's DOR rule (current as of 2026 ruleset).
-- ---------------------------------------------------------------------------

insert into public.tax_nexus_thresholds
  (state, state_name, threshold_amount_cents, threshold_period_days, transaction_count_threshold, notes)
values
  ('CA', 'California',     50000000000, 365, null, 'CDTFA Reg 1684.5: $500,000 gross sales in CA in current OR preceding calendar year (revenue-only).'),
  ('TX', 'Texas',          50000000000, 365, null, 'Texas Comptroller §3.286: $500,000 gross revenue in preceding 12 months (revenue-only).'),
  ('NY', 'New York',       50000000000, 365, 100,  'NY Tax §1101(b)(8)(iv): $500,000 gross revenue AND 100 sales in preceding 4 quarters (both required).'),
  ('FL', 'Florida',        10000000000, 365, null, 'FL §212.0596: $100,000 taxable remote sales in previous calendar year (revenue-only).'),
  ('WA', 'Washington',     10000000000, 365, null, 'WA RCW 82.08.052: $100,000 cumulative gross receipts in current OR prior calendar year (revenue-only, transactions threshold repealed 2020).'),
  ('IL', 'Illinois',       10000000000, 365, 200,  'IL 35 ILCS 105/2: $100,000 cumulative gross receipts OR 200 separate transactions in preceding 12 months.'),
  ('PA', 'Pennsylvania',   10000000000, 365, null, 'PA 72 P.S. §7237: $100,000 gross sales in previous 12 months (revenue-only).'),
  ('GA', 'Georgia',        10000000000, 365, 200,  'GA O.C.G.A. §48-8-2(8)(M.1): $100,000 gross revenue OR 200 retail sales in previous OR current calendar year.'),
  ('NC', 'North Carolina', 10000000000, 365, 200,  'NC G.S. §105-164.8(b): $100,000 gross sales OR 200 transactions in previous OR current calendar year.'),
  ('NJ', 'New Jersey',     10000000000, 365, 200,  'NJ N.J.S.A. 54:32B-3.5: $100,000 gross revenue OR 200 separate transactions in current OR prior calendar year.'),
  ('VA', 'Virginia',       10000000000, 365, 200,  'VA Code §58.1-612.1: $100,000 annual gross retail sales OR 200 transactions in current OR previous calendar year.'),
  ('AZ', 'Arizona',        10000000000, 365, null, 'AZ Rev Stat §42-5044: $100,000 gross sales in current OR previous calendar year (transaction threshold repealed 2021).');

commit;
