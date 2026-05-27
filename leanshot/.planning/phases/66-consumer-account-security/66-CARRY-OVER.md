---
phase: 66
status: code-complete (remote-deploy-deferred)
audience: Phase 66.5 + Phase 70 milestone UAT operator
---

# Phase 66: Consumer Account Security — CARRY-OVER

## 1. Inherited from Phase 65 BLOCKER

`org_subscriptions` remote schema-tracking drift — Phase 65 § 1 of 65-CARRY-OVER.md must be resolved by operator (psql + `\dt` introspection + either re-create or `DELETE FROM supabase_migrations.schema_migrations`). Until resolved, Phase 65 + 66 + 66.5 migrations all blocked.

## 2. Deploy Sequence (after Phase 65 drift cleared)

1. `npx supabase db push --linked` — applies all 10 Phase 65 + 2 Phase 66 migrations.
2. `npx supabase functions deploy auth-rate-limit-check --project-ref ytnsipxxmzgaebkqmokp` + smoke `GET /healthz`.
3. Optional: register 30d retention pg_cron job for `auth_attempts_log` (defer until production traffic to size index).

## 3. UAT Flows (Phase 70 deliverables)

| Flow | Steps |
|------|-------|
| F1 — Consumer TOTP enrollment | Sign-in → `/settings/security` → "Add 2-factor" → QR + verify + backup codes download → green "On since" badge. |
| F2 — AAL2 gate (delete-account) | Settings → Danger Zone → Delete account → Aal2 modal → enter code → confirms within 15-min window. |
| F3 — AAL2 gate (change-email) | Settings → Change email → new address → Aal2 modal → success → confirmation email to new + old addresses. |
| F4 — AAL2 gate (export-all) | Settings → Export all data → Aal2 modal → success → DSAR export delivered. |
| F5 — 5-fail lockout | 5 wrong-password attempts in 15min → `<SignInLockoutBanner>` shows "Try again in 30:00 or use magic link". |
| F6 — IP-side lockout | 5 wrong-password against 5 different emails from one IP → IP-locked. |
| F7 — Brute-force PostHog | 10 failed attempts from one IP within 1h → PostHog `auth_brute_force_detected` event + Slack alert. |
| F8 — Per-role MFA toggle | `/admin/users/security` → toggle `clinic-admin: required: true` → existing clinic-admin user signs in → redirect to `/settings/security` for enrollment. |
| F9 — Status badge in admin user-detail | `/admin/users/<id>` → see badge: on / required-not-enrolled / off. |

## 4. Unfinished Wiring (mount work)

These components were shipped + tested in isolation but NOT mounted into their host pages, to avoid Wave-2 collision:

| Component | Host page to mount in |
|-----------|----------------------|
| `<DangerZone>` (delete-account CTA wrapped in AAL2) | `src/components/dashboard/settings/SettingsPage.tsx` |
| `<ChangeEmailForm>` (change-email CTA wrapped) | `SettingsPage.tsx` |
| `<SignInLockoutBanner>` | existing sign-in form (likely `src/components/auth/SignInForm.tsx`) |
| `<UserDetailPage>` route | `src/App.tsx` (`/admin/users/<id>`) |
| `signInWithLockout` wrapper | replace `supabase.auth.signInWithPassword` call sites |

This is intentional — 66-07 close-out as drafted assumed Phase 70 would do final mount. Estimated effort: ~30min, no new code.

## 5. Bigger Security Drift Surfaced (Phase 66.5 owns)

`npx supabase db advisors --linked --type security` returned **725 findings** (11 ERROR + 714 WARN). Phase 66.5 (newly inserted) addresses the 11 ERRORs + 16 mutable-search_path:

### 11 ERROR-level
- 2 views exposing `auth.users` to anon/auth (`share_snapshot_view`, `user_activity_daily`)
- 2 `SECURITY DEFINER` views (`v_cancellation_offers_roi`, `share_snapshot_view`)
- 7 public tables with RLS disabled (`email_send_counters`, `ad_spend_facts_y2026m{05,06,07,08}`, `paywall_events`, `plan_history`)

### 16 mutable search_path functions
Listed in 66-SUPABASE-ADVISORS.json (full raw report saved alongside this file).

### Deferred WARN-level (700+) → Phase 69.5
- 238 anon-SECDEF-executable + 256 authenticated-SECDEF-executable (mostly internal helpers; sample audit needed but not blocking)
- 179 anonymous-sign-in policies
- 14 matviews in API
- 4 public storage buckets
- 3 extensions in public schema (pg_net, vector, pgtap)
- 2 `rls_policy_always_true` (Phase 64 by-design anon-INSERT on `privacy_optout_requests` — confirm)
- 1 `auth_leaked_password_protection` disabled — Studio toggle, operator action
- 1 `auth_insufficient_mfa_options` — TOTP-only; WebAuthn deferred

Full report: `66-SUPABASE-ADVISORS.json` (725-entry JSON).

## 6. Auth-rate-limit-check Deno Test Resolution

Test failed locally with `Could not find a matching package for 'npm:@supabase/supabase-js@2.45.0'`. Per `[[reference_npm_install_worktree_main_drift]]` family — the test's `deno test --no-check` import resolution needs `"nodeModulesDir": "auto"` in `deno.json`. Fn deploys are unaffected. Fix in Phase 69.5 OR add to Phase 66.5 polish.

## 7. Pre-existing Test Tech Debt (NOT Phase 66 regressions)

| File | Failures | Notes |
|------|----------|-------|
| `src/lib/auth.test.ts` | 6/22 | Phase 34/59 OAuth/Apple platform-fork mocks drifted; confirmed against base `f049d4b5` |
| `src/lib/admin/palette/aal2-step-up.test.ts` | 4 | Carried from Phase 65 |
| `src/lib/admin/bulk/job-polling.test.ts` | 4 | Carried from Phase 65 |
| `src/lib/admin/modules.test.ts` | 3 | Hard-codes 18 modules, actual now 35. Carry to Phase 69.5. |
