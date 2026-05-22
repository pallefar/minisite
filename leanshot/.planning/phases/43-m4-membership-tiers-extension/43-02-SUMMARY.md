---
phase: 43-m4-membership-tiers-extension
plan: 02
subsystem: membership-tiers / pricing
tags: [supabase, rls, secdef, audit, stripe, grandfathered-pricing, member-02]
requires:
  - public.cohort_definitions (Phase 27)
  - public.is_admin_at_least (Phase 24/27)
  - public.log_admin_action (Phase 24)
  - app.suppress_audit GUC + audit trigger (Phase 24)
provides:
  - public.grandfathered_prices (table)
  - public.grandfathered_price_create(uuid, text, timestamptz, timestamptz) -> uuid
  - public.grandfathered_price_update(uuid, text, timestamptz, timestamptz) -> boolean
  - public.grandfathered_price_delete(uuid) -> boolean
affects:
  - audit_log (one row per successful RPC write via log_admin_action)
tech_stack:
  added: []
  patterns:
    - "Pattern S2 (denial-by-default writes): table has admin-read SELECT policy only; no INSERT/UPDATE/DELETE policies; SECDEF RPCs are the only mutation path"
    - "Pattern S3 (audit-suppress + explicit log): RPC sets app.suppress_audit then calls log_admin_action explicitly"
    - "FK target: cohort_definitions (Phase 36 trap avoided — NOT a generic cohorts table)"
key_files:
  created:
    - supabase/migrations/20270715000003_p43_grandfathered_prices.sql
    - supabase/migrations/20270715000004_p43_grandfathered_prices_rpcs.sql
  modified: []
decisions:
  - "effective_until on update: always overwrite (NULL is meaningful = open-ended). stripe_price_id + effective_from use COALESCE-to-existing partial-update semantics."
  - "Validation: regex ^price_[A-Za-z0-9]+$ enforced inside RPC body (mitigates T-43-02-02 tampering); cohort FK existence pre-check returns invalid_cohort_id (22023) instead of relying on FK constraint to raise."
  - "p_target_user_id = null in log_admin_action — grandfathered_prices mutations are catalog edits, not per-user actions."
metrics:
  duration: "~12 min"
  completed: 2026-05-22
  tasks: 2
  files: 2
  lines_added: 338
requirements: [MEMBER-02]
---

# Phase 43 Plan 02: Grandfathered Prices Table + Admin SECDEF RPCs Summary

Per-cohort grandfathered Stripe price overrides storage + 3 admin SECDEF write RPCs (`grandfathered_price_create / _update / _delete`) using the Phase 27 cohort_define audit-suppress pattern. Read RLS is admin-only; writes denied at the table level (Pattern S2) and only reachable via the SECDEF RPCs, each producing an audit_log entry.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Migration 03 — grandfathered_prices table + admin-read RLS | `387a32f` | supabase/migrations/20270715000003_p43_grandfathered_prices.sql |
| 2 | Migration 04 — grandfathered_price_{create,update,delete} SECDEF RPCs | `1acfc27` | supabase/migrations/20270715000004_p43_grandfathered_prices_rpcs.sql |

## What Shipped

### Migration 20270715000003 — `grandfathered_prices` table (72 lines)

Columns:
- `id uuid PK default gen_random_uuid()`
- `cohort_id uuid NOT NULL REFERENCES public.cohort_definitions(id) ON DELETE CASCADE`
- `stripe_price_id text NOT NULL`
- `effective_from timestamptz NOT NULL DEFAULT now()`
- `effective_until timestamptz` (nullable = open-ended)
- `created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `UNIQUE (cohort_id, stripe_price_id, effective_from)`
- Index `grandfathered_prices_cohort_id_idx` on `cohort_id` for resolver join path

RLS:
- `ENABLE ROW LEVEL SECURITY`
- 1 policy: `pol_grandfathered_prices_admin_read` (SELECT, `is_admin_at_least('admin')`)
- 0 write policies — Pattern S2 denial-by-default

### Migration 20270715000004 — 3 SECDEF write RPCs (266 lines)

All three functions are `language plpgsql security definer set search_path = public, extensions, pg_catalog`, with `revoke all from public` + `grant execute to authenticated`.

| RPC | Signature | Returns | Audit action_name |
|-----|-----------|---------|-------------------|
| `grandfathered_price_create` | `(p_cohort_id uuid, p_stripe_price_id text, p_effective_from timestamptz, p_effective_until timestamptz)` | `uuid` (new row id) | `grandfathered_price_created` |
| `grandfathered_price_update` | `(p_id uuid, p_stripe_price_id text, p_effective_from timestamptz, p_effective_until timestamptz)` | `boolean` | `grandfathered_price_updated` |
| `grandfathered_price_delete` | `(p_id uuid)` | `boolean` | `grandfathered_price_deleted` |

Errcodes raised across the three RPCs:
- `28000` / `not_authenticated` — `auth.uid()` is null
- `42501` / `forbidden` — caller is not admin-or-higher
- `22023` / `invalid_cohort_id` — null or row missing from `cohort_definitions` (create only)
- `22023` / `invalid_stripe_price_id` — null/empty or fails `^price_[A-Za-z0-9]+$`
- `22023` / `invalid_effective_window` — `effective_until <= effective_from`
- `P0002` / `not_found` — update/delete target row absent

Each RPC `perform set_config('app.suppress_audit', 'on', true)` before the mutation, then calls `public.log_admin_action(p_action_name, p_target_user_id => null, p_table_name => 'public.grandfathered_prices', p_row_pk, p_before, p_after)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Worktree path-leak on Task 1 Write**
- **Found during:** Task 1 staging.
- **Issue:** Initial `Write` for the Task 1 migration resolved the absolute path `/Users/karstenhaldan/minisite/supabase/migrations/...` against the main repo, not the worktree (the path-safety trap documented in the worktree branch check banner — Phase 43-01 caught this once already).
- **Fix:** `mv` the misplaced file into the worktree at `/Users/karstenhaldan/minisite/.claude/worktrees/agent-ab16398b5f1549adc/supabase/migrations/...`, then `git add` + commit succeeded. Task 2 used the worktree-prefixed absolute path on the first attempt — no recurrence.
- **Files modified:** path-only (no content change).
- **Commit:** `387a32f`

No code-level deviations. Plan executed as authored.

## Notes / Pattern Adherence

- FK target is `public.cohort_definitions(id)` (NOT a generic `cohorts` table — Phase 36 FK-target trap avoided).
- `log_admin_action` called with the full 6-arg signature (`p_action_name`, `p_target_user_id`, `p_table_name`, `p_row_pk`, `p_before`, `p_after`); `p_target_user_id = null` since these are catalog edits, not per-user actions.
- All three RPCs reuse the exact `cohort_define` shape: auth.uid → admin gate → input validation → set_config('app.suppress_audit') → DML → log_admin_action → revoke/grant.
- Migration filename regex compliant (14-digit prefix, no letter suffix); timestamps `20270715000003` + `20270715000004` are strictly greater than the prior `20270715000002` (Plan 43-01 tail) and well past the remote tail `20270709000008` per the success criteria.
- `wc -l supabase/migrations/20270715*.sql | tail -1` → 4 files (Phase 43-01's 2 + this plan's 2), matching the collision-precheck expectation in additional_context.

## Carry-Over

- `supabase db push --linked` deferred to **43-06 closeout** per the plan's `<output>` directive. No live database mutation in this plan.
- Plan 43-03 (`resolve_user_effective_price` function) will consume this table via `cohort_is_member`.
- Plan 43-05 (Admin Grandfathered Price UI) will call these RPCs from the admin surface.

## Threat Surface

No new threat flags beyond the plan's `<threat_model>` register (T-43-02-01 through T-43-02-06 — all mitigated in code per the plan).

## Self-Check: PASSED

Files verified:
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-ab16398b5f1549adc/supabase/migrations/20270715000003_p43_grandfathered_prices.sql` — FOUND (72 lines)
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-ab16398b5f1549adc/supabase/migrations/20270715000004_p43_grandfathered_prices_rpcs.sql` — FOUND (266 lines)

Commits verified:
- `387a32f` feat(43-02): grandfathered_prices table + admin-read RLS — FOUND
- `1acfc27` feat(43-02): grandfathered_price_{create,update,delete} SECDEF RPCs — FOUND

Plan-level checks:
- Both migration filenames match 14-digit regex.
- FK references `public.cohort_definitions(id)` (verified via grep).
- `log_admin_action` invoked 3× (one per RPC) with full 6-arg signature.
- 1 SELECT RLS policy, 0 write RLS policies (denial-by-default).
- `is_admin_at_least('admin'::public.admin_role)` gate present in all 3 RPCs.
- `set_config('app.suppress_audit', 'on', true)` present in all 3 RPCs.
- `revoke all from public` + `grant execute ... to authenticated` for all 3 RPCs.
