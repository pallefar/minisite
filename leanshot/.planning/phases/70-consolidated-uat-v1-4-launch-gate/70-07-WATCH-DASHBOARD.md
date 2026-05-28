# 70-07 — 48h Regression Watch Dashboard

**Status:** BASELINE OPEN (window not yet 48h-elapsed)
**Phase:** 70 — Consolidated UAT — v1.4 Launch Gate
**Plan:** 70-07 — Regression Watch

## Code freeze

- **Freeze SHA:** `81448cd7` (https://github.com/pallefar/minisite/commit/81448cd7)
- **Freeze commit:** `fix(70-07): regenerate package-lock.json (add markdown-it@14.x deps)`
- **Freeze timestamp (UTC):** 2026-05-28T20:09:58Z
- **Expected window end (freeze + 48h):** 2026-05-30T20:09:58Z
- **Predecessor freeze attempted at:** `3a29838b` (2026-05-27T09:23+02) — failed to open due to CI RED root cause (lockfile drift); fix above clears the blocker.

## Hour 0 snapshot (baseline-attempt + push)

### CI workflows

| Workflow | State | Notes |
|----------|-------|-------|
| CI | 🔴 RED at h0 (post-Sentry-fix) | Two install-level blockers cleared (lockfile drift in `81448cd7`, sentry sibling-check in `146f5898` pinning @sentry/react to 10.43.0). npm ci now succeeds; Typecheck + Compliance grep pass. **6 deeper chronic failures surfaced**: Lint, Format check, Unused exports check, Share security drill (SC#3), Deno tests, Unit tests (73 fail / 1692 pass — mostly AI eval/refusal corpus `kanon-*` + `borderline-*`). All confirmed pre-existing (NOT caused by Sentry downgrade — local vitest reproduces same failures). Cascading-drift pattern per [[feedback_cascading_drift_discovery_pattern]] — Budget 3-5 cascades. Carry forward as **multi-issue launch-blocker stack** |
| Sentry DSN check | ✅ GREEN | h0 success |
| Design system check | ✅ GREEN | h0 success |
| Mobile Privacy Manifest Audit | 🔴 RED | new failure at `81448cd7`; not investigated yet |
| mobile-ios | 🔴 failed (instant) | chronic — config issue independent of lockfile; not launch-blocking (build verification only) |
| mobile-android | 🔴 failed (instant) | chronic — same |
| eval-phase60 | 🟡 not triggered by this push | nightly cron only |
| Phase 38 eval — nightly | 🟡 not triggered | nightly cron only; LLM eval (orthogonal) |

### Edge Fn /healthz

**10/10 ✓** at h0 (the 10 Phase 69.7-deployed Fns):
- grandfathered-policy-notice ✓
- privacy-optout-process ✓
- request-refund ✓
- stripe-dunning-orchestrator ✓
- lifecycle-trial-ending ✓
- nexus-monitor ✓
- auth-rate-limit-check ✓
- bs-status-poller ✓
- demo-org-purge ✓
- lifecycle-win-back ✓

(False-alarm 7/10 from initial baseline-probe was a `\r\n` corruption in `.env.local` SUPABASE_ANON_KEY extraction; cleaned-ANON probe confirms 10/10. Documented in `evidence/regression-watch/S05-edge-fn-healthz-10-of-10/h0-snapshot.txt`.)

### Sentry P1

🟡 Not probed at h0 — needs Sentry API token. Operator-required to capture each snapshot. Carry forward.

### PostHog funnel-break alert

🟡 Not probed at h0 — funnel-break alert (Phase 67 deliverable) state unverified. Need to confirm via PostHog MCP. Carry forward.

### Better Stack uptime

🔴 Blocked at h0 — `BETTER_STACK_API_KEY` not set (Plan 70-01 S12 still pending operator signup). bs-status-poller healthz returns 200 but stub data. Gate cannot fire green until S12 lands.

### Lighthouse mobile

🟡 Not probed at h0 — defer to h24 + h48 per plan; production frontend (`https://leanshot.app`) confirmed responding 200.

## Hour 6 / 12 / 18 / 24 / 30 / 36 / 42 / 48 snapshots

(operator pastes ~6h snapshots here as the watch progresses)

## Incidents

(operator logs any P1 / regression here; any incident resets timer to that commit per CONTEXT Area 4)

## Notes

- This is a BASELINE-only opening of the watch window. The 48h elapse requires real wall-clock time + continuous operator monitoring.
- Plan 08 final-signoff cannot issue GO until this dashboard shows "Window closed at <UTC> with all gates GREEN".
- Mobile-ios + mobile-android workflow failures are PRE-EXISTING and treated as non-launch-blocking (build verification of Capacitor shells; runtime mobile UAT is Plans 70-04 + 70-05).
