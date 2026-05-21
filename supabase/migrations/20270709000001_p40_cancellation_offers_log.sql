-- Phase 40 Plan 40-01 — POLISH-01, POLISH-02, POLISH-04
-- Append-only cancellation_offers_log ledger + RLS + defense-in-depth triggers.
--
-- Pattern: supabase/migrations/20270708000001_p35_xp_ledger.sql (EXACT analog).
-- Named dollar-quote tags ($body$) per reference_postgres_dollar_quote_nesting_in_cron_body.
-- ALL status + offer_type + reason + tenure_bucket CHECK values declared at create time
-- per feedback_planner_missed_status_enum_widening + D-37-09-1 carryover lesson.
--
-- subscriptions.id is TEXT (Stripe sub_* ID), not UUID — FK uses TEXT per 40-PATTERNS §12.
-- user_id FK uses ON DELETE SET NULL — rows survive account deletion per GDPR audit-retention
-- (xp_ledger + audit_logs precedent).
-- rule_id FK (references save_offer_rules) is deferred to end of
-- 20270709000002_p40_save_offer_rules.sql to avoid cyclic-dependency at create time.

-- ============================================================
-- TABLE: public.cancellation_offers_log
-- ============================================================

create table if not exists public.cancellation_offers_log (
  id                      uuid          primary key default gen_random_uuid(),
  user_id                 uuid          references public.profiles(id) on delete set null,
  -- NOT cascade — rows survive account deletion per GDPR audit-retention (xp_ledger precedent)
  org_id                  uuid          references public.organizations(id) on delete set null,
  subscription_id         text          references public.subscriptions(id) on delete set null,
  -- subscriptions.id is TEXT (Stripe sub_* format), not UUID — per PATTERNS §12 + Phase 40 truth
  reason                  text          not null check (reason in (
    'too_expensive',
    'not_using',
    'found_alternative',
    'health_goals_changed',
    'temporary_break',
    'service_quality_issue',
    'other'
  )),
  -- D-18: 6 reasons + Other (7 total) — ALL values declared at create time per D-37-09-1 lesson
  reason_other_text       text,
  offer_type              text          not null check (offer_type in (
    'pause',
    'discount',
    'extended_trial',
    'downgrade',
    'contact_csm',
    'none'
  )),
  -- ALL 6 offer_type values declared at create time — no later widening needed in Phase 40
  offer_config            jsonb         not null default '{}'::jsonb,
  -- offer_config is opaque jsonb; shape lives in 40-03 _shared/cancellation-types.ts (split-owner)
  cohort_snapshot         jsonb         not null default '{}'::jsonb,
  tenure_bucket           text          not null check (tenure_bucket in (
    '<30d',
    '30-180d',
    '>180d'
  )),
  -- D-01: three tenure buckets; ALL 3 declared at create time
  rule_id                 uuid,
  -- FK to save_offer_rules(id) ON DELETE SET NULL added via ALTER TABLE in 20270709000002
  -- to avoid cyclic-dependency (save_offer_rules table not yet created at this point)
  stacking_pre_clamp_pct  numeric(5,2),
  stacking_post_clamp_pct numeric(5,2),
  stacking_clamped        boolean       not null default false,
  prior_takes_count       integer       not null default 0,
  status                  text          not null default 'offered' check (status in (
    'offered',               -- decide-Fn insert (Step 2 modal shown)
    'accepted',              -- user accepted the save-offer
    'declined',              -- user declined (continued cancellation)
    'expired',               -- never-took within session (future cron sweep)
    'ineligible_lifetime_cap',  -- D-02: 2-take lifetime cap reached
    'ineligible_cooldown'       -- D-03: 12-month cooldown active
  )),
  -- ALL 6 status values declared at create time per PATTERNS §13 + D-37-09-1 lesson
  offered_at              timestamptz   not null default now(),
  taken_at                timestamptz,
  declined_at             timestamptz,
  posthog_variant_id      text,
  -- D-22: PostHog A/B variant reference for offer copy + recommendation algorithm experiments
  created_at              timestamptz   not null default now()
);

comment on table public.cancellation_offers_log is
  'Phase 40 POLISH-01/02/04 — append-only log of every save-offer decision event. '
  'Negative-space RLS (no INSERT/UPDATE/DELETE for authenticated) enforces append-only at '
  'the policy layer; raise-exception triggers are defense-in-depth. Service-role insert '
  'only; support_admin+ select. subscriptions.id FK is TEXT (Stripe sub_* format). '
  'rule_id FK to save_offer_rules added via ALTER in 20270709000002 (cyclic-dep avoidance). '
  'ALL CHECK enum values declared at table creation per D-37-09-1 lesson.';

-- ============================================================
-- INDEXES
-- ============================================================

-- Per-user offer history (primary query path in decide-Fn + ROI dashboard)
create index if not exists idx_offers_log_user
  on public.cancellation_offers_log (user_id, offered_at desc);

-- Status-filtered accepted/declined queries (ROI view aggregation)
create index if not exists idx_offers_log_status_taken
  on public.cancellation_offers_log (status, taken_at desc)
  where status in ('accepted', 'declined');

-- Cohort-snapshot GIN index for accepted offers (Bayesian take-rate priors)
create index if not exists idx_offers_log_cohort_offer
  on public.cancellation_offers_log using gin (cohort_snapshot)
  where status = 'accepted';

-- ============================================================
-- RLS: cancellation_offers_log — negative-space append-only pattern
-- NO INSERT / UPDATE / DELETE policy for `authenticated`.
-- Denial-by-default IS the append-only enforcement.
-- ============================================================

alter table public.cancellation_offers_log enable row level security;

-- Admin select: support_admin+ can read all rows for ROI dashboard + case investigation
create policy "cancellation_offers_log_select_admin"
  on public.cancellation_offers_log
  for select
  to authenticated
  using (public.is_admin_at_least('staff'::public.admin_role));

-- Explicit service_role insert (grep-able intent; service_role bypasses RLS but
-- shipping the policy makes the threat model legible in code — Phase 19 pattern)
create policy "cancellation_offers_log_service_insert"
  on public.cancellation_offers_log
  for insert
  to service_role
  with check (true);

-- NO UPDATE policy. NO DELETE policy. NO INSERT policy for `authenticated`.
-- Absence of policies = denial-by-default under RLS.

revoke insert, update, delete on public.cancellation_offers_log from authenticated;

-- ============================================================
-- DEFENSE-IN-DEPTH: append-only triggers for cancellation_offers_log
-- Even a forgotten service_role grant cannot UPDATE/DELETE rows.
-- Named tag $body$ per reference_postgres_dollar_quote_nesting_in_cron_body.
-- Mirrors _p35_xp_ledger_block_update / _block_delete (xp_ledger.sql lines 80-106).
-- ============================================================

create or replace function public._p40_cancellation_offers_log_block_update()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $body$
begin
  raise exception 'append_only_table';
end;
$body$;

create or replace function public._p40_cancellation_offers_log_block_delete()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $body$
begin
  raise exception 'append_only_table';
end;
$body$;

create trigger cancellation_offers_log_block_update
  before update on public.cancellation_offers_log
  for each row execute function public._p40_cancellation_offers_log_block_update();

create trigger cancellation_offers_log_block_delete
  before delete on public.cancellation_offers_log
  for each row execute function public._p40_cancellation_offers_log_block_delete();
