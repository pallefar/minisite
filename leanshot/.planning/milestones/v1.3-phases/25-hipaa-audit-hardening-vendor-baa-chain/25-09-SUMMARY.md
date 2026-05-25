---
phase: 25-hipaa-audit-hardening-vendor-baa-chain
plan: "09"
subsystem: compliance-ops
tags: [hipaa, baa-chain, cron, edge-functions, admin-ui, audit-logs]
dependency_graph:
  requires:
    - 25-01  # vendor_baa_chain table + subprocessor_snapshots
    - 25-03  # email-router (soft dependency; vendor-gated)
  provides:
    - nightly-baa-expiry-alerts
    - weekly-subprocessor-diff-detection
    - admin-compliance-ui
  affects:
    - audit_logs (via log_vendor_baa_event SECDEF RPC)
    - vendor_baa_chain (status transitions via SECDEF RPCs)
    - subprocessor_snapshots (weekly INSERT)
tech_stack:
  added:
    - baa-expiry-check Edge Function (Deno, cron-only, Pattern S5/S6)
    - subprocessor-diff Edge Function (Deno, cron-only, Pattern S5/S6)
    - pg_cron schedules: baa-expiry-check (06:00 UTC nightly), subprocessor-diff (07:00 UTC Mondays)
    - 3 SECDEF Postgres RPCs: vendor_baa_chain_update, vendor_baa_chain_set_expired, log_vendor_baa_event
    - AdminCompliancePage + ComplianceModule + BaaChainTable + ExpiryBanner + SubprocessorDiffFeed
  patterns:
    - Pattern S6 (vault.decrypted_secrets bearer for pg_cron)
    - Pattern S7 (SECURITY DEFINER + search_path guard on all 3 RPCs)
    - Pattern S5 (vendor-gated email via email-router)
    - Pattern S1 dual-layer (minRole=superadmin in modules.ts + SECDEF re-check in RPC)
    - Pattern S3 (PII-safe error logging in Edge Fns)
key_files:
  created:
    - supabase/migrations/20270702000008_baa_alert_cron.sql
    - supabase/migrations/20270702000009_vendor_baa_chain_update_rpc.sql
    - supabase/functions/baa-expiry-check/index.ts
    - supabase/functions/baa-expiry-check/baa-expiry-check.test.ts
    - supabase/functions/baa-expiry-check/cors.ts
    - supabase/functions/baa-expiry-check/deno.json
    - supabase/functions/subprocessor-diff/index.ts
    - supabase/functions/subprocessor-diff/subprocessor-diff.test.ts
    - supabase/functions/subprocessor-diff/cors.ts
    - supabase/functions/subprocessor-diff/deno.json
    - leanshot/src/components/admin/pages/AdminCompliancePage.tsx
    - leanshot/src/components/admin/compliance/ComplianceModule.tsx
    - leanshot/src/components/admin/compliance/BaaChainTable.tsx
    - leanshot/src/components/admin/compliance/ExpiryBanner.tsx
    - leanshot/src/components/admin/compliance/SubprocessorDiffFeed.tsx
    - leanshot/src/components/admin/compliance/__tests__/BaaChainTable.test.tsx
  modified:
    - leanshot/src/lib/admin/modules.ts (added compliance module entry)
decisions:
  - "3 SECDEF RPCs required (not 2) because Phase 24 revoked INSERT on audit_logs from service_role — cron Edge Fns need log_vendor_baa_event to write audit rows without direct INSERT"
  - "fireEvent.change used in BaaChainTable.test.tsx for date inputs (not userEvent.type) because jsdom date inputs do not accept text-key sequences"
  - "subprocessor-diff idempotency test rewrote from 'duplicate insert error' to 'same hash = skip' — cleaner test of the actual skip path (oldHash === newHash condition)"
  - "node_modules symlinked in worktree from main leanshot/node_modules to enable vitest run without npm install"
metrics:
  duration_minutes: 45
  completed_date: "2026-05-18"
  tasks_completed: 3
  tasks_checkpoint: 1
  files_created: 16
  files_modified: 1
  deno_tests: 15
  vitest_tests: 6
---

# Phase 25 Plan 25-09: BAA Expiry Cron + Subprocessor Diff + Compliance Admin UI Summary

**One-liner:** Nightly BAA expiry alerter (60/30/14/7/1-day buckets) + weekly subprocessor page diff detector + superadmin Compliance UI with edit-status modal wired to SECDEF RPC.

## What Was Built

### Task 1: pg_cron Migrations + SECDEF RPCs (commit 307e1ca)

**Migration 20270702000008** registers two pg_cron jobs via `vault.decrypted_secrets` bearer (Pattern S6 — no literal secret in SQL):
- `baa-expiry-check`: nightly at 06:00 UTC (no conflict with audit-archive at 03:00 UTC)
- `subprocessor-diff`: Monday only at 07:00 UTC

**Migration 20270702000009** creates 3 SECURITY DEFINER RPCs:

| RPC | Caller | Purpose |
|-----|--------|---------|
| `vendor_baa_chain_update(vendor, signed_at, expiry_at)` | authenticated (superadmin-gated internally) | Flip status='signed' + write audit row |
| `vendor_baa_chain_set_expired(vendor)` | service_role (cron Edge Fn) | Flip status='expired' + write audit row |
| `log_vendor_baa_event(vendor, action_name, payload)` | service_role (cron Edge Fn) | Write audit_logs row (action name allowlisted to 3 valid values) |

All 3 RPCs: `set search_path = public, extensions, pg_catalog` (Pattern S7 — RESEARCH Pitfall 5 compliance).

**audit_logs reconciliation:** Phase 24 revoked INSERT on audit_logs from `service_role`. Direct `admin.from('audit_logs').insert(...)` in Edge Fns would fail silently. All cron audit writes route through `log_vendor_baa_event` SECDEF. The `action_name` allowlist inside the RPC (`vendor_baa_expiry_warning | subprocessor_changed | subprocessor_fetch_failed`) bounds blast radius (T-25-09-E1 accept disposition).

### Task 2: Edge Functions + Deno Tests (commit 6cc9d09)

**`baa-expiry-check/index.ts`:**
- Enumerates `vendor_baa_chain` WHERE status='signed' AND baa_expiry_at IS NOT NULL
- Per vendor: computes `days_until = floor((expiry - now) / 1day)`, checks against 60/30/14/7/1 buckets
- Idempotency: SELECT count from audit_logs WHERE action='vendor_baa_expiry_warning' AND vendor AND bucket AND date — if >0, skip
- Past expiry → `vendor_baa_chain_set_expired` RPC
- Email via `email-router.sendRoutedEmail` (vendor-gated: skips gracefully if module missing or Resend key absent)
- 8 Deno tests covering auth, no-bucket, 60-day alert, idempotency, expiry-flip, email-failure, multi-vendor

**`subprocessor-diff/index.ts`:**
- 6 VENDOR_SUBPROCESSOR_URLS (Supabase, Vercel, Sentry, Anthropic, AWS SES, PostHog)
- Per vendor: fetch (30s timeout), sha256 hash, compare to latest snapshot
- HTTP error or timeout → `subprocessor_fetch_failed` audit row (T-25-09-A1: URL change = compliance signal)
- New hash → INSERT `subprocessor_snapshots` + `subprocessor_changed` audit row + email
- 7 Deno tests covering auth, unchanged, new content, 404, timeout, idempotency, vendor count

**Vendor subprocessor URLs verified 2026-05-18.** Cron will alert when any of these change.

### Task 3: Compliance Admin Module + UI (commit e76966d)

**modules.ts:** Added `compliance` module entry after i18n-overrides. `minRole: 'superadmin'`, `flagKey: 'admin.compliance.enabled'`. Uses existing `ShieldIcon` import.

**5 React files:**
- `AdminCompliancePage`: thin AdminLayout(Mode B) wrapper
- `ComplianceModule`: composes ExpiryBanner + BaaChainTable + SubprocessorDiffFeed
- `ExpiryBanner`: polls vendor_baa_chain at mount; renders red/orange/amber banner for expired / <14d / 14-29d / 30-60d; `role="status" aria-live="polite"`
- `BaaChainTable`: table of 6 vendors with status badges (color-coded by days-to-expiry); Edit button per row → modal → `vendor_baa_chain_update` RPC; `role="dialog" aria-modal="true"` on modal; `aria-label` on icon buttons
- `SubprocessorDiffFeed`: reads subprocessor_snapshots ORDER BY captured_at DESC LIMIT 20

**Tests:** 6/6 vitest tests pass; TypeScript typecheck clean (tsc -b --noEmit exits 0).

### Task 4: CHECKPOINT (human verification required)

See CHECKPOINT REACHED section. Not auto-resolved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added action_name allowlist to log_vendor_baa_event RPC**
- **Found during:** Task 1
- **Issue:** The plan showed no validation on `p_action_name`, which would allow cron Edge Fns to inject arbitrary action names into audit_logs (T-25-09-E1 is "accept" disposition but the RPC is callable by all service_role code)
- **Fix:** Added `if p_action_name not in ('vendor_baa_expiry_warning', 'subprocessor_changed', 'subprocessor_fetch_failed')` check with errcode 22023
- **Files modified:** supabase/migrations/20270702000009_vendor_baa_chain_update_rpc.sql
- **Commit:** 307e1ca

**2. [Rule 1 - Bug] Fixed subprocessor-diff idempotency test**
- **Found during:** Task 2 (Deno test run)
- **Issue:** Test 6 expected `failed=6` when insert returns duplicate error, but implementation correctly does NOT increment `failed` for duplicate errors (duplicate = idempotent). Test rewritten to test actual idempotency path (same hash in snapshot = skip)
- **Fix:** Rewrote Test 6 to use `latestSnapshot = { content_hash: sameHash }` which hits the `oldHash === newHash → skip` path correctly
- **Files modified:** supabase/functions/subprocessor-diff/subprocessor-diff.test.ts
- **Commit:** 6cc9d09

**3. [Rule 1 - Bug] Date input test fix (userEvent.type → fireEvent.change)**
- **Found during:** Task 3 (vitest run)
- **Issue:** `userEvent.type` doesn't reliably set value on `<input type="date">` in jsdom (no ISO date key sequence mapping). T5 failed with "Both signed and expiry dates are required" because expiryAt remained empty
- **Fix:** Switched to `fireEvent.change(input, { target: { value: 'YYYY-MM-DD' } })` for all date inputs in T4, T5, T6
- **Files modified:** leanshot/src/components/admin/compliance/__tests__/BaaChainTable.test.tsx
- **Commit:** e76966d

**4. [Rule 3 - Blocking] Worktree node_modules symlink**
- **Found during:** Task 3 (vitest run)
- **Issue:** Worktree's leanshot/node_modules was empty (.vite cache dirs only); vitest couldn't resolve `react/jsx-dev-runtime`
- **Fix:** Removed empty dir, created symlink: `ln -s /Users/karstenhaldan/minisite/leanshot/node_modules worktree/leanshot/node_modules`
- **Note:** Symlink is gitignored (node_modules in .gitignore); no commit needed

## Known Stubs

None. The compliance UI reads from live tables (vendor_baa_chain, subprocessor_snapshots). The 6 vendor rows seeded with `status='pending'` ARE the actual data — not placeholder text. The ExpiryBanner renders nothing when no vendor is near expiry, which is correct behavior (not a stub).

## Threat Flags

No new trust boundaries beyond those in the plan's `<threat_model>` section.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| supabase/migrations/20270702000008_baa_alert_cron.sql | FOUND |
| supabase/migrations/20270702000009_vendor_baa_chain_update_rpc.sql | FOUND |
| supabase/functions/baa-expiry-check/index.ts | FOUND |
| supabase/functions/baa-expiry-check/baa-expiry-check.test.ts | FOUND |
| supabase/functions/subprocessor-diff/index.ts | FOUND |
| supabase/functions/subprocessor-diff/subprocessor-diff.test.ts | FOUND |
| leanshot/src/components/admin/compliance/BaaChainTable.tsx | FOUND |
| leanshot/src/components/admin/compliance/ExpiryBanner.tsx | FOUND |
| leanshot/src/components/admin/compliance/SubprocessorDiffFeed.tsx | FOUND |
| leanshot/src/components/admin/compliance/ComplianceModule.tsx | FOUND |
| leanshot/src/components/admin/pages/AdminCompliancePage.tsx | FOUND |
| leanshot/src/lib/admin/modules.ts (modified) | FOUND |
| Commit 307e1ca (Task 1) | FOUND |
| Commit 6cc9d09 (Task 2) | FOUND |
| Commit e76966d (Task 3) | FOUND |
| STATE.md — unmodified | VERIFIED |
| ROADMAP.md — unmodified | VERIFIED |
| Deno tests — 8+7=15 pass | VERIFIED |
| Vitest tests — 6/6 pass | VERIFIED |
| TypeScript typecheck | CLEAN |
