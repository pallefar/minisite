---
phase: 66
title: Consumer Account Security
status: code-complete (remote-deploy-deferred)
shipped: 2026-05-27
mode: autonomous --from 65 --to 69 (compressed-planner)
plans_completed: 6-of-7 (close-out inline)
requirements: [AUTH-12, AUTH-13, AUTH-14, AUTH-15, AUTH-17]
---

# Phase 66: Consumer Account Security — SUMMARY

**Goal:** Ship consumer-facing MFA / TOTP self-serve + per-IP/per-email sign-in lockout with brute-force PostHog alerting. Closes research HD1 + HD2.

**Status:** **CODE-COMPLETE — REMOTE-DEPLOY DEFERRED TO PHASE 70.** All 6 implementation plans shipped to main; remote `db push` + `auth-rate-limit-check` Fn deploy deferred (same operator-gate pattern as Phase 65). Plan 66-07 close-out Tasks 1-2 (auto) executed inline; Task 3 (planning artifacts) is this document set.

## REQ-ID Coverage

| REQ-ID | Plan | Code-Complete | Deployed |
|--------|------|---------------|----------|
| AUTH-12 (Consumer MFA self-serve at /settings/security) | 66-03 | ✅ | ⏭ Phase 70 |
| AUTH-13 (AAL2 step-up on delete/export/change-email) | 66-04 | ✅ | ⏭ Phase 70 |
| AUTH-14 (5-fail / 15min sign-in lockout) | 66-05 | ✅ | ⏭ Phase 70 |
| AUTH-15 (Brute-force PostHog + Slack alerts) | 66-05 | ✅ | ⏭ Phase 70 |
| AUTH-16 (Cookie banner CPRA security clause) | n/a | ✅ (Phase 64 LEGAL-07) | ✅ |
| AUTH-17 (Admin per-role MFA-required + status badge) | 66-06 | ✅ | ⏭ Phase 70 |

## Plans Shipped

| Plan | Wave | Outcome | Tests |
|------|------|---------|-------|
| 66-01 | 1 | 2 schema migrations: `auth_attempts_log` (lockout + brute-force audit; outcome enum + 3 indexes + service-role-only RLS) + `mfa_role_requirements` (5-role seed + `set_mfa_role_requirement` SECDEF RPC superadmin-gated). | n/a (SQL) |
| 66-02 | 1 | Shared lib `src/lib/auth/`: `totp-shared.ts` + `backup-codes-shared.ts` + `aal2-consumer.ts`. `src/lib/admin/totp.ts` becomes 32-LOC re-export shim. **Self-detected & recovered** main-checkout edit (per [[feedback_worktree_executor_self_detected_main_leak]]). | 24/24 |
| 66-03 | 2 | `<TotpEnrollFlow mode>` extracted; admin SetupTotpPage 282→33 lines as thin wrapper. `<SecuritySettingsPage>` at `/settings/security`. | 24/24 |
| 66-04 | 2 | `<Aal2ChallengeModal>` 3-purpose union + wrap delete-account / change-email / export-all CTAs in `requireAal2ForConsumerAction`. `<DangerZone>` and `<ChangeEmailForm>` shipped (mount wiring deferred to UAT). D-02 honored: `mfa_not_enabled` does NOT block. | 9/9 modal |
| 66-05 | 2 | `auth-rate-limit-check` Edge Fn (handler/index split, service-role bearer, PostHog + Slack alerts at brute-force thresholds). Client `signInWithLockout` wrapper + `<SignInLockoutBanner>` countdown. **Self-detected & recovered** worktree-path leak (second occurrence). | 9 Deno + 10 vitest |
| 66-06 | 2 | `<RoleMfaRequirementTable>` + `role-mfa-config.ts` lib + `<MfaStatusBadge>` 3-state. ADMIN_MODULES manifest 34→35 (key `users-security`). `<UserDetailPage>` standalone scaffold (route wiring deferred). | 20 |

**Total tests:** 96 Phase-66-new (all green) + 8/8 admin TOTP regression-still-green via shim.

## Patterns Established

1. **Shared auth lib at `src/lib/auth/`** — admin AND consumer surfaces import the same TOTP + AAL2 + backup-codes helpers. Future surfaces (e.g. clinic-admin in Phase 70) reuse trivially.
2. **3-purpose AAL2 modal union** — `'delete-account' | 'export-all-data' | 'change-email'` keeps copy specific without bloating the component API.
3. **Per-IP AND per-email lockout** — independent windows; successful sign-in clears email's failure window.
4. **Per-role MFA-required (superadmin-only mutation)** — `set_mfa_role_requirement` SECDEF RPC enforces role check.
5. **`mode='admin'|'consumer'` flow components** — Phase 25 SetupTotpPage refactor proves this pattern; copy diverges via prop, behavior unchanged.

## Notable Self-Recovery Wins

Two executors (66-02 + 66-05) **independently** caught absolute-path drift to the main checkout via `git status` BEFORE commit, reverted via `git checkout --`, and re-applied correctly in the worktree. No leak landed. New memory `[[feedback_worktree_executor_self_detected_main_leak]]` codifies the recovery loop.

## What Didn't Land (See CARRY-OVER)

- 2 migrations un-pushed to remote (blocked by same `org_subscriptions` drift Phase 65 hit + new `auth_attempts_log` 30d retention cron).
- `auth-rate-limit-check` Edge Fn un-deployed.
- `<DangerZone>` / `<ChangeEmailForm>` not mounted into `SettingsPage.tsx`.
- `<UserDetailPage>` scaffold un-routed.
- `<SignInLockoutBanner>` not yet wired into existing sign-in form (executor scoped it out per Wave-2 isolation).
- Auth-rate-limit-check Deno test fails locally on `@supabase/supabase-js` npm resolution (deno.json config issue; deploy unaffected).
- Pre-existing 6 failures in `src/lib/auth.test.ts` (vintage Phase 34/59 tests; mock surface drifted). Carried to Phase 69.5.
