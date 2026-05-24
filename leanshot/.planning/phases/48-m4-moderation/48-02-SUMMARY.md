---
phase: 48-m4-moderation
plan: 02
subsystem: moderation
tags: [secdef, rls, rpc, cross-org-isolation, report-flow]
dependency_graph:
  requires:
    - 48-01  # community_reports table + status CHECK widen + active dedup partial UNIQUE
    - 28     # org_members table + public.org_member_role enum (owner, clinician, staff, support_admin, support_lead)
    - 44     # community_spaces (org_id nullable), community_posts (space_id), community_comments (space_id)
    - 45     # community_reports table + initial community_reports_select policy
    - 15-01  # public.is_staff() helper
    - 48-04  # public.log_moderation_action RPC (resolved at call time; ships in same db push batch)
  provides:
    - "SECDEF helper public.can_moderate_report_org(uuid) → boolean (clinic-org cross-isolation predicate)"
    - "SECDEF RPC public.report_content(text, uuid, text) → jsonb (user-facing report entry with D-02 cooldown)"
    - "RLS SELECT policy community_reports_select_moderation (staff OR clinic-org-mod OR reporter-own)"
  affects:
    - "community_reports SELECT path widened beyond Phase 45 staff-only baseline"
    - "Plan 48-10 admin triage RPCs will rely on this RLS SELECT to surface reports to clinic-org moderators"
    - "Plan 48-07 claude-moderation Fn + Plan 48-08 banned-words trigger INSERT via service_role (RLS bypassed) — no path overlap with this plan's grants"
tech-stack:
  added:
    - "Postgres SECDEF helper pattern returning boolean for use inside RLS USING clause"
  patterns:
    - "SECDEF RPC with `revoke all from public; grant execute to authenticated` (NEVER service_role for auth.uid()-based RPCs)"
    - "catch unique_violation → re-raise with detail (Postgres atomic cooldown enforcement)"
    - "plpgsql deferred function resolution to forward-reference cross-plan RPCs in same db push batch"
    - "RLS predicate 3-way OR: platform-staff OR org-scoped-mod-helper OR row-owner"
key-files:
  created:
    - "supabase/migrations/20270901000002_p48_can_moderate_report_org_helper.sql"
    - "supabase/migrations/20270901000003_p48_report_content_rpc.sql"
    - "supabase/migrations/20270901000004_p48_community_reports_rls_update.sql"
  modified: []
decisions:
  - "D-04 CORRECTED: clinic-org moderation tier = ('owner','support_admin') — NOT 'admin' (not in enum); NOT 'staff' / 'support_lead' (out of scope per CONTEXT). Live `public.org_member_role` enum confirmed 2026-05-23 via researcher pre-check."
  - "D-02 cooldown enforced via Plan 48-01 partial UNIQUE + this plan's catch-23505 (atomic; no SELECT-then-INSERT race)."
  - "D-16 audit-row written via perform public.log_moderation_action — resolved at call time (plpgsql deferred resolution); both 48-02 and 48-04 ship in the same `supabase db push --linked` at Plan 48-12 close-out."
  - "report_content reason column shape `jsonb_build_object('source','user','text', p_reason)` mirrors D-07 system-report shapes (`{source:'claude_auto_flag', …}`, `{source:'banned_word', …}`) so admin UI renders user + system reports uniformly."
  - "No INSERT/UPDATE/DELETE policies for authenticated on community_reports — all writes flow through SECDEF RPCs (report_content here; triage/dismiss/resolve in Plan 48-10; banned-word + claude-moderation INSERT via service_role bypass)."
  - "community_spaces.org_id IS NULL (global space) returns FALSE from can_moderate_report_org — handled by public.is_staff() branch in RLS. Removes ambiguity for the 'no org' case."
  - "target_type IN ('dm_message','profile') intentionally has no UNION ALL branch in the helper — per CONTEXT D-08 DMs skip per-org mod uniformly; only platform staff (is_staff()) see DM-target reports."
metrics:
  duration_min: 12
  tasks_completed: 3
  files_created: 3
  commit_count: 3
  completed_date: 2026-05-24
---

# Phase 48 Plan 02: SECDEF helper + report_content RPC + RLS widening Summary

Shipped the SECDEF helper for cross-org isolation (D-04 CORRECTED — `org_members.role IN ('owner','support_admin')`), the SECDEF RPC `public.report_content` with D-02 cooldown catch-23505, and the `community_reports` SELECT RLS policy widening (`is_staff() OR can_moderate_report_org(id) OR reporter_user_id = auth.uid()`).

## What was built

### Task 1 — `public.can_moderate_report_org(p_report_id uuid)` helper

- **File:** `supabase/migrations/20270901000002_p48_can_moderate_report_org_helper.sql`
- **Commit:** `40176c13`
- Joins `community_reports → community_posts/community_comments (UNION ALL on target_type) → community_spaces → org_members(user_id = auth.uid())`.
- Returns `TRUE` iff caller is an `org_members` row of the resolved space's org with `role IN ('owner','support_admin')`, AND the space's `org_id IS NOT NULL`.
- `language sql`, `security definer`, `stable`, `set search_path = public, extensions`.
- Grant: `authenticated` only (consumed inside RLS USING clause; never called by service_role).

### Task 2 — `public.report_content(text, uuid, text)` RPC

- **File:** `supabase/migrations/20270901000003_p48_report_content_rpc.sql`
- **Commit:** `eca63827`
- Validates `auth.uid()` (raise 42501 unauthenticated) + `target_type IN ('post','comment','dm_message','profile')` (raise 22023).
- INSERTs into `community_reports` with `reason = jsonb_build_object('source','user','text', p_reason)`, `status = 'open'`.
- Calls `perform public.log_moderation_action(p_action_type='report_filed', …)` — resolved at call time (Plan 48-04 ships the audit RPC in same db push).
- Returns `{ report_id, status }`.
- `exception when unique_violation` (from Plan 48-01 partial UNIQUE `community_reports_active_dedup_uniq`) → re-raises as `'already_reported'` with `errcode='23505'` and `detail='You have already reported this; admin is reviewing.'`.
- Grant: `authenticated` only. **Never `service_role`** (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch` — service-role callers must INSERT into community_reports directly via the trigger / Edge Fn paths shipped in 48-07 / 48-08).

### Task 3 — `community_reports_select_moderation` RLS policy

- **File:** `supabase/migrations/20270901000004_p48_community_reports_rls_update.sql`
- **Commit:** `55d12ed6`
- DROP POLICY IF EXISTS `community_reports_select` (Phase 45's staff-only baseline); CREATE POLICY `community_reports_select_moderation` with 3-way OR predicate.
- No INSERT / UPDATE / DELETE policies — writes flow exclusively through SECDEF RPCs.

## Caller-context matrix (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`)

| Function | auth.uid() needed? | Grants | Callable from |
|---|---|---|---|
| `public.can_moderate_report_org(uuid)` | YES (helper joins `om.user_id = auth.uid()`) | `authenticated` | RLS USING clause (always authenticated user JWT context) — never directly from Edge Fn |
| `public.report_content(text, uuid, text)` | YES (writes `reporter_user_id = auth.uid()`) | `authenticated` only | Browser SPA via supabase-js RPC; user JWT REQUIRED. Edge Fn paths must NOT call this — they INSERT directly with their own actor semantics |

## Threat coverage

| Threat ID | Mitigation in this plan |
|---|---|
| T-48-01 (D, report-flood) | Plan 48-01 partial UNIQUE `community_reports_active_dedup_uniq` + this plan's `report_content` catch-23505 |
| T-48-02 (I, cross-org info disclosure) | `can_moderate_report_org` derives `org_id` from `community_spaces` (joined via target row), never from caller arg. Verified at runtime by Plan 48-06 cross-org isolation test (RED at Wave 0; GREEN at Plan 48-12 close-out after `supabase db push --linked`). |
| T-48-10 (E, SECDEF schema-shadow) | `set search_path = public, extensions` on every SECDEF function shipped here |

## Rejected alternatives (documented here only — NOT in committed SQL per `feedback_negation_grep_defeated_by_comment_string`)

- Role value `'admin'` — does not exist in live `public.org_member_role` enum (researcher live-DB pre-check 2026-05-23 confirmed enum is `owner | clinician | staff | support_admin | support_lead`).
- Parallel `staff_users` table — would duplicate Phase 15 `public.is_staff()` source of truth (`profiles.is_staff`); kept canonical helper.
- `INSERT ... ON CONFLICT DO DELETE` for cooldown — not valid Postgres syntax (per memory `reference_postgres_no_insert_on_conflict_do_delete`); used SECDEF RPC catch-23505 atomic enforcement instead.
- Granting `report_content` execute to `service_role` — service-role callers (claude-moderation Edge Fn, banned-words trigger) bypass RLS and INSERT into `community_reports` directly with their own `reason.source` discriminator (`'claude_auto_flag'` / `'banned_word'`).

## Deviations from Plan

None — all 3 task migration files match the plan's body shapes; all 14 acceptance-criteria greps pass without intervention; no scope additions.

## Known Stubs

None — every artifact ships final form. Cross-plan `log_moderation_action` reference uses plpgsql deferred resolution (resolved at call time post-`db push`), not a stub.

## Deferred Issues

None.

## Files

### Created

- `supabase/migrations/20270901000002_p48_can_moderate_report_org_helper.sql` (75 lines)
- `supabase/migrations/20270901000003_p48_report_content_rpc.sql` (100 lines)
- `supabase/migrations/20270901000004_p48_community_reports_rls_update.sql` (60 lines)

### Modified

None.

## Verification

Automated grep gates (14/14 PASS):

- `F1`: helper present, `om.role in ('owner','support_admin')` present (1), no `role='admin'` (0), no `staff_users` (0), `set search_path` present (1)
- `F2`: RPC present, `when unique_violation` (1), errcode 42501 (≥1), errcode 22023 (≥1), no `on conflict do delete` (0), `grant execute` (1), no service_role grant
- `F3`: `public.can_moderate_report_org` (1), `public.is_staff()` (1), no `staff_users` (0), no `'admin'` role string, begin/commit wrapper present

Runtime cross-org isolation proof scaffolded in Plan 48-06 (`supabase/tests/p48_cross_org_isolation.sql`): RED at Wave 0; GREEN at Plan 48-12 close-out after operator-driven `supabase db push --linked`.

## Commits

- `40176c13` — feat(48-02): can_moderate_report_org SECDEF helper (D-04 owner+support_admin)
- `eca63827` — feat(48-02): report_content SECDEF RPC with D-02 cooldown catch-23505
- `55d12ed6` — feat(48-02): community_reports SELECT RLS — staff OR org-mod OR reporter-own
- _(SUMMARY commit — appended below)_

## Self-Check: PASSED

- FOUND: supabase/migrations/20270901000002_p48_can_moderate_report_org_helper.sql
- FOUND: supabase/migrations/20270901000003_p48_report_content_rpc.sql
- FOUND: supabase/migrations/20270901000004_p48_community_reports_rls_update.sql
- FOUND: leanshot/.planning/phases/48-m4-moderation/48-02-SUMMARY.md
- FOUND commit: 40176c13 (Task 1 — helper)
- FOUND commit: eca63827 (Task 2 — RPC)
- FOUND commit: 55d12ed6 (Task 3 — RLS)
