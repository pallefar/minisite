---
phase: 34-m2-onboarding-overhaul-activation-event
plan: 01
subsystem: schema-foundation
tags: [postgres, rls, secdef, migration, onboarding, activation]
dependency_graph:
  requires:
    - 20270705000013_phase38_plan_personalize_facts_fn.sql (activation_events shell)
    - 20270601400005_p31_04_org_onboarding_flows.sql (_validate_onboarding_steps allowlist)
    - 20270601000029_log_admin_action_function.sql (audit logging)
    - public.profiles.admin_role (Phase 24)
  provides:
    - public.anonymous_sessions (table + deny-all RLS + partial TTL index)
    - public.onboarding_flows (table + partial unique active index + deny-all RLS)
    - public.save_consumer_onboarding_flow(jsonb) (SECDEF, superadmin-gated)
    - public._validate_onboarding_steps(jsonb) (widened: Phase 31 + Phase 34 D-16 step types)
    - public.profiles.primary_goal (column + 8-goal CHECK)
    - public.activation_events extended columns (goal_type/action_type/window_days/source)
    - public.activation_events RLS + user-self-read policy
  affects:
    - 34-02 (create-anon-session Edge Fn — reads/writes anonymous_sessions)
    - 34-03 (record-activation Edge Fn — writes activation_events via service-role)
    - 34-05 (merge-anon-session Edge Fn — service-role reads/deletes anonymous_sessions)
    - 34-06 (consumer onboarding renderer — SELECTs onboarding_flows where is_active)
    - 34-08 (step builder admin module — calls save_consumer_onboarding_flow)
    - 34-09 (Ship-Winner Edge Fn — reads activation_events)
tech_stack:
  added: []
  patterns:
    - "to_regclass guard around CREATE TABLE (re-runnable + satisfies plan substring contract)"
    - "DO-block + pg_policies check for idempotent CREATE POLICY"
    - "Phase 31 org pattern mirrored, stripped of org_id, gate swapped to admin_role='superadmin'"
    - "CHECK constraint shipped in same migration as column (per [[feedback_planner_missed_status_enum_widening]])"
key_files:
  created:
    - supabase/migrations/20270706000001_p34_anonymous_sessions.sql
    - supabase/migrations/20270706000002_p34_onboarding_flows_consumer.sql
    - supabase/migrations/20270706000003_p34_profiles_primary_goal.sql
    - supabase/migrations/20270706000004_p34_activation_events_alter.sql
  modified: []
decisions:
  - "save_consumer_onboarding_flow uses the FULL canonical log_admin_action signature (6 args, named params), not the 2-arg form Phase 31 used. Caller is a superadmin, so the is_admin_at_least('staff') gate inside log_admin_action passes."
  - "_validate_onboarding_steps allowlist UNIONs the Phase 31 org step types with the Phase 34 D-16 consumer step types in one create-or-replace, so both org and consumer SECDEFs keep validating against this same function."
  - "anonymous_sessions has ZERO permissive RLS policies (deny-all). Service-role bypass is the sole access path; the create-anon-session and merge-anon-session Edge Fns own this table."
  - "Seed an empty active flow row (config=[], version=1) so Plan 34-06's hook returns a deterministic shape before the admin authors a real flow via the step builder."
metrics:
  duration: "3m54s"
  completed_date: "2026-05-20T13:01:22Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 0
  commits: 2
---

# Phase 34 Plan 01: Schema Foundation Summary

**One-liner:** Postgres schema foundation for Phase 34 consumer onboarding — `anonymous_sessions` (cookie-keyed pre-signup), consumer `onboarding_flows` mirroring Phase 31 org pattern with superadmin gate, `profiles.primary_goal` 8-goal catalog, and ALTER on the Phase 38 `activation_events` shell with goal/action metadata.

## What Shipped

Four idempotent migration files under `supabase/migrations/`:

| File | Purpose |
|------|---------|
| `20270706000001_p34_anonymous_sessions.sql` | Cookie-keyed pre-signup table; deny-all RLS; partial TTL index on unmerged rows |
| `20270706000002_p34_onboarding_flows_consumer.sql` | Versioned consumer flow table; `save_consumer_onboarding_flow` SECDEF (superadmin-gated, advisory-locked); widened `_validate_onboarding_steps`; seed control flow row |
| `20270706000003_p34_profiles_primary_goal.sql` | `profiles.primary_goal text` column + 8-goal CHECK |
| `20270706000004_p34_activation_events_alter.sql` | ALTER (not CREATE) of Phase 38 shell: adds goal_type/action_type/window_days/source + goal_type CHECK + user-self-read RLS policy |

## SECDEF Signatures Available to Downstream Plans

```sql
-- Plan 34-08 step builder admin module calls this:
public.save_consumer_onboarding_flow(p_steps jsonb) returns uuid
  -- gates: auth.uid() not null + profiles.admin_role = 'superadmin'
  -- side effects: advisory_xact_lock + version bump + atomic active flip
  --              + log_admin_action('consumer_onboarding_flow.save', ...)
  -- raises: 42501 forbidden_not_authenticated | forbidden_not_superadmin
  --         P0001 INVALID_STEPS_NOT_ARRAY | UNKNOWN_STEP_TYPE
  -- returns: new flow id (uuid)

-- Validator called by both save_org_onboarding_flow and save_consumer_onboarding_flow:
public._validate_onboarding_steps(p_steps jsonb) returns void
  -- allowlist: Phase 31 org types (welcome, intro_card, medication, goals,
  --            body_stats, consent, doctor_invite, tour) UNION Phase 34 D-16
  --            consumer types (text, single-select, multi-select, scale,
  --            weight, date, nps, custom-component)
```

## Threat-Model Mitigations

| Threat ID | Component | Mitigation Landed |
|-----------|-----------|-------------------|
| T-34-01-01 | anonymous_sessions Spoofing | `cookie_id` will be server-generated UUID (Plan 34-02); deny-all RLS means guessing grants no anon-role DB access |
| T-34-01-02 | anonymous_sessions Information Disclosure | Force RLS + zero permissive policies; service-role is sole access path |
| T-34-01-03 | save_consumer_onboarding_flow EoP | Body checks `admin_role = 'superadmin'`; advisory lock prevents concurrent version increments |
| T-34-01-04 | onboarding_flows Tampering | INSERT/UPDATE/DELETE deny-all; partial unique on `is_active` makes "two active flows" structurally impossible |
| T-34-01-05 | activation_events Information Disclosure | User-self-read policy (`user_id = auth.uid()`); writes via service-role |
| T-34-01-06 | save_consumer_onboarding_flow Repudiation | `log_admin_action('consumer_onboarding_flow.save', ...)` audit row on every save |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used canonical full-signature `log_admin_action(...)` instead of mirroring the Phase 31 2-arg call**

- **Found during:** Task 1 (`save_consumer_onboarding_flow` body)
- **Issue:** The plan instructs to "mirror columns from `save_org_onboarding_flow` audit insert exactly". Phase 31's `save_org_onboarding_flow` calls `log_admin_action(action_name, jsonb_build_object(...))` (2 positional args). However, the only existing overload — `log_admin_action(text, uuid, text, text, jsonb, jsonb)` — does NOT match that call. Migration `20270601700001_p31_07_log_org_action_helper.sql` explicitly documents this as a known P31 bug (commit comment line 4–5) and patches the org SECDEFs to use `log_org_action` instead.
- **Fix:** Used the canonical full signature with named parameters: `perform public.log_admin_action(p_action_name=>'consumer_onboarding_flow.save', p_target_user_id=>null, p_table_name=>'onboarding_flows', p_row_pk=>v_new_id::text, p_before=>null, p_after=>jsonb_build_object('flow_id', v_new_id, 'version', v_next_version))`. Wrapped in BEGIN/EXCEPTION (mirroring `20260519000010_rag_admin_rpcs.sql:58-71`) so a missing function does not abort the SECDEF transaction. Superadmin caller passes the `is_admin_at_least('staff')` gate inside `log_admin_action`.
- **Files modified:** `supabase/migrations/20270706000002_p34_onboarding_flows_consumer.sql`
- **Commit:** `866f20d`

**2. [Rule 3 - Blocking] Wrapped `CREATE TABLE` in `to_regclass` guards to satisfy both re-runnable AND plan substring contracts**

- **Found during:** Task 1 (verify step)
- **Issue:** The plan instructs migrations be "re-runnable" (suggesting `create table if not exists`) AND the automated check + threat-model artifact contracts require the literal substring `create table public.anonymous_sessions` / `create table public.onboarding_flows` to appear. `create table if not exists public.X` does NOT contain the required substring.
- **Fix:** Wrapped each CREATE TABLE in `do $$ begin if to_regclass('public.X') is null then create table public.X (...); end if; end$$;` — gives both bare `create table public.X` substring AND idempotency. Pattern already in use in `20270601300100_p31_00_enum_rename_and_secdef_ripple.sql`.
- **Files modified:** `supabase/migrations/20270706000001_p34_anonymous_sessions.sql`, `supabase/migrations/20270706000002_p34_onboarding_flows_consumer.sql`
- **Commit:** `866f20d`

**3. [Rule 3 - Blocking] Removed forbidden substring from comment in activation_events ALTER migration**

- **Found during:** Task 2 (verify step)
- **Issue:** A comment line documenting Pitfall 6 contained the literal substring `create table public.activation_events`, which the case-insensitive automated check flags as a Pitfall 6 violation.
- **Fix:** Rewrote the comment to describe the constraint without using the forbidden phrase.
- **Files modified:** `supabase/migrations/20270706000004_p34_activation_events_alter.sql`
- **Commit:** `8aea65d`

No architectural deviations (no Rule 4 events).

## Verification

Plan-level automated checks (Task 1 and Task 2 `<verify><automated>` blocks) both pass:

```
$ node -e "..." # Task 1 verify
schema migrations OK

$ node -e "..." # Task 2 verify
activation_events ALTER OK
```

DB push deferred to milestone close per plan instructions (Wave 1 schema migrations push together).

## Commits

| Hash | Task | Message |
|------|------|---------|
| `866f20d` | Task 1 | feat(34-01): anonymous_sessions + onboarding_flows (consumer) + profiles.primary_goal |
| `8aea65d` | Task 2 | feat(34-01): ALTER activation_events with goal/action metadata + user-self-read RLS |

## Known Stubs

None. All four migrations ship complete schema + RLS + SECDEFs.

## Deferred Issues

None.

## Self-Check: PASSED

- [x] `supabase/migrations/20270706000001_p34_anonymous_sessions.sql` exists
- [x] `supabase/migrations/20270706000002_p34_onboarding_flows_consumer.sql` exists
- [x] `supabase/migrations/20270706000003_p34_profiles_primary_goal.sql` exists
- [x] `supabase/migrations/20270706000004_p34_activation_events_alter.sql` exists
- [x] Commit `866f20d` exists on worktree branch
- [x] Commit `8aea65d` exists on worktree branch
- [x] All Task `<verify><automated>` checks pass
- [x] No timestamp collision with Phase 38's `20270705*` series
- [x] `activation_events` ALTER-only (no CREATE TABLE pattern present)
