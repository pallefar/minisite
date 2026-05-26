---
phase: 64-legal-refresh
plan: "01"
subsystem: database
tags: [postgres, rls, supabase, migrations, privacy, ccpa, dsar, gdpr-analog]

# Dependency graph
requires:
  - phase: 62-research-publishing
    provides: "20290102* migration head + is_staff() helper pattern"
  - phase: 61-protocol-engine
    provides: "public.is_staff() SECDEF helper function"
provides:
  - "privacy_optout_requests table — Do-Not-Sell opt-out persistence with auth-optional INSERT RLS"
  - "policy_notice_log table — grandfathered-email idempotency log (user_id PK for ON CONFLICT DO NOTHING)"
  - "ad_targeting_exclusion table — ad-network opt-out list with auth + anon partial unique indexes"
  - "email_lifecycle_exclusion table — email-lifecycle opt-out list with dual partial unique indexes"
  - "data_rights_requests table — state-flavor DSAR log with CA/VA/CO/CT/UT/OTHER + 7 request_type values"
affects:
  - "64-02-privacy-optout-fn — fan-out INSERTs into privacy_optout_requests + ad_targeting_exclusion + email_lifecycle_exclusion"
  - "64-03-grandfathered-notice-fn — INSERT INTO policy_notice_log ON CONFLICT (user_id) DO NOTHING"
  - "64-06-dsar-state-extension — INSERT INTO data_rights_requests with state_residency + request_type"
  - "64-08-close-out — npx supabase db push applies 5 migrations in sequence"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "20290103* migration timestamps — Phase 64 successor to Phase 62 head (20290102000010)"
    - "Partial unique indexes for dual-path (auth + anon) idempotency"
    - "BEGIN/COMMIT transaction wrapping for atomic migration apply"
    - "DROP IF EXISTS + bare CREATE POLICY (no IF NOT EXISTS) — remote PG compatibility"
    - "Surrogate id PK + partial unique indexes for nullable FK columns"

key-files:
  created:
    - supabase/migrations/20290103000001_privacy_optout_requests.sql
    - supabase/migrations/20290103000002_policy_notice_log.sql
    - supabase/migrations/20290103000003_ad_targeting_exclusion.sql
    - supabase/migrations/20290103000004_email_lifecycle_exclusion.sql
    - supabase/migrations/20290103000005_data_rights_requests.sql
  modified: []

key-decisions:
  - "user_id nullable on privacy_optout_requests — Do-Not-Sell is auth-optional (UI-SPEC §2)"
  - "policy_notice_log uses user_id as PK (not surrogate) — enables ON CONFLICT (user_id) DO NOTHING for idempotent send"
  - "ad_targeting_exclusion: surrogate id PK + partial unique index on (user_id where not null) + (email where user_id is null) — supports both auth + anon opt-out paths"
  - "email_lifecycle_exclusion: same dual partial unique index pattern as ad_targeting_exclusion"
  - "data_rights_requests: user_id not null (DSAR portal is auth-required per UI-SPEC §3) + staff-only UPDATE"

patterns-established:
  - "Dual partial unique indexes for auth+anon paths: idx ON table(user_id) WHERE user_id IS NOT NULL + idx ON table(email) WHERE user_id IS NULL"
  - "Staff-only RLS for internal telemetry tables (policy_notice_log, ad_targeting_exclusion, email_lifecycle_exclusion)"
  - "Auth-optional INSERT RLS: separate anon + authenticated INSERT policies (privacy_optout_requests)"

requirements-completed: [LEGAL-02, LEGAL-03, LEGAL-04, LEGAL-09]

# Metrics
duration: 3min
completed: 2026-05-26
---

# Phase 64 Plan 01: DB Schema Summary

**Five Postgres tables for Phase 64 legal-refresh data flows: Do-Not-Sell opt-out log, grandfathered-email idempotency log, ad-network exclusion list, email-lifecycle exclusion list, and state-flavor DSAR request log — all with RLS + indexes**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-26T20:45:15Z
- **Completed:** 2026-05-26T20:48:11Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `privacy_optout_requests` with auth-optional INSERT RLS (anonymous + authenticated can submit Do-Not-Sell), email/user_id indexes, and staff-only UPDATE for propagated_at
- Created `policy_notice_log` with user_id as PK for idempotent `ON CONFLICT (user_id) DO NOTHING` grandfathered-notice send
- Created `ad_targeting_exclusion` and `email_lifecycle_exclusion` with dual partial unique indexes supporting both authenticated (user_id-keyed) and anonymous (email-keyed) opt-out paths
- Created `data_rights_requests` with full state-residency CHECK (CA/VA/CO/CT/UT/OTHER) + 7-value request_type enum covering all five state law flavors (CCPA, CDPA, CPA, CTDPA, UCPA) + status workflow + staff-only UPDATE

## Task Commits

1. **Task 1: privacy_optout_requests + policy_notice_log + ad_targeting_exclusion + email_lifecycle_exclusion** - `ee03d900` (feat)
2. **Task 2: data_rights_requests with state-flavor enum + RLS** - `1e9f1588` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `supabase/migrations/20290103000001_privacy_optout_requests.sql` — Do-Not-Sell opt-out log; auth-optional INSERT; staff SELECT+UPDATE; CHECK on state_residency + opt_out_scope
- `supabase/migrations/20290103000002_policy_notice_log.sql` — Grandfathered-notice idempotency log; PK=user_id; staff-only access
- `supabase/migrations/20290103000003_ad_targeting_exclusion.sql` — Ad-network exclusion list; surrogate PK; partial unique indexes for auth+anon paths; staff-only RLS
- `supabase/migrations/20290103000004_email_lifecycle_exclusion.sql` — Email-lifecycle exclusion list; dual partial unique indexes; staff-only RLS
- `supabase/migrations/20290103000005_data_rights_requests.sql` — DSAR state-flavor log; state_residency CHECK (6 values); request_type CHECK (7 values); auth INSERT own rows; staff UPDATE

## Decisions Made

- **policy_notice_log uses user_id as PK** rather than surrogate id — enables the idempotent `INSERT … ON CONFLICT (user_id) DO NOTHING` pattern required by Plan 64-03 grandfathered-notice Fn
- **ad_targeting_exclusion: surrogate PK approach** — original design had user_id as PK but plan requires nullable user_id for anon opt-outs; used surrogate id + two partial unique indexes instead
- **email_lifecycle_exclusion: same dual partial unique index pattern** — mirrors ad_targeting_exclusion for consistency; Postgres doesn't support coalesce() in PRIMARY KEY directly
- **data_rights_requests: user_id NOT NULL** — DSAR portal is auth-required (UI-SPEC §3), unlike Do-Not-Sell which is auth-optional

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ad_targeting_exclusion: surrogate PK substituted for user_id PK**
- **Found during:** Task 1 (ad_targeting_exclusion migration)
- **Issue:** Plan specified `user_id uuid PK` but also required nullable user_id for anonymous opt-outs. A PRIMARY KEY column cannot be NULL in Postgres. The plan's own description contains both constraints in conflict.
- **Fix:** Created table with user_id as initial PK, then dropped it within the same transaction and added surrogate `id uuid PK default gen_random_uuid()` + partial unique index on user_id (where not null) + partial unique index on email (where user_id is null)
- **Files modified:** supabase/migrations/20290103000003_ad_targeting_exclusion.sql
- **Verification:** Both auth and anon paths have uniqueness enforcement; Edge Fn 64-02 can insert with user_id=null or user_id=<uuid>
- **Committed in:** ee03d900 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug — conflicting PK constraint in plan spec)
**Impact on plan:** Required change to satisfy both plan requirements simultaneously (nullable user_id + uniqueness). No scope creep. Downstream Fn 64-02 references remain unchanged.

## Issues Encountered

None — plan executed as designed except for the ad_targeting_exclusion PK conflict which was auto-resolved inline.

## User Setup Required

None — no external service configuration required. Plan 64-08 owns the `npx supabase db push --linked` apply step.

## Known Stubs

None — all five tables are fully defined with constraints, indexes, and RLS policies. No placeholder values or TODO markers in any migration file.

## Threat Surface Scan

No new network endpoints introduced. All tables operate within the existing Supabase RLS + is_staff() trust boundary. New anonymous INSERT surface on `privacy_optout_requests` is explicitly modeled in the plan's threat register (T-64-01-01, T-64-01-02, T-64-01-05) and mitigated via CHECK constraints + Plan 64-02 rate-limiting + confirmation email round-trip.

## Next Phase Readiness

- All five tables are ready for consumption by Plans 64-02, 64-03, and 64-06
- Plan 64-02 (`privacy-optout-process` Fn) can fan-out INSERTs into `privacy_optout_requests`, `ad_targeting_exclusion`, `email_lifecycle_exclusion` using service-role bypass
- Plan 64-03 (`grandfathered-policy-notice` Fn) can INSERT into `policy_notice_log` with ON CONFLICT (user_id) DO NOTHING
- Plan 64-06 (DSAR portal state-flavor extension) can INSERT into `data_rights_requests` with auth.uid() user_id
- Plan 64-08 close-out applies all 5 migrations in sequence via `npx supabase db push --linked`

---
*Phase: 64-legal-refresh*
*Completed: 2026-05-26*

## Self-Check: PASSED

Files verified:
- FOUND: supabase/migrations/20290103000001_privacy_optout_requests.sql
- FOUND: supabase/migrations/20290103000002_policy_notice_log.sql
- FOUND: supabase/migrations/20290103000003_ad_targeting_exclusion.sql
- FOUND: supabase/migrations/20290103000004_email_lifecycle_exclusion.sql
- FOUND: supabase/migrations/20290103000005_data_rights_requests.sql

Commits verified:
- ee03d900: feat(64-01): add privacy opt-out, policy notice log, and ad/email exclusion tables
- 1e9f1588: feat(64-01): add data_rights_requests table with state-flavor DSAR request log
