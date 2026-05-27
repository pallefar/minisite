---
phase: 66.5
title: Supabase Security Advisor Remediation
status: code-complete (remote-deploy-deferred)
shipped: 2026-05-27
mode: autonomous --from 65 --to 69 (mid-run insertion)
plans_completed: 3-of-3
requirements: [SEC-01, SEC-02, SEC-03]
---

# Phase 66.5: Supabase Security Advisor Remediation — SUMMARY

**Goal:** Fix the 11 ERROR-level + 16 mutable-search_path findings surfaced by `npx supabase db advisors --linked --type security` on 2026-05-27. Inserted mid-run between Phase 66 and Phase 67 per user direction; closes a security blocker before launch.

**Status:** **CODE-COMPLETE — REMOTE-DEPLOY DEFERRED.** All 3 migrations shipped to main. Remote `db push` defers until Phase 65 `org_subscriptions` schema-tracking drift is resolved by operator (psql + table existence check).

## REQ-ID Coverage

| REQ-ID | Plan | Code-Complete | Verified Post-Push |
|--------|------|---------------|---------------------|
| SEC-01 (RLS enabled on all public tables) | 66.5-01 | ✅ | ⏭ Phase 70 |
| SEC-02 (No SECURITY DEFINER views / no auth.users-exposing views) | 66.5-01 | ✅ | ⏭ Phase 70 |
| SEC-03 (All public functions have explicit search_path) | 66.5-02 | ✅ | ⏭ Phase 70 |

## Plans Shipped

| Plan | Wave | Outcome | Notes |
|------|------|---------|-------|
| 66.5-01 | 1 | 2 migrations: `20290106000001_enable_rls_7_public_tables.sql` (Task 1) + `20290106000002_security_definer_view_refactor.sql` (Task 2). | Task 1 by background executor; Task 2 inline-rescued after 529 Overloaded. See `66-5-01-SUMMARY.md`. |
| 66.5-02 | 1 | 1 migration: `20290106000003_function_search_path_fix.sql`. 16 drift-safe DO-block `ALTER FUNCTION SET search_path = public, pg_temp`. 15 trigger fns (no-arg) + `increment_rate_limit(uuid, text, timestamptz)` full sig. | Clean executor run (~6min). |
| 66.5-03 | 2 | Close-out — this SUMMARY + VERIFICATION + CARRY-OVER + ROADMAP/STATE/REQUIREMENTS flips. Inline. | autonomous:false plan; deploy items deferred to Phase 70. |

## ERROR-level Findings Addressed (11 of 11)

| Advisor | Object | Migration |
|---------|--------|-----------|
| rls_disabled_in_public ×7 | email_send_counters, ad_spend_facts_y2026m{05,06,07,08}, paywall_events, plan_history | 000001 |
| security_definer_view | v_cancellation_offers_roi | 000002 |
| security_definer_view | share_snapshot_view | 000002 |
| auth_users_exposed | share_snapshot_view | 000002 (revoke anon/auth) |
| auth_users_exposed | user_activity_daily (matview) | 000002 (revoke anon/auth) |

## WARN-level Findings (714) Deferred to Phase 69.5

Per-category triage from `66-SUPABASE-ADVISORS.json`:

| Category | Count | Phase 69.5 disposition |
|----------|-------|------------------------|
| anon_security_definer_function_executable | 238 | Per-function audit; revoke EXECUTE FROM public where not intentional. |
| authenticated_security_definer_function_executable | 256 | Per-function audit; tighten EXECUTE grants. |
| auth_allow_anonymous_sign_ins | 179 | Most by-design (cron rows, opt-out tables). Per-policy review + document. |
| function_search_path_mutable | (resolved in 66.5-02) | — |
| materialized_view_in_api | 14 | Move sensitive matviews to non-PostgREST schema OR add RLS. |
| public_bucket_allows_listing | 4 | Verify intent for event-covers / org-branding / org-logos / org-onboarding-assets. |
| extension_in_public | 3 | Move pg_net, vector, pgtap to dedicated schema (high effort; defer). |
| rls_policy_always_true | 2 | privacy_optout_requests (Phase 64 by-design). Document. |
| auth_leaked_password_protection | 1 | Studio toggle (operator). |
| auth_insufficient_mfa_options | 1 | WebAuthn deferred per Phase 66 carry-over. |

## Patterns Established

1. **DO-block drift-safe migration** — `do $$ begin alter ... exception when undefined_table/undefined_function then raise notice ... end $$` makes ALTER family migrations replayable + resilient to `migration repair` drift. New reference memory: `[[reference_postgres_do_block_drift_safe_migration]]`.

2. **`ALTER VIEW SET (security_invoker = on)` low-risk patch** — addresses both `security_definer_view` and `auth_users_exposed` advisor findings WITHOUT rewriting view SELECT bodies. Combined with `REVOKE SELECT FROM anon, authenticated` for sensitive views.

3. **CLI security audit baseline** — `npx supabase db advisors --linked --type security` is the CLI equivalent of Studio Security Advisor. Suitable for CI gate with `--fail-on error`. New reference memory: `[[reference_supabase_db_advisors_cli]]`.

4. **Inline-rescue of partial-agent failure** — when 529 Overloaded mid-execution, check `git log <worktree-branch>` for partial commits, merge them, complete remaining tasks inline. Saved ~80k tokens vs re-dispatch. Per `[[feedback_orchestrator_inline_completes_returned_executor]]`.

## What Didn't Land

- All 3 migrations un-pushed to remote (depends on Phase 65 `org_subscriptions` drift fix).
- 714 WARN-level findings (rolled to Phase 69.5).
- 35 ERROR-level lint findings from `supabase db lint --linked` (RPC bodies reference non-existent tables/functions; same drift family — operator must resolve at the table level first).
