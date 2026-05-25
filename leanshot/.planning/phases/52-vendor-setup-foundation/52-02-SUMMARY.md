---
phase: 52-vendor-setup-foundation
plan: "02"
subsystem: database/migrations
tags: [vendor, smoke-test, pg_cron, rls, migration]
dependency_graph:
  requires:
    - "supabase/migrations/20261101000006_is_staff_helper.sql (public.is_staff())"
    - "vault.decrypted_secrets key='service_role_key' (set during Phase 25)"
    - "vendor-smoke Edge Fn deployed (plan 52-01) — MUST precede db push"
  provides:
    - "public.vendor_smoke_status enum"
    - "public.vendor_smoke_log table with staff-only SELECT RLS"
    - "pg_cron job 'vendor-smoke-check' at 08:00 UTC daily"
  affects:
    - "admin vendor smoke dashboard (plan 52-03) reads vendor_smoke_log"
    - "vendor-smoke Edge Fn (plan 52-01) upserts into vendor_smoke_log"
tech_stack:
  added: []
  patterns:
    - "vault.decrypted_secrets bearer (no GUC literal)"
    - "named dollar-tag $cron$ to avoid $$ nesting collision"
    - "public.is_staff() RLS guard (existing helper)"
key_files:
  created:
    - supabase/migrations/20280101000001_vendor_smoke_log.sql
  modified: []
decisions:
  - "CONTEXT.md wins over REQUIREMENTS (VENDOR-11) on cron cadence: DAILY (0 8 * * *) not 6-hour. CONTEXT.md is locked decision; REQUIREMENTS prose was advisory."
  - "No client write policies on vendor_smoke_log: Edge Fn uses service_role which bypasses RLS; adding INSERT/UPDATE/DELETE policies would open unnecessary privilege surface."
  - "Named $cron$ dollar-tag used (not $$) per RESEARCH Pitfall 1 to avoid nesting collision."
  - "Forward timestamp 20280101000001 chosen to exceed remote last-applied and satisfy supabase db push."
metrics:
  duration: "~2 minutes"
  completed: "2026-05-25"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 52 Plan 02: Vendor Smoke Log Migration Summary

**One-liner:** `vendor_smoke_log` table with `vendor_smoke_status` enum, staff-SELECT RLS via `public.is_staff()`, and daily 08:00 UTC pg_cron job calling the `vendor-smoke` Edge Fn via vault service-role bearer.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | vendor_smoke_log table + enum + staff RLS | 71cb9df7 | supabase/migrations/20280101000001_vendor_smoke_log.sql |
| 2 | daily vendor-smoke-check pg_cron schedule | 71cb9df7 | (same file, appended) |

Both tasks committed in a single atomic commit (both modify the same migration file).

## What Was Built

### Migration: `supabase/migrations/20280101000001_vendor_smoke_log.sql`

1. **Enum** `public.vendor_smoke_status` — values: `ok`, `fail`, `not_configured`. Created idempotently with `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.

2. **Table** `public.vendor_smoke_log`:
   - `vendor_name text PRIMARY KEY`
   - `status public.vendor_smoke_status NOT NULL DEFAULT 'not_configured'`
   - `latency_ms integer` (nullable — null when not_configured)
   - `message text` (nullable — human-readable detail / error)
   - `checked_at timestamptz NOT NULL DEFAULT now()`

3. **RLS**: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policy `vendor_smoke_log_select_staff` for SELECT only using `public.is_staff()`. No client write policies (Fn writes via service_role, which bypasses RLS).

4. **Cron**: `cron.schedule('vendor-smoke-check', '0 8 * * *', $cron$ ... $cron$)` — named dollar-tag, vault bearer from `vault.decrypted_secrets WHERE name='service_role_key'`, 60s timeout, hardcoded URL `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/vendor-smoke`.

## Key Decision: Daily vs 6-Hour Cron

REQUIREMENTS VENDOR-11 prose says "6-hour cron" but CONTEXT.md (the authoritative locked-decision source) says "daily pg_cron schedule". CONTEXT.md wins. Cron expression is `0 8 * * *` (08:00 UTC daily). This is recorded to avoid confusion during close-out review.

## Confirmed Function URL

Project ref `ytnsipxxmzgaebkqmokp` confirmed by cross-checking `supabase/migrations/20270702000008_baa_alert_cron.sql` which uses the same base URL pattern. The `vendor-smoke` Fn URL is `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/vendor-smoke`.

## CRITICAL Deploy Ordering (Close-Out Constraint)

**The `vendor-smoke` Edge Fn (plan 52-01) MUST be deployed BEFORE running `supabase db push` for this migration.** The cron job fires within ~15 minutes of the migration being applied. If the Fn is not yet deployed, every cron invocation gets a 404. This is threat T-52-08 mitigated by close-out ordering — the close-out plan must enforce: deploy Fn first, then db push.

## Cron Slot Allocation (No Conflicts)

| Job | Schedule | Phase |
|-----|----------|-------|
| audit-archive | 0 3 * * * | Phase 24 |
| baa-expiry-check | 0 6 * * * | Phase 25 |
| subprocessor-diff | 0 7 * * 1 | Phase 25 (Mon-only) |
| traffic-rollup | 0 4 * * * | Phase 51 |
| **vendor-smoke-check** | **0 8 * * \*** | **Phase 52 (this migration)** |

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints or auth paths beyond what is documented in the plan's `<threat_model>`. All STRIDE threats addressed:

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-52-06 (info disclosure via SELECT) | RLS `USING (public.is_staff())` | Implemented |
| T-52-07 (service-role key in cron) | vault.decrypted_secrets at runtime; no literal | Implemented |
| T-52-08 (cron before Fn deployed) | Deploy ordering documented in SUMMARY + close-out | Documented |
| T-52-SC (migration tampering) | Pure SQL, existing extensions, no package installs | Accepted |

## Known Stubs

None. This is a pure SQL migration with no UI or application code.

## Self-Check: PASSED

- [x] `supabase/migrations/20280101000001_vendor_smoke_log.sql` exists in worktree
- [x] Commit 71cb9df7 exists
- [x] TABLE_OK grep gate passes
- [x] CRON_OK grep gate passes
