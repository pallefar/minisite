-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-10 / PAY-11)
-- =============================================================================
--
-- Idempotency table for trial-ending + win-back lifecycle emails. The
-- lifecycle-trial-ending (Plan 65-07) and lifecycle-win-back (Plan 65-08) Edge
-- Fns write here with ON CONFLICT DO NOTHING.
--
-- Composite PK (user_id, stage) guarantees we never send the same stage twice
-- to the same user even if cron fires repeatedly within the eligibility window.
--
-- copy_variant column captures the PostHog A/B copy variant for trial_ending_*
-- stages (analytics rollup at end of A/B window).
-- promo_code column is winback-only — the Stripe Promotion Code id minted
-- per-user with max_redemptions:1.
--
-- No CREATE POLICY IF NOT EXISTS ([[feedback_phase_close_out_supabase_gotchas]]).
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Table: public.lifecycle_emails_sent
-- ---------------------------------------------------------------------------

create table public.lifecycle_emails_sent (
  user_id            uuid        not null
                                 references auth.users(id) on delete cascade,
  stage              text        not null
                                 check (stage in (
                                   'trial_ending_t3d',
                                   'trial_ending_t1d',
                                   'winback_t30d',
                                   'winback_t60d',
                                   'winback_t90d'
                                 )),
  sent_at            timestamptz not null default now(),
  resend_message_id  text,
  copy_variant       text,        -- PostHog A/B variant (trial_ending_* only)
  promo_code         text,        -- Stripe Promotion Code id (winback_* only)
  primary key (user_id, stage)
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Stage-rollup for analytics + cron sweeps.
create index idx_lifecycle_emails_sent_stage_sent_at
  on public.lifecycle_emails_sent(stage, sent_at desc);

-- ---------------------------------------------------------------------------
-- 3. Enable Row Level Security.
-- ---------------------------------------------------------------------------

alter table public.lifecycle_emails_sent enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS Policies — bare CREATE POLICY.
-- ---------------------------------------------------------------------------

-- Service role: full read/write (lifecycle cron Fns).
create policy "service_role_all_lifecycle_emails_sent"
  on public.lifecycle_emails_sent
  for all
  to service_role
  using (true)
  with check (true);

-- Staff: SELECT for /admin/tax and lifecycle analytics.
create policy "staff_select_lifecycle_emails_sent"
  on public.lifecycle_emails_sent
  for select
  to authenticated
  using (public.is_staff());

commit;
