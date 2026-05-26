-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-08)
-- =============================================================================
--
-- Audit table for every Stripe refund issued via the request-refund Edge Fn
-- (Plan 65-06). Surrogate UUID PK (NOT composite) because stripe_refund_id can
-- repeat across retries (Stripe occasionally re-emits the same refund id during
-- webhook delivery storms) and we want INSERT-on-retry to fail UNIQUE rather
-- than silently merge rows ([[reference_dual_auth_submission_table_pk_pattern]]).
--
-- Eligibility window column records WHY the refund was allowed (FTC ROSCA
-- compliance: within trial OR 14-day money-back).
--
-- Threat model:
--   T-65-01-02 Information Disclosure: RLS SELECT-own via subscriptions.user_id.
--   T-65-01-04 Repudiation: created_at + updated_at + stripe_refund_id UNIQUE
--     + eligibility_window records WHY refund was allowed.
--
-- NOTE: public.subscriptions.id is TEXT (Phase 14 schema). subscription_id is text.
--
-- No CREATE POLICY IF NOT EXISTS ([[feedback_phase_close_out_supabase_gotchas]]).
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.refunds
-- ---------------------------------------------------------------------------

create table public.refunds (
  id                        uuid        not null default gen_random_uuid() primary key,
  subscription_id           text        not null
                                        references public.subscriptions(id) on delete cascade,
  stripe_refund_id          text        not null unique,
  stripe_payment_intent_id  text        not null,
  amount_cents              integer     not null check (amount_cents >= 0),
  currency                  text        not null default 'usd',
  status                    text        not null
                                        check (status in (
                                          'pending',
                                          'succeeded',
                                          'failed',
                                          'canceled'
                                        )),
  reason                    text,
  eligibility_window        text        not null
                                        check (eligibility_window in (
                                          'trial',
                                          'money_back_14d'
                                        )),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

create index idx_refunds_subscription_id
  on public.refunds(subscription_id);

create index idx_refunds_created_at
  on public.refunds(created_at desc);

create index idx_refunds_status
  on public.refunds(status)
  where status in ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security.
-- ---------------------------------------------------------------------------

alter table public.refunds enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — bare CREATE POLICY.
-- ---------------------------------------------------------------------------

-- Service role: full read/write (request-refund Fn, Stripe webhook).
create policy "service_role_all_refunds"
  on public.refunds
  for all
  to service_role
  using (true)
  with check (true);

-- Authenticated user: SELECT own refunds via subscription ownership.
-- T-65-01-02: other users cannot read another user's refunds.
create policy "auth_select_own_refunds"
  on public.refunds
  for select
  to authenticated
  using (
    auth.uid() = (
      select user_id
      from public.subscriptions
      where id = refunds.subscription_id
    )
  );

-- Staff: SELECT all for /admin/tax + support dashboards.
create policy "staff_select_refunds"
  on public.refunds
  for select
  to authenticated
  using (public.is_staff());

commit;
