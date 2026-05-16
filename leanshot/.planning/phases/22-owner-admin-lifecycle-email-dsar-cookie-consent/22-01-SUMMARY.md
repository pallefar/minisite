---
phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent
plan: 01
subsystem: database
tags: [postgres, supabase, rls, pg_cron, materialized-view, vault, hmac, vitest, deno, playwright]

requires:
  - phase: 07-compliance-foundations-legal-counsel-led
    provides: audit_logs schema + app.suppress_audit GUC + pending_account_deletions table
  - phase: 09-clinic-b2b-foundations
    provides: orgs + memberships + audit_logs.org_columns + action_check extension pattern
  - phase: 10-clinic-operator-surface
    provides: audit_logs.target_user_id column + audit_logs.metadata jsonb + audit_actor_type enum
  - phase: 15-page-builder-landing-pages
    provides: public.is_staff() helper + profiles.is_staff column
  - phase: 19-affiliate-program-stripe-connect
    provides: tier_effective view + service_role_key vault load pattern + click_baseline mv pattern

provides:
  - 16 P22 foundation migrations live on `ytnsipxxmzgaebkqmokp`
  - audit_logs.action CHECK extended with 11 P22 values (impersonate_*, refund_issued, etc.)
  - audit_logs.impersonator_id column + partial index
  - feature_flag_overrides table + admin_set_feature_flag_override RPC
  - consent_records table (anon-or-authenticated insert; append-only delete-deny)
  - dsar_requests table + dsar_request_status enum + admin_reject_dsar RPC
  - dsar-exports private Storage bucket + folder-scoped RLS
  - user_activity_daily materialized view + 02:00 UTC refresh cron
  - cohort_retention view (security_invoker=true, k-anonymity contract)
  - admin_list_members(p_search, p_tier, p_page, p_size) RPC
  - 51 impersonation write-deny policies (17 tables × 3 ops)
  - email_send_counters table + increment_resend_domain_unverified_skips RPC
  - cancel_account_deletion(text) HMAC-verified RPC + 7-day TTL
  - admin_log_{refund,subscription_canceled,subscription_comped} RPCs
  - feature_flag_overrides_cleanup cron @ 05:00 UTC
  - 7-day soft-delete window (30d→7d) on finalize-account-deletions cron + run-now test hook
  - 35 test scaffolds covering admin/impersonation/consent/dsar/lifecycle surfaces

affects:
  - 22-02 (admin members page + admin-api wiring)
  - 22-03 (admin stripe action edge fn)
  - 22-04 (impersonation edge fn + UI banner — A1 PROBE PASS unlocks Option A)
  - 22-05 (soft-delete UI + cancel cron e2e)
  - 22-06 (cohort retention page)
  - 22-07 (5 lifecycle email Edge Functions + shared resend-domain-health-check)
  - 22-08 (preference-update edge fn)
  - 22-09 (feature-flag overrides UI panel)
  - 22-10 (cookie consent + PostHog defer)
  - 22-11 (DSAR portal + email preferences)

tech-stack:
  added:
    - pg_cron (extension; reused) — 2 new jobs (user-activity-daily-refresh, feature-flag-overrides-cleanup)
    - pgcrypto extensions.hmac() — HS256-style HMAC token verification in cancel_account_deletion
    - dsar_request_status PostgreSQL enum
  patterns:
    - "Cross-table RLS write-deny via DO-loop + request.jwt.claims (NOT app.X GUC) — 51 policies in one migration"
    - "HMAC-verified soft-delete cancel token: <uid>.<epoch>.<hex_hmac> with Vault-stored secret"
    - "Gated-send health check pattern (D-03) backed by email_send_counters keyed counter table"
    - "Status-machine writer ownership documented inline in migration header per S6 audit"
    - "K-anonymity contract documented in view comment + enforced client-side in heatmap component"

key-files:
  created:
    - supabase/migrations/20270601000001_finalize_cron_seven_days.sql
    - supabase/migrations/20270601000002_audit_action_enum_phase22.sql
    - supabase/migrations/20270601000003_audit_logs_impersonator_cols.sql
    - supabase/migrations/20270601000004_feature_flag_overrides_table.sql
    - supabase/migrations/20270601000005_consent_records_table.sql
    - supabase/migrations/20270601000006_dsar_requests_table.sql
    - supabase/migrations/20270601000007_dsar_exports_storage_bucket.sql
    - supabase/migrations/20270601000008_user_activity_daily_matview.sql
    - supabase/migrations/20270601000009_user_activity_refresh_cron.sql
    - supabase/migrations/20270601000010_cohort_retention_view.sql
    - supabase/migrations/20270601000011_admin_list_members_rpc.sql
    - supabase/migrations/20270601000012_impersonation_write_deny_policies.sql
    - supabase/migrations/20270601000013_resend_unverified_skips_counter.sql
    - supabase/migrations/20270601000014_cancel_account_deletion_rpc.sql
    - supabase/migrations/20270601000015_admin_stripe_action_audit_rpc.sql
    - supabase/migrations/20270601000016_feature_flag_overrides_cleanup_cron.sql
    - leanshot/.planning/phases/22-owner-admin-lifecycle-email-dsar-cookie-consent/22-A1-PROBE.md
    - 13 vitest scaffolds under leanshot/src/components and leanshot/src/lib
    - 9 deno scaffolds under supabase/functions (admin-impersonate, admin-stripe-action, dsar-export, 5 lifecycle, _shared)
    - 13 e2e scaffolds under leanshot/e2e (7 RLS + 1 cron + 5 Playwright)
  modified:
    - (none — Wave 0 is foundation-only; subsequent waves modify existing files)

key-decisions:
  - "audit_logs.action is TEXT+CHECK not enum — used drop+re-add pattern from Phase 8/9/10 analogs instead of ALTER TYPE ADD VALUE; 11 new P22 values appended to whitelist"
  - "audit_logs.target_user_id already exists (Phase 10) — File 03 only added impersonator_id (DEVIATION from plan body)"
  - "A1 PROBE PASS @ 336ms — Plan 22-04 uses admin.updateUserById + generateLink, NOT Custom Access Token Hook fallback"
  - "HMAC cancel token shape: <uid>.<epoch>.<hex_hmac> (parseable in plpgsql via string_to_array; cleaner than base64url-JSON)"
  - "dsar_requests 'rejected' writer = admin_reject_dsar RPC shipped IN SAME migration (File 06) to close S6 status-machine gap up-front"
  - "feature_flag_overrides_expires_idx is a plain index on expires_at (NOT partial with now()) per Pitfall 1 IMMUTABLE rejection"
  - "Impersonation write-deny policies installed via DO-loop in one migration (File 12) — 51 policies generated from {17 tables × 3 ops} matrix; per-table existence guard for idempotency"
  - "cancel_account_deletion grants execute to anon AND authenticated — the HMAC token IS the auth; user may be signed out across devices when link clicked"

patterns-established:
  - "Status-machine writer audit (S6): every enum value gets a documented writer; admin RPC ships in same migration as table if it's the only writer for a terminal state"
  - "Vault secret presence guard via DO-block: any migration depending on a Vault secret aborts cleanly if vault.decrypted_secrets is unavailable, surfacing the dashboard step in error message"
  - "Per-file slug prefix on every RLS test file (feedback_rls_per_file_slug_prefix.md) — no shared TEST_SLUG_PREFIX across siblings; cleanup hooks scoped to the file's own prefix"
  - "DO-loop migration for cross-table RLS: enumerate target tables in array, foreach + execute format(); skip-if-not-exists guard makes it survive table renames in future phases"

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-08, DEL-01, GDPR-01, GDPR-02, GDPR-03, ON-02, ON-03]

duration: 47min
completed: 2026-05-16
---

# Phase 22 Plan 01: Wave 0 Foundation Migrations + Test Scaffolds Summary

**16 P22 foundation migrations live on `ytnsipxxmzgaebkqmokp` (30d→7d soft-delete cron + impersonation RLS + DSAR + consent + cohort matview + 51 deny-write policies) plus 35 failing test scaffolds; A1 PROBE PASS unlocks Option A impersonation in plan 22-04.**

## Performance

- **Duration:** 47 min
- **Started:** 2026-05-16T06:18Z
- **Completed:** 2026-05-16T07:05Z
- **Tasks:** 3 of 3
- **Files created:** 52 (16 migrations + 35 test scaffolds + 1 A1 probe doc)

## Accomplishments

- **30-day → 7-day soft-delete cron** rescheduled with IMMUTABLE-safe predicate form; test-hook `run_finalize_account_deletions_cron_now` body mirror-updated. Resolves Critical Conflict #2 (Phase 7 vs P22).
- **Cross-table impersonation RLS** — 51 write-deny policies installed via DO-loop migration; predicate reads `request.jwt.claims->app_metadata->impersonator_id` per Pitfall 1 (NOT `app.X` GUC).
- **A1 PROBE PASS** — empirically verified that `admin.updateUserById({app_metadata:{impersonator_id}})` propagates to the next minted JWT in 336ms. Plan 22-04 uses the planned `updateUserById` + `generateLink` flow; Custom Access Token Hook fallback NOT needed.
- **DSAR + consent + feature-flag-override foundation** — 3 tables + 2 admin RPCs + 1 storage bucket + status-machine writer audit (S6) closed in-migration.
- **Cohort retention pipeline** — user_activity_daily matview + 02:00 UTC refresh cron + cohort_retention view with k-anonymity contract documented in view comment.
- **HMAC cancel-deletion RPC** with Vault-loaded key + 7-day TTL + presence guard.
- **3 admin Stripe audit RPCs** to inline-write audit rows even when Stripe webhook lag occurs.
- **35 test scaffolds** spanning vitest (13), Deno (9), Playwright + RLS e2e (13) — every RLS file declares its own slug prefix per `feedback_rls_per_file_slug_prefix.md`.

## Task Commits

Each task was committed atomically on `main`:

1. **Task 1: 16 P22 foundation migrations** — `f15799f` (feat)
2. **Task 2: 35 test scaffolds (vitest + deno + e2e)** — `eea3017` (test)
3. **Task 3: live push + A1 PROBE doc** — `78e3e1f` (docs)

## Verification

All 5 post-push verification queries against `ytnsipxxmzgaebkqmokp`:

| Query                                              | Expected | Actual | Status |
| -------------------------------------------------- | -------- | ------ | ------ |
| 5 tables (matview/feature_flag/consent/dsar/email_counters) | 5        | 5      | PASS   |
| 3 cron jobs (finalize/user-activity/flag-cleanup)  | 3        | 3      | PASS   |
| 5 RPCs (list_members/set_flag/cancel/log_refund/inc_skips) | 5        | 5      | PASS   |
| 51 deny-write policies (17 tables × 3 ops)         | 51       | 51     | PASS   |
| dsar-exports storage bucket                        | 1        | 1      | PASS   |

`pg_get_functiondef('public.run_finalize_account_deletions_cron_now'::regproc)` contains `interval '7 days'` (count: 1) — 30d→7d migration confirmed live.

Dry-run output (`/tmp/p22-dryrun.log`) showed all 16 migrations queued with **zero** `Skipping migration` lines (Pitfall 2 sweep clean).

A1 PROBE result captured in `22-A1-PROBE.md`:
- `pass: true`
- `returned_app_metadata.impersonator_id: '00000000-0000-0000-0000-000000000001'` (matches expected sentinel)
- `latency_ms: 336`

## Decisions Made

(All extracted to frontmatter `key-decisions` for STATE.md harvest.)

The most load-bearing decisions:
1. **audit_logs.action is TEXT+CHECK, not an enum** — switched File 02 from `ALTER TYPE ADD VALUE` to the drop+re-add CHECK whitelist pattern used by Phase 8/9/10. Plan body assumed an enum; actual schema is text+CHECK.
2. **target_user_id already exists from Phase 10** — File 03 only adds `impersonator_id`. Avoided no-op re-add that could mask future schema drift.
3. **A1 PROBE PASS chooses Option A** — `admin.updateUserById` + `generateLink` is the impersonation path; no need to provision `IMPERSONATION_JWT_SIGNING_KEY` Vault secret or deploy a Custom Access Token Hook.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] File 02: audit_logs.action is TEXT+CHECK, not an enum**
- **Found during:** Task 1 (author migrations) — schema verification via grep
- **Issue:** Plan body instructed `ALTER TYPE public.audit_action_type ADD VALUE …`; the actual schema (per `20260601000001_audit_logs.sql:77-80` and three later extension migrations) uses `action text NOT NULL CHECK (action IN (…))`, NOT a Postgres enum. Running `ALTER TYPE` would have errored with "type does not exist". The PATTERNS map (line 199) flagged this: "Confirm enum name via `\dT+ public.audit_action_type` — the original `audit_logs` migration uses a CHECK constraint, not an enum type."
- **Fix:** Authored File 02 using the drop+re-add CHECK pattern established by Phase 8 (`20260701000001`), Phase 9 (`20260801000001`), and Phase 10 (`20260901000001`). Preserved all 28 prior values verbatim + appended 11 new P22 values. Per RESEARCH Pitfall 3 (sqlstate 55P04 risk), File 02 is still a separate migration before any downstream RPC consumer (File 04, 06, 14, 15).
- **Files modified:** `supabase/migrations/20270601000002_audit_action_enum_phase22.sql` (header documents the deviation inline)
- **Verification:** Live push succeeded; downstream RPCs (Files 04/06/14/15) reference the new values without error; sqlstate 55P04 did not fire because File 02 is enum-add-only / no DEFAULT or CHECK reads the new values in the same transaction.
- **Committed in:** `f15799f` (Task 1 commit)

**2. [Rule 3 - Blocking] File 03: target_user_id column already exists from Phase 10**
- **Found during:** Task 1 (author migrations) — discovered via grep of `target_user_id\|impersonator_id` across migrations
- **Issue:** Plan body instructed adding BOTH `impersonator_id` AND `target_user_id` to `audit_logs`. The `target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL` column was already added by Phase 10's `20260901000003_rank_org_patients_rpc.sql:47-49`. Re-adding with `IF NOT EXISTS` would have been a no-op (correct outcome) but would have left a misleading code-comment trail.
- **Fix:** File 03 only adds the net-new `impersonator_id` column. Header documents the deviation: "DEVIATION from plan body: target_user_id already exists from Phase 10 (20260901000003)".
- **Files modified:** `supabase/migrations/20270601000003_audit_logs_impersonator_cols.sql`
- **Verification:** `SELECT count(*) FROM information_schema.columns WHERE table_name='audit_logs' AND column_name IN ('impersonator_id','target_user_id')` returns 2 (post-migration). Audit RPCs in Files 04/06/14/15 write `target_user_id` and the inserts succeed.
- **Committed in:** `f15799f` (Task 1 commit)

**3. [Rule 2 - Missing Critical] File 06: `admin_reject_dsar` shipped in the same migration**
- **Found during:** Task 1 — applying status-machine writer audit (S6) per `feedback_status_machine_transition_owner.md`
- **Issue:** Plan body assigned `rejected` status to an "admin DSAR review surface in `/admin/members/{id}`" — but no plan in Wave 1/2/3 explicitly owns this writer. Without it, dsar_requests rows could never reach the `rejected` terminal state.
- **Fix:** Added `admin_reject_dsar(p_request_id uuid, p_reason text)` SECURITY DEFINER RPC to File 06, is_staff-gated. Per CONTEXT, this matches the regulator-audience approach (tight on regulatory artifacts, invest where end-user-facing).
- **Files modified:** `supabase/migrations/20270601000006_dsar_requests_table.sql`
- **Verification:** Live push includes `admin_reject_dsar` proc (visible via `pg_proc` if queried).
- **Committed in:** `f15799f` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 1 blocking, 1 missing-critical).
**Impact on plan:** All three deviations were structural/correctness adjustments to match the actual live schema and close S6 audit gaps. No scope creep; no functional change relative to plan intent.

## Issues Encountered

- **Verification regex over-matched comments:** Task 2's `grep -lR "it\.fixme\|test\.fixme"` against the entire `e2e/` directory returned 7 PRE-EXISTING files unrelated to Phase 22 (migrate-resume, cross-device-sync, etc.). Re-ran the grep restricted to the 26 newly-created files → 0 matches → verification passes. No file changes needed.
- **NOTICEs during File 12 push are expected:** the DO-loop's `drop policy if exists` emits one NOTICE per (table × op) → 51 NOTICE lines on first apply (and again on any future re-apply). Confirmed in `/tmp/p22-push.log`; "Finished supabase db push." on last line.

## User Setup Required

**One pending vendor pass remains** (gates Wave 1+2 dependent features but NOT this plan's completion):

- **Vault secret `CANCEL_DELETION_HMAC_KEY`** must be set via Supabase Dashboard → Project Settings → Vault → Add new secret. Used by `cancel_account_deletion(text)` RPC (File 14). Without it, the cancel-link flow raises `hmac_key_missing` exception. Plan 22-05 owner should verify presence before shipping the in-app cancel-link UI. Project memory note: mirror the BL-7 pattern from `project_phase19_pre_plan_state.md` (`service_role_key` vault load).

Otherwise: A1 PROBE PASS means **no** new vendor pass is needed for impersonation (Plan 22-04 can proceed without a Custom Access Token Hook signing key).

## Next Phase Readiness

- **Wave 1 unblocked.** All migrations live on `ytnsipxxmzgaebkqmokp`; downstream plans can rely on the new tables/policies/RPCs/cron jobs/bucket.
- **Plan 22-04 (impersonation) — Option A confirmed.** Use `admin.updateUserById` + `admin.generateLink`. No fallback wiring needed.
- **Plan 22-07 (lifecycle emails) — gated-send pattern ready.** `email_send_counters` + `increment_resend_domain_unverified_skips()` shipped. Health-check helper authoring is owned by 22-07.
- **Plan 22-05 (soft-delete UI) — cron + RPC + audit row infrastructure live.** Just needs CANCEL_DELETION_HMAC_KEY set in Vault before going live.
- **All 35 test scaffolds in place.** Wave 1+2 executors green them up as they ship the underlying modules.

## Self-Check: PASSED

All claimed artifacts verified to exist:

- 16 migration files present in `/Users/karstenhaldan/minisite/supabase/migrations/2027060100000{1..9}*.sql` + `2027060100001{0..6}*.sql` (ls count = 16).
- 35 test scaffolds present (26 in `leanshot/src/**/__tests__/` + `leanshot/e2e/`, 9 in `supabase/functions/`).
- `22-A1-PROBE.md` exists with PASS verdict.
- All 3 task commits present in `git log --oneline`: `f15799f`, `eea3017`, `78e3e1f`.
- 5 live-DB verification queries returned expected counts.

---

*Phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent*
*Completed: 2026-05-16*
