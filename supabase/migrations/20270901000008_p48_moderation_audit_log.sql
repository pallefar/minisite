-- Phase 48 Plan 48-04 — moderation_audit_log: append-only moderation action audit table.
--
-- Decision refs: D-16 (mirrors Phase 25 phi_access_log immutability verbatim),
--   HIPAA-14 (right-of-accounting-of-disclosures applied to moderation actions).
-- Pattern refs: S2 (Append-only RLS), Phase 25 phi_access_log analog.
--
-- Distinction from audit_logs (Phase 24) and phi_access_log (Phase 25):
--   audit_logs       = every WRITE across PHI tables, trigger-driven (Phase 24).
--   phi_access_log   = every READ of PHI by staff/clinician, RPC-driven (Phase 25).
--   moderation_audit_log = every moderation ACTION (report_filed, mute_applied,
--     ban_applied, temp_restore, auto_flag, banned_word_match, session_revoked,
--     report_triaged), RPC-driven via log_moderation_action SECDEF (Phase 48).
--   DO NOT collapse them; each owns a distinct audit axis.
--
-- STRIDE threat register (inline; see PLAN.md <threat_model>):
--   T-48-04 Tampering/Repudiation: append-only-by-policy + service_role REVOKE
--     update/delete below ensures no row can be modified or removed after write.
--   T-48-16 Tampering: actor_id is ALWAYS sourced from auth.uid() at the RPC
--     layer (migration 20270901000009) — caller args cannot forge it. created_at
--     defaults to now() preventing backdating.
--   T-48-17 Information disclosure: SELECT policy is staff-only via
--     public.is_staff(); RLS default-deny blocks all other reads.
--
-- Negative-space tamper comment (mirror of phi_access_log.sql convention):
--   ONLY TWO WRITE PATHS EXIST:
--     (1) The `log_moderation_action` SECURITY DEFINER RPC (migration
--         20270901000009) called from every moderation surface (UI components,
--         Edge Fns, triggers, cron). actor_id is sourced from auth.uid() inside
--         the RPC body — never from an argument passed by the caller. May be
--         null for system callers (cron, service-role triggers); action_type
--         disambiguates system vs admin actions.
--     (2) service_role INSERT (for backfill or integration test fixtures).
--         service_role UPDATE and DELETE are EXPLICITLY REVOKED below.
--   There is NO direct INSERT policy for the authenticated role.
--   There is NO trigger-based write.

begin;

create table public.moderation_audit_log (
  id            bigserial   primary key,

  -- actor_id: who performed the moderation action. The FK cascade clause
  -- below preserves the audit row after a staff member's account is deleted
  -- (the action is still a fact). Nullable for system callers (claude-moderation Fn via
  -- service-role, banned_words_match trigger fired by service-role bypass,
  -- temp_suspended_restore cron). action_type disambiguates system vs admin.
  actor_id      uuid        references auth.users(id) on delete set null,

  -- action_type: free-text moderation event name. Values include 'report_filed',
  -- 'mute_applied', 'ban_applied', 'temp_restore', 'auto_flag',
  -- 'banned_word_match', 'session_revoked', 'report_triaged'. Not enum-bound
  -- because new action_types are added across the milestone; constrained by
  -- caller convention rather than DDL CHECK.
  action_type   text        not null,

  -- target_type: what kind of entity was acted upon. CHECK enforces the closed
  -- set; 'report' covers admin triage actions referencing a community_reports
  -- row.
  target_type   text        not null check (target_type in ('post','comment','dm_message','profile','user','space','banned_word','report')),

  -- target_id: the entity's UUID. Nullable for actions that don't target a
  -- specific row (e.g., bulk operations, system sweeps).
  target_id     uuid,

  -- before_state / after_state: pre/post snapshot of mutated columns (jsonb).
  -- Optional — many actions are pure events (e.g., report_filed) without state.
  before_state  jsonb,
  after_state   jsonb,

  -- reason: staff-authored free-text. Optional for system actions.
  reason        text,

  created_at    timestamptz not null default now()
);

-- Indexes for staff investigation (actor + time) and target-history queries
-- (target_type + target_id + time).
create index moderation_audit_log_actor_time_idx
  on public.moderation_audit_log (actor_id, created_at desc);

create index moderation_audit_log_target_time_idx
  on public.moderation_audit_log (target_type, target_id, created_at desc);

-- Enable RLS (default-deny for all commands not covered by an explicit policy).
alter table public.moderation_audit_log enable row level security;

-- SELECT policy: staff-only via public.is_staff() helper
-- (supabase/migrations/20261101000006_is_staff_helper.sql).
create policy mod_audit_select_staff
  on public.moderation_audit_log
  for select
  to authenticated
  using (public.is_staff());

-- NO INSERT/UPDATE/DELETE policy for authenticated role.
-- Writes flow exclusively through the log_moderation_action SECURITY DEFINER
-- RPC (migration 20270901000009). The absence of write policies IS the
-- mitigation (default-deny): any direct INSERT attempt by an authenticated
-- browser client returns 42501 insufficient_privilege.

-- service_role bypasses RLS by default. Explicitly REVOKE UPDATE and DELETE
-- from service_role so the append-only invariant holds even for privileged
-- callers (admin tooling, backfill scripts). service_role INSERT is
-- intentionally retained for test fixtures and future backfill (mirrors
-- phi_access_log precedent).
revoke update, delete on public.moderation_audit_log from service_role;

commit;
