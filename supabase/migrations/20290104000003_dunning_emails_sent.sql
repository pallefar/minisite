-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-05)
-- =============================================================================
--
-- Audit + idempotency table for dunning emails. The orchestrator (Plan 65-05)
-- writes one row per (subscription, stage) tuple with ON CONFLICT DO NOTHING.
-- Composite PK (subscription_id, stage) guarantees idempotency under burst
-- retries — even if the cron fires twice in the same minute, only one email
-- is dispatched per stage per subscription.
--
-- Threat model (T-65-01-01 Tampering): Composite PK + ON CONFLICT DO NOTHING
-- in Plan 65-05 prevents duplicate-send tampering.
--
-- NOTE: public.subscriptions.id is TEXT (Phase 14 stripe_subscriptions schema)
-- — NOT uuid. subscription_id must be text to match the FK.
--
-- No CREATE POLICY IF NOT EXISTS ([[feedback_phase_close_out_supabase_gotchas]]).
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.dunning_emails_sent
-- ---------------------------------------------------------------------------

create table public.dunning_emails_sent (
  subscription_id    text        not null
                                 references public.subscriptions(id) on delete cascade,
  stage              text        not null
                                 check (stage in (
                                   'first_failed',
                                   'second_failed',
                                   'final_warning'
                                 )),
  sent_at            timestamptz not null default now(),
  resend_message_id  text,
  primary key (subscription_id, stage)
);

-- ---------------------------------------------------------------------------
-- 2. Index — staff dashboard reads newest-first.
-- ---------------------------------------------------------------------------

create index idx_dunning_emails_sent_sent_at
  on public.dunning_emails_sent(sent_at desc);

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security.
-- ---------------------------------------------------------------------------

alter table public.dunning_emails_sent enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — bare CREATE POLICY (no IF NOT EXISTS).
-- ---------------------------------------------------------------------------

-- Service role: full read/write (cron, webhook handler).
create policy "service_role_all_dunning_emails_sent"
  on public.dunning_emails_sent
  for all
  to service_role
  using (true)
  with check (true);

-- Staff: SELECT for /admin/tax dashboard.
create policy "staff_select_dunning_emails_sent"
  on public.dunning_emails_sent
  for select
  to authenticated
  using (public.is_staff());

commit;
