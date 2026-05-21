-- Phase 40 Plan 40-01 — POLISH-01, POLISH-04
-- save_offer_rules: admin-edited offer rule catalog table + RLS.
-- Deferred FK: adds p40_offers_rule_fk constraint to cancellation_offers_log
-- (resolves cyclic-dependency: cancellation_offers_log was created in 20270709000001).
--
-- Pattern: supabase/migrations/20270602000010_cohort_definitions.sql (admin-only table + RLS).
-- SECDEF write RPCs live in Plan 40-05 (20270709000005).
-- Named dollar-quote tags ($body$) per reference_postgres_dollar_quote_nesting_in_cron_body.
-- ALL offer_type + org_type CHECK values declared at create time per D-37-09-1 lesson.

-- ============================================================
-- TABLE: public.save_offer_rules
-- ============================================================

create table if not exists public.save_offer_rules (
  id               uuid          primary key default gen_random_uuid(),
  title            text          not null,
  cohort_id        uuid          references public.cohort_definitions(id) on delete cascade,
  -- cohort deletion cascades to remove matching rules (orphan-rule prevention)
  tenure_buckets   text[]        not null default '{}',
  -- subset of {'<30d','30-180d','>180d'}; empty array = match any tenure
  reasons          text[]        not null default '{}',
  -- subset of 7 reason codes from D-18; empty array = match any reason
  org_type         text          not null default 'any' check (org_type in (
    'any',
    'consumer',
    'clinic'
  )),
  -- D-04: clinic-org sees different offer set; ALL 3 values declared at create time
  offer_type       text          not null check (offer_type in (
    'pause',
    'discount',
    'extended_trial',
    'downgrade',
    'contact_csm'
  )),
  -- ALL 5 offer_type values declared at create time per D-37-09-1 lesson
  -- Note: 'none' is NOT in save_offer_rules offer_type (it only appears in
  -- cancellation_offers_log when no rule matched; rules always have a concrete offer_type)
  pause_months     integer       check (pause_months in (1, 2, 3)),
  -- D-06: 1/2/3-month pause presets only
  coupon_id        text,
  -- references Stripe coupon ID from seeded catalog (e.g. 'SAVE-25-3MO') — D-12
  extension_days   integer       check (extension_days in (7, 14, 30)),
  downgrade_target text,
  -- 'price_monthly' canonical — D-04 annual→monthly downgrade path
  priority         integer       not null default 100,
  -- D-13: admin-assigned priority; lower number = higher priority (ORDER BY priority ASC)
  active           boolean       not null default false,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),
  created_by       uuid          references public.profiles(user_id) on delete set null
);

comment on table public.save_offer_rules is
  'Phase 40 POLISH-01/04 — admin-edited offer rule catalog. Each rule maps a cohort × '
  'tenure × reason combination to a concrete offer_type. Writes flow through SECDEF RPCs '
  'only (Plan 40-05); authenticated users have no direct INSERT/UPDATE/DELETE. '
  'cancellation-decide-offer Edge Fn reads directly with service-role (no auth.uid() path). '
  'ALL CHECK enum values declared at table creation per D-37-09-1 lesson.';

comment on column public.save_offer_rules.tenure_buckets is
  'Subset of {''<30d'', ''30-180d'', ''>180d''}; empty array means match any tenure bucket.';

comment on column public.save_offer_rules.reasons is
  'Subset of the 7 D-18 reason codes; empty array means match any cancellation reason.';

comment on column public.save_offer_rules.priority is
  'Lower number = higher priority. cancellation-decide-offer queries ORDER BY priority ASC LIMIT 1.';

-- ============================================================
-- INDEXES
-- ============================================================

-- Active rules ordered by priority (primary query path in cancellation-decide-offer)
create index if not exists idx_rules_active_priority
  on public.save_offer_rules (priority)
  where active = true;

-- Active rules by cohort (secondary filter in rule resolution)
create index if not exists idx_rules_cohort
  on public.save_offer_rules (cohort_id)
  where active = true;

-- ============================================================
-- RLS: save_offer_rules — admin-readable; writes via SECDEF RPCs only
-- ============================================================

alter table public.save_offer_rules enable row level security;

-- SELECT policy: any support_admin+ can list rules (needed for admin UI)
create policy "save_offer_rules_select_admin"
  on public.save_offer_rules
  for select
  to authenticated
  using (public.is_admin_at_least('support_admin'::public.admin_role));

-- NO insert/update/delete policies — denial-by-default under RLS.
-- All writes flow through 40-05 SECDEF RPCs (save_offer_rule_create,
-- save_offer_rule_update, save_offer_rule_archive, save_offer_rule_activate).

revoke insert, update, delete on public.save_offer_rules from authenticated;

-- ============================================================
-- updated_at trigger (mirrors cohort_definitions pattern)
-- Named dollar-quote tag $body$ — NEVER bare $$ per project convention.
-- ============================================================

create or replace function public.save_offer_rules_updated_at()
returns trigger
language plpgsql
as $body$
begin
  new.updated_at := now();
  return new;
end;
$body$;

drop trigger if exists save_offer_rules_set_updated_at on public.save_offer_rules;
create trigger save_offer_rules_set_updated_at
  before update on public.save_offer_rules
  for each row
  execute function public.save_offer_rules_updated_at();

-- ============================================================
-- DEFERRED FK: resolve cyclic dependency from 20270709000001
-- cancellation_offers_log.rule_id → save_offer_rules(id)
-- (declared as plain uuid column in 20270709000001 to avoid FK-before-table-exists error)
-- ============================================================

alter table public.cancellation_offers_log
  add constraint p40_offers_rule_fk
  foreign key (rule_id)
  references public.save_offer_rules(id)
  on delete set null;
