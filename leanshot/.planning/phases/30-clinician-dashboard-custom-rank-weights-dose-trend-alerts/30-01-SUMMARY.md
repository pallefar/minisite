---
phase: 30-clinician-dashboard-custom-rank-weights-dose-trend-alerts
plan: "01"
subsystem: api
tags: [deno, edge-function, resend, supabase-realtime, hmac, phi-lint, clinician-alerts]

# Dependency graph
requires:
  - phase: 30-00
    provides: "clinician_alerts + clinician_alert_deliveries tables + 4 pg_crons (including p30_clinician_alert_deliver) + ORG_SCOPED_TABLES extension"
  - phase: 29-03
    provides: "channelNameFromSecret helper in _shared/realtime.ts for HMAC channel naming"
  - phase: 29-07
    provides: "lint-stripe-phi.ts baseline + stripe-phi-keywords.json PHI keyword list"
  - phase: 28-02
    provides: "_createServiceRoleClientUnsafe + no-raw-service-role-client ESLint rule"
provides:
  - "clinician-alert-deliver-cron Edge Function: HMAC realtime broadcast + Resend PHI-free email per pending alert"
  - "PHI lint extended to scan clinician-alert-deliver-cron directory (D-18)"
  - "6 Deno tests covering vendor-gated, PHI-free template, retry semantics, delivery_failed transition, delivery log inserts, batch resilience"
affects:
  - "30-05 (phase-close plan that deploys the Edge Function via supabase functions deploy)"
  - "30-03/30-04 (UI components subscribe to org-{hmac8}-alerts channel this Fn broadcasts on)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vendor-gated startup health check pattern (RESEND_API_KEY missing -> warn + skip email, realtime still fires)"
    - "exported pure functions (buildAlertEmailPayload, runDeliverCron) for Deno test consumption without Deno.serve mocking"
    - "per-alert try/catch loop (never throws upstream) mirroring org-metered-billing-cron"
    - "D-14 append-only delivery log: 2 INSERT rows per alert (realtime + email channels)"
    - "PHI-lint scan extended to new Edge Fn directory by adding to STRIPE_PATHS array"

key-files:
  created:
    - supabase/functions/clinician-alert-deliver-cron/index.ts
    - supabase/functions/clinician-alert-deliver-cron/clinician-alert-deliver-cron.test.ts
    - supabase/functions/clinician-alert-deliver-cron/deno.json
  modified:
    - leanshot/scripts/lint-stripe-phi.ts
    - leanshot/scripts/stripe-phi-keywords.json
    - leanshot/package.json

key-decisions:
  - "Worktree forked from pre-Phase-29 commit: checked out realtime.ts, lint-stripe-phi.ts, stripe-phi-keywords.json, and package.json from main to resolve missing files — this is a standard worktree-drift recovery (no cherry-pick needed as these files had no conflicts)"
  - "Block comments mentioning PHI keywords (diagnosis, dose, mg, mcg) in JSDoc rewritten to avoid literal mentions — lint script does not strip block comments (documented v1.4 improvement)"
  - "get_realtime_secret() RPC returns text directly (not jsonb row) — extracted as string from data field"
  - "Test-stub gate (resendApiKey === 'test-stub') inherited from clinic-patient-invite pattern — CI deno tests use this to bypass real Resend fetch"
  - "listUsers({ perPage: 1000 }) used to resolve clinician emails; filtered by memberIds — simpler than per-user lookup"

patterns-established:
  - "buildAlertEmailPayload: exported pure function with exact {from,to,subject,html} shape; body-keys assertion in tests enforces no PHI metadata leakage"
  - "runDeliverCron: exported for testability, accepts admin + alerts + env params as opts object"

requirements-completed: [CLIN-03, CLIN-04]

# Metrics
duration: 8min
completed: "2026-05-18"
---

# Phase 30 Plan 01: clinician-alert-deliver-cron Edge Function + PHI Lint Extension Summary

**PHI-free clinician alert delivery via HMAC realtime broadcast + Resend email with per-alert retry state machine (D-12) and 6 Deno tests covering all delivery edge cases**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-18T05:04:39Z
- **Completed:** 2026-05-18T05:12:54Z
- **Tasks:** 2
- **Files modified:** 5 (plus 3 files checked out from main to resolve worktree drift)

## Accomplishments

- `clinician-alert-deliver-cron/index.ts`: 413-line Edge Function implementing D-01/D-02/D-12/D-13/D-14 alert delivery pipeline
- PHI lint extended to scan new directory (D-18); `npm run lint:stripe-phi` exits 0 with "OK: no PHI keywords in 5 Stripe call site directories"
- 6 Deno tests pass (6/6) covering: PHI-free template, vendor-gated, retry semantics, delivery_failed transition, delivery log inserts, batch resilience

## Deno Test Summary

All 6 tests passing (`deno test --no-check --allow-env --allow-net`):

```
ok | 6 passed | 0 failed (14ms)
```

Test coverage:
1. `PHI-free template` — exact D-02 subject (`New clinical alert — {org_name}` with em dash), single CTA anchor, no PHI keywords in body, body-keys assertion: exactly `{from, to, subject, html}`
2. `vendor-gated` — RESEND_API_KEY=null: email skipped, realtime delivery log still inserted, email delivery log inserted with `success=false, error='resend_api_key_missing'`
3. `retry_count bumps` — update called with `retry_count=1`, `last_attempt_at` set, no `status` field (still pending)
4. `delivery_failed transition` — retry_count=2 + both channels fail → update with `status='delivery_failed', retry_count=3`
5. `delivery_log inserts` — 2 inserts into `clinician_alert_deliveries` (channels: `['email', 'realtime']`), email `success=true` with test-stub
6. `per-alert try/catch` — 1 thrown error does not abort batch; all 3 alert results present; failed alert marked `ok=false`

## PHI Lint Output

```
OK: no PHI keywords in 5 Stripe call site directories.
```

Directories scanned: stripe-webhook, stripe-checkout, admin-stripe-action, org-metered-billing-cron, clinician-alert-deliver-cron (new)

## D-Decisions Satisfied

| Decision | Description | Status |
|----------|-------------|--------|
| D-02 | Email subject `New clinical alert — {org_name}` (em dash); body single CTA deep-link; no PHI | Satisfied |
| D-12 | retry_count<3 filter; per-alert try/catch; delivery_failed on 3rd failure; retry_count+last_attempt_at bumped | Satisfied |
| D-13 | Realtime broadcast via channelNameFromSecret(orgId, 'alerts', secretHex) HMAC channel | Satisfied |
| D-14 | clinician_alert_deliveries INSERT per attempt (realtime + email); append-only; success+error tracked | Satisfied |
| D-18 | lint-stripe-phi.ts STRIPE_PATHS extended with clinician-alert-deliver-cron; 0 violations | Satisfied |

## Task Commits

1. **Task 1: Build deliver-cron Edge Function + PHI lint extension** - `4c07c02` (feat)
2. **Task 2: Deno test suite** - `21c3d37` (test)

## Files Created/Modified

- `/supabase/functions/clinician-alert-deliver-cron/index.ts` — Edge Function: 413 lines, startup health check, runDeliverCron + buildAlertEmailPayload exports, realtime broadcast + Resend dispatch, retry state machine
- `/supabase/functions/clinician-alert-deliver-cron/clinician-alert-deliver-cron.test.ts` — 6 Deno.test blocks, 492 lines
- `/supabase/functions/clinician-alert-deliver-cron/deno.json` — Per-fn Deno config, test task with `--no-check --allow-env --allow-net`
- `/leanshot/scripts/lint-stripe-phi.ts` — Added clinician-alert-deliver-cron to STRIPE_PATHS array (D-18)
- `/leanshot/scripts/stripe-phi-keywords.json` — Unchanged (existing 23-keyword baseline sufficient)
- `/leanshot/package.json` — Checked out from main (lint:stripe-phi script was missing from worktree fork)

## Decisions Made

- Worktree forked from pre-Phase-29 commit (`f68f527`). Resolved by checking out missing files from main: `_shared/realtime.ts`, `leanshot/scripts/lint-stripe-phi.ts`, `leanshot/scripts/stripe-phi-keywords.json`, `leanshot/package.json`. Standard worktree-drift recovery — no cherry-pick needed (no conflicts).
- Block comment PHI keyword references (diagnosis, dose, mg, mcg) rewritten to abstract phrases to avoid triggering lint on doc comments. The lint script only strips `//` single-line comments (v1.4 improvement to strip block comments per existing TODO).
- Email recipient resolution uses `admin.auth.admin.listUsers({ perPage: 1000 })` filtered by `org_members.user_id` — simpler than per-ID lookup, sufficient for clinic scale.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Block comments containing PHI keywords triggered lint violations**
- **Found during:** Task 1 (PHI lint verification)
- **Issue:** JSDoc block comments in index.ts mentioned "diagnosis, dose, mg, mcg" (from T-30-01-01/02 security doc) — lint script does not strip `/** */` block comments
- **Fix:** Rewrote block comment lines to use abstract phrases ("PHI-stripped: no patient identifiers, clinical details, or treatment values" instead of listing specific PHI keywords)
- **Files modified:** `supabase/functions/clinician-alert-deliver-cron/index.ts`
- **Verification:** `npm run lint:stripe-phi` exits 0
- **Committed in:** `4c07c02` (Task 1 commit)

**2. [Rule 3 - Blocking] Missing files from worktree fork (pre-Phase-29 base)**
- **Found during:** Task 1 (PHI lint script execution, Deno test run)
- **Issue:** Worktree branched from `f68f527` (Phase 28) — missing: `_shared/realtime.ts`, `leanshot/scripts/lint-stripe-phi.ts`, `leanshot/scripts/stripe-phi-keywords.json`, `leanshot/package.json` (lint:stripe-phi script)
- **Fix:** `git checkout main -- <file>` for each missing file
- **Verification:** PHI lint runs; Deno test imports resolve; `npm run lint:stripe-phi` works
- **Committed in:** `4c07c02` + `21c3d37` (staged with respective task files)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 blocking issue)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Known Stubs

- **`TODO P25 close:` in `index.ts` line 25** — Direct Resend dispatch will swap to `sendEmail({phi: false, template: 'clinician_alert', ...})` from `_shared/email-router.ts` when Phase 25 Plan 25-03 ships. This is an explicit D-01 decision (intentional, documented in CONTEXT.md). The current Resend path is fully functional; the swap is a no-op rename.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None for this plan. The Edge Function is built but not deployed — Plan 30-05 (phase-close) owns `supabase functions deploy clinician-alert-deliver-cron --no-verify-jwt`.

Runtime secrets required at deploy time (already set as Function Secrets from Phase 29):
- `RESEND_API_KEY` — Resend send key
- `RESEND_FROM` — Sender address (defaults to `LeanShot <noreply@app.leanshot.app>`)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Auto-injected by Supabase Edge Function runtime

## Next Phase Readiness

- Edge Function code ready for deploy by Plan 30-05
- pg_cron `p30_clinician_alert_deliver` (every 20min HTTP POST) was already registered by Plan 30-00 — will invoke the Edge Fn once deployed
- Plans 30-02 (UI components) and 30-03/30-04 (frontend wiring) can proceed independently — they subscribe to the `org-{hmac8}-alerts` channel that this Fn broadcasts on

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes beyond what the plan's `<threat_model>` covers. The Edge Function is invoked via the existing pg_cron Bearer-token mechanism (T-30-01-03). No new threat surface introduced.

---
*Phase: 30-clinician-dashboard-custom-rank-weights-dose-trend-alerts*
*Completed: 2026-05-18*
