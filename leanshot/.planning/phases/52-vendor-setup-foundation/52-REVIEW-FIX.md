---
phase: 52-vendor-setup-foundation
fixed_at: 2026-05-25T00:00:00Z
review_path: leanshot/.planning/phases/52-vendor-setup-foundation/52-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 52: Code Review Fix Report

**Fixed at:** 2026-05-25
**Source review:** leanshot/.planning/phases/52-vendor-setup-foundation/52-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (2 Critical, 4 Warning; IN-03 skipped as accepted — see below)
- Fixed: 6 (CR-01, CR-02, WR-01, WR-02, WR-03, WR-04; plus IN-01 and IN-02 applied)
- Skipped: 0 (IN-03 accepted as intentional fail-soft design)

## Fixed Issues

### CR-01: PostHog drift-guard REQUIRED name does not match Edge Fn env vars

**Files modified:** `scripts/check-required-secrets.sh`, `leanshot/.planning/runbooks/vendor-secrets.md`
**Commit:** 92611eeb
**Applied fix:** Replaced `POSTHOG_PROJECT_KEY` in `REQUIRED_SECRETS` array with `POSTHOG_PERSONAL_API_KEY`
and `POSTHOG_PROJECT_ID` (the two names actually read by vendor-smoke posthogHandler at index.ts:313-314).
Removed `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` from `DEFERRED_ALLOWLIST`. Added clarifying
comment that `POSTHOG_PROJECT_KEY` is a separate Vite/frontend key used by variant-resolver Fn. Also
removed orphaned `FCM_SERVER_KEY` from `DEFERRED_ALLOWLIST` (WR-02 fix included in this commit since
it touched the same arrays). Updated runbook CI drift guard section to match.

---

### CR-02: Anthropic smoke probes use invalid model ID `claude-haiku-3-5`

**Files modified:** `supabase/functions/vendor-smoke/index.ts`
**Commit:** 14da48cc
**Applied fix:** Changed `model: 'claude-haiku-3-5'` to `model: 'claude-haiku-4-5-20251001'` in both
`anthropicClinicalHandler` (line 219) and `anthropicConsumerHandler` (line 250). The new model ID
matches the project allowlist in `_shared/anthropic-baa-allowlist.ts` and the pattern used by all
other Edge Fns in this project.

---

### WR-01: `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID` are dead reads in the APNs handler

**Files modified:** `supabase/functions/vendor-smoke/index.ts`
**Commit:** 627b40eb
**Applied fix:** Removed `appleTeamId` (from `APPLE_TEAM_ID`) and `bundleId` (from `APPLE_BUNDLE_ID`)
reads and their inclusion in the `notConfigured` guard. The APNs handler's JWT construction only uses
`keyId` (APNS_KEY_ID), `teamId` (APNS_TEAM_ID), and `p8Key` (APNS_P8_KEY). Note: `APPLE_TEAM_ID` and
`APPLE_BUNDLE_ID` are Vercel build-time public env vars (not Supabase secrets), so they would not
have been set in the Deno.env context regardless.

---

### WR-02: FCM_SERVER_KEY is an orphaned entry in `DEFERRED_ALLOWLIST`

**Files modified:** `scripts/check-required-secrets.sh`, `leanshot/.planning/runbooks/vendor-secrets.md`
**Commit:** 92611eeb (included in CR-01 commit — both touched the same arrays)
**Applied fix:** Removed `FCM_SERVER_KEY` from `DEFERRED_ALLOWLIST` in both the script and the runbook.
Added a comment clarifying that FCM authentication uses `PLAY_SERVICE_ACCOUNT_JSON` (OAuth2 service
account), not a legacy server key. `FCM_SERVER_KEY` is not read by any Edge Fn.

---

### WR-03: `fcmHandler` fetches `token_uri` without URL validation (SSRF)

**Files modified:** `supabase/functions/vendor-smoke/index.ts`
**Commit:** d0db910d
**Applied fix:** Added validation that `tokenUri` starts with `https://oauth2.googleapis.com/` before
the OAuth2 fetch. On mismatch, returns `{ status: 'fail', latency_ms: null, message: 'invalid_token_uri' }`.
The validation is placed after `tokenUri` is assigned and before `clientEmail`/`privateKey` check.

---

### WR-04: Dashboard issues data fetch before staff-check resolves

**Files modified:** `leanshot/src/components/admin/AdminVendorSmokeDashboard.tsx`
**Commit:** 3567b0ae
**Applied fix:** Changed the data-fetch `useEffect` from `[], []` (fire on mount) to `[isStaff]`
dependency with `if (isStaff === true)` guard. The fetch now only fires once the staff check
confirms authorization, eliminating the redundant RLS-blocked query on non-staff visits.

---

### IN-01 + IN-02: CI paths filter and mktemp for stderr temp file

**Files modified:** `.github/workflows/vendor-secrets-drift.yml`, `scripts/check-required-secrets.sh`
**Commit:** 2d1bb41f
**Applied fix (IN-01):** Added `supabase/functions/vendor-smoke/index.ts` to the workflow `paths:`
filter for both push and pull_request triggers, so the drift guard CI job fires when new env var
reads are added to the Edge Fn.
**Applied fix (IN-02):** Replaced fixed `/tmp/supabase_secrets_err` path with `mktemp`-generated
temp file in `discover_supabase_secrets()`. Added `rm -f` cleanup in both the error and success
branches to prevent temp file leaks.

---

## Accepted Info Findings

### IN-03: `upsert` failure is invisible in the HTTP response body

**File:** `supabase/functions/vendor-smoke/index.ts:660-672`
**Reason:** Accepted as intentional fail-soft design. The function's fail-soft contract intentionally
masks upsert failures from callers — the vendor probe results are still valid even if persistence failed.
Adding `db_write_ok` would change the API response contract and would require test updates. This can
be addressed in a future observability pass if stale dashboard data becomes a production issue.

---

## Verification Results

All three required post-fix checks passed:

1. `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` — exit 0 (no errors)
2. `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/vendor-smoke/index.test.ts` — 6/6 passed
3. `bash scripts/check-required-secrets.sh` — RESULT: pass (exit 0)

---

_Fixed: 2026-05-25_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
