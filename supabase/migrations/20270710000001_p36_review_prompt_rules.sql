-- Phase 36 Plan 36-01 — REVIEW-02: review_prompt_rules table + RLS.
--
-- CONTEXT references:
--   - D-02: single-condition rules (1 trigger_event + nullable cohort_id).
--   - V13-3 BLOCKER (D-03 + D-04): native review never gated on rating; this
--     table is the rule store consumed by Edge Fn `nps-trigger-decide` (Wave 2).
--
-- RLS posture (Pattern S1 — dual-layer):
--   - All direct DML denied to authenticated.
--   - SECDEF RPCs in 20270710000005_p36_review_secdef_rpcs.sql are the only
--     write/list path; they re-check `profiles.admin_role IN ('admin','superadmin')`.
--
-- Per [[reference_supabase_migration_gotchas]]: partial-index expression must
-- be IMMUTABLE; the `active = true` predicate qualifies.
--
-- Per [[feedback_planner_iter1_anti_patterns]]: history.rule_id ON DELETE SET NULL
-- (declared in 20270710000002) preserves audit trail when admin deletes a rule.

begin;

create table if not exists public.review_prompt_rules (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(name) between 1 and 60),
  trigger_event   text not null,
  cohort_id       uuid references public.cohort_definitions(id) on delete set null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid not null references auth.users(id),
  updated_at      timestamptz not null default now()
);

comment on table public.review_prompt_rules is
  'REVIEW-02: admin-authored single-condition NPS trigger rules. Rule = '
  '(trigger_event from events.ts nps_trigger_eligible whitelist) + optional '
  'cohort_id filter. created_by stamped server-side via auth.uid() in the '
  'create SECDEF RPC (B1 — no client-supplied attribution).';

-- Partial index — only active rules participate in Edge Fn matching.
-- Per Pitfall 9 (RESEARCH.md): nps-trigger-decide MUST filter
-- WHERE active = true; this index enforces server-side query shape.
create index if not exists ix_review_prompt_rules_trigger_active
  on public.review_prompt_rules (trigger_event)
  where active = true;

create index if not exists ix_review_prompt_rules_cohort_id
  on public.review_prompt_rules (cohort_id)
  where cohort_id is not null;

alter table public.review_prompt_rules enable row level security;

-- DENY all direct DML for authenticated. SECDEF RPCs are the only writers.
-- No INSERT/UPDATE/DELETE policies — RLS default-deny applies.
-- SELECT is also blocked here — admin list path is the SECDEF list_review_prompt_rules RPC.
-- (Pattern S1 dual-layer; mirrors helpdesk_create_ticket_rpc pattern at 20270707000009.)

commit;
