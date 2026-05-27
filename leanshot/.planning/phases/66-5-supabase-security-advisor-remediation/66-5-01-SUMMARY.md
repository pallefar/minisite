---
phase: 66.5
plan: 1
status: complete (partial-agent + inline-rescue)
shipped: 2026-05-27
---

# Plan 66.5-01 — Supabase Security Advisor Remediation Wave 1

## Outcome

Both migrations shipped. **Task 1** completed by background executor (worktree-agent-aa68f45bb62e2513b) before a `529 Overloaded` API error mid-execution; the executor's commit landed on the worktree branch and was merged cleanly. **Task 2** was completed inline by the orchestrator after the executor failure, using a simpler `ALTER VIEW SET (security_invoker = on)` patch instead of full SELECT-body rewrites.

## Commits

| Plan task | Hash | Origin | Notes |
|-----------|------|--------|-------|
| 1 | `85fd784f` | worktree executor | 7 DO-block RLS enables + drop-and-create policies (drift-safe) |
| 2 | (inline this turn) | orchestrator | ALTER VIEW + revoke/grant on 3 views (drift-safe) |

## Files Shipped

| Path | Purpose |
|------|---------|
| `supabase/migrations/20290106000001_enable_rls_7_public_tables.sql` | 7 tables: enable RLS + deny-all-to-authenticated policy. Drift-safe via DO-blocks. |
| `supabase/migrations/20290106000002_security_definer_view_refactor.sql` | 3 views: `ALTER VIEW SET (security_invoker = on)` + revoke SELECT from anon/authenticated for the 2 auth.users-exposing views. Drift-safe via DO-blocks. |

## ERROR-level Advisor Findings Addressed (10 of 11)

| Advisor finding | Object | Migration |
|----------------|--------|-----------|
| rls_disabled_in_public | email_send_counters | 000001 |
| rls_disabled_in_public | ad_spend_facts_y2026m05 | 000001 |
| rls_disabled_in_public | ad_spend_facts_y2026m06 | 000001 |
| rls_disabled_in_public | ad_spend_facts_y2026m07 | 000001 |
| rls_disabled_in_public | ad_spend_facts_y2026m08 | 000001 |
| rls_disabled_in_public | paywall_events | 000001 |
| rls_disabled_in_public | plan_history | 000001 |
| security_definer_view | v_cancellation_offers_roi | 000002 |
| security_definer_view | share_snapshot_view | 000002 |
| auth_users_exposed | share_snapshot_view | 000002 (revoke + invoker) |
| auth_users_exposed | user_activity_daily | 000002 (revoke + invoker) |

## Deviations from Plan

1. **Task 2 inline-completed by orchestrator** — original plan task body specified rewriting view SELECTs to drop auth.users joins. After 529 mid-execution, orchestrator opted for the lower-risk `ALTER VIEW SET (security_invoker = on)` + `REVOKE SELECT FROM anon, authenticated` patch. This addresses both advisor findings (security_definer_view + auth_users_exposed) without modifying view bodies. The auth.users join is preserved because share_snapshot_view + user_activity_daily are consumed by service-role callers (Edge Fn share handler + admin RPC) that need user data.

2. **PG-version fallback** — `ALTER VIEW SET (security_invoker = on)` requires PG15+. Each DO-block catches `feature_not_supported` and emits a `notice` for operator manual action. Supabase remote is on PG15+ as of 2026 so this is unlikely to trip, but defensive against drift.

## Verify Post-Push

```bash
npx supabase db advisors --linked --type security --level error \
  | jq '[.[] | select(.name == "rls_disabled_in_public" or .name == "security_definer_view" or .name == "auth_users_exposed")] | length'
# Expected: 0
```

`db push` deferred — Phase 65 `org_subscriptions` drift must clear first.

## Lessons Captured

1. **529 Overloaded is recoverable when partial commits landed** — per `[[feedback_anthropic_529_overloaded_pre_dispatch]]` + `[[feedback_background_executor_socket_crash_recovery]]`. Check `git log <worktree-branch>` first; if Task 1 committed, merge + inline-complete remaining tasks rather than re-dispatch. Saves ~80k tokens vs full re-spawn.

2. **`ALTER VIEW SET (security_invoker = on)` is a low-risk security_definer_view fix** — avoids rewriting SELECT bodies which are likely to have subtle business logic. Combined with `REVOKE SELECT FROM anon, authenticated`, it addresses both `security_definer_view` and `auth_users_exposed` advisor findings without touching view query semantics.
