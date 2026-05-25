---
phase: 30-clinician-dashboard-custom-rank-weights-dose-trend-alerts
plan: "03"
subsystem: ui
tags: [react, supabase, realtime, hmac, tailwind, framer-motion, accessibility, vitest]

requires:
  - phase: 30-00
    provides: "clinician_alerts table + acknowledge_clinician_alert + snooze_clinician_alert SECDEFs"
  - phase: 28-04
    provides: "channelNameFor HMAC channel helper (org-realtime.ts) + org-{hmac8}-{suffix} channel pattern"

provides:
  - "ClinicianAlertsPanel: bell-icon dropdown with pending/snoozed/resolved alerts + ack/snooze actions + realtime subscription"
  - "AlertSnoozePopover: role=dialog focus-trap with 4 preset durations (1h/4h/24h/7d)"
  - "use-clinician-alerts: query hook for clinician_alerts + profiles join"
  - "use-clinician-alerts-realtime: HMAC channel subscription (org-{hmac8}-alerts) via channelNameFor"
  - "Badge tone='amber' variant (--color-amber #e0af4e, distinct from tone='warning' orange)"
  - "ClinicContextBar: bell button + pending count badge + lazy ClinicianAlertsPanel mount"

affects:
  - "30-05 phase-close bundle verification (clinic chunk ceiling 45 kB)"
  - "30-04 ClinicDashboardOverview (shares clinician_alerts query pattern)"
  - "Any plan reading ClinicContextBar or Badge.tsx"

tech-stack:
  added: []
  patterns:
    - "HMAC realtime channel subscription with isSubscribed failure state (no throw on CHANNEL_ERROR)"
    - "React.lazy + Suspense for heavy clinic-route components (alerts panel deferred)"
    - "statusToTone() function for pending=amber, snoozed=neutral, ack=success, failed=danger"
    - "AlertRow component pattern: pending rows with amber-soft background + action buttons"
    - "Focus trap pattern mirroring ScoreBreakdownPopover (Escape + Tab cycle + return focus to trigger)"
    - "aria-live polite wrapping badge count for screen reader announcements"

key-files:
  created:
    - "leanshot/src/components/clinic/alerts/ClinicianAlertsPanel.tsx"
    - "leanshot/src/components/clinic/alerts/AlertSnoozePopover.tsx"
    - "leanshot/src/components/clinic/alerts/use-clinician-alerts.ts"
    - "leanshot/src/components/clinic/alerts/use-clinician-alerts-realtime.ts"
    - "leanshot/src/components/clinic/alerts/ClinicianAlertsPanel.test.tsx"
    - "leanshot/src/components/clinic/alerts/AlertSnoozePopover.test.tsx"
  modified:
    - "leanshot/src/components/clinic/ClinicContextBar.tsx"
    - "leanshot/src/components/ui/Badge.tsx"

key-decisions:
  - "tone='amber' added as NEW BadgeTone variant — does NOT redirect warning (orange preserved per UI-SPEC §Color)"
  - "statusToTone() function maps pending→amber, not a literal tone='amber' prop in JSX (computed via function call)"
  - "React.lazy() import for ClinicianAlertsPanel in ClinicContextBar to keep clinic chunk lean"
  - "Subscription failure (CHANNEL_ERROR) sets isSubscribed=false without throw — DB query still loads alerts"
  - "ClinicianAlertsPanel uses plain <a href> links (not react-router-dom) — project has no router"
  - "AlertSnoozePopover mounts null when open=false (prevents focus grab)"
  - "SEVEN_DAYS_MS lookback window in use-clinician-alerts; status filter includes delivery_failed"

patterns-established:
  - "HMAC alerts channel pattern: channelNameFor(orgId, 'alerts') → org-{hmac8}-alerts subscription"
  - "Bell-icon badge pattern: aria-live polite span + aria-hidden on visual Badge + aria-label on button includes count"
  - "4-preset snooze pattern: '1h'/'4h'/'24h'/'7d' SECDEF p_duration literals (no free-form)"

requirements-completed: [CLIN-03, CLIN-04, CLIN-06]

duration: 8min
completed: 2026-05-18
---

# Phase 30 Plan 03: ClinicianAlertsPanel + AlertSnoozePopover + Badge amber tone

**In-app clinician alert UX: HMAC-subscribed bell-icon dropdown with amber pending badges, ack/snooze SECDEFs, 4-preset focus-trapped popover, and 21 RTL tests green**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-18T05:19:51Z
- **Completed:** 2026-05-18T05:27:30Z
- **Tasks:** 2 (TDD — each has RED + GREEN commits)
- **Files modified:** 8 (6 new, 2 extended)

## Accomplishments

- ClinicianAlertsPanel ships as bell-icon dropdown (desktop: fixed 380px; mobile: Sheet) with role=region, aria-label, Escape/outside-click close, pending alert rows with `--color-amber-soft` background
- AlertSnoozePopover ships with role=dialog + aria-modal + focus trap mirroring ScoreBreakdownPopover, 4 presets ("1 hour"/"4 hours"/"24 hours"/"7 days") → p_duration '1h'/'4h'/'24h'/'7d', success/error toast, Escape close + focus return
- Badge.tsx extended with tone='amber' (bg-[var(--color-amber-soft)] text-[var(--color-amber)]) — tone='warning' preserved as distinct orange
- ClinicContextBar updated with Bell icon, aria-live polite badge count, aria-haspopup=dialog, React.lazy ClinicianAlertsPanel
- 21 vitest tests pass (10 ClinicianAlertsPanel + 9 AlertSnoozePopover + 2 Badge amber regression guard)

## Task Commits

Each task was committed atomically with TDD gate:

1. **RED: ClinicianAlertsPanel + AlertSnoozePopover failing tests** - `516e666` (test)
2. **GREEN: All 6 implementation files** - `3a6b239` (feat)

## Files Created/Modified

- `leanshot/src/components/clinic/alerts/ClinicianAlertsPanel.tsx` (430 lines) — Bell dropdown panel, ack/snooze, realtime, empty state, resolved toggle
- `leanshot/src/components/clinic/alerts/AlertSnoozePopover.tsx` (214 lines) — 4-preset role=dialog focus trap
- `leanshot/src/components/clinic/alerts/use-clinician-alerts.ts` (132 lines) — Query hook + groupByStatus
- `leanshot/src/components/clinic/alerts/use-clinician-alerts-realtime.ts` (97 lines) — HMAC channel subscription
- `leanshot/src/components/clinic/alerts/ClinicianAlertsPanel.test.tsx` — 12 RTL tests
- `leanshot/src/components/clinic/alerts/AlertSnoozePopover.test.tsx` — 9 RTL tests
- `leanshot/src/components/clinic/ClinicContextBar.tsx` — Bell + badge + lazy panel
- `leanshot/src/components/ui/Badge.tsx` — tone='amber' added

## Decisions Made

- amber vs warning separation: UI-SPEC §Color requires `--color-amber` (#e0af4e) for pending alerts; `--color-warning` (#e37748) is orange for different semantic. Added `amber` as new BadgeTone, did NOT redirect `warning`.
- No react-router-dom: ClinicianAlertsPanel uses plain `<a href>` links since this project uses no router (CLAUDE.md architecture constraint).
- lazy import: ClinicianAlertsPanel loaded via React.lazy() from ClinicContextBar to keep the clinic chunk lean ahead of Plan 30-05 budget verification.

## Deviations from Plan

**1. [Rule 1 - Bug] RefObject null-safety for React 19**
- **Found during:** TypeScript check post-GREEN implementation
- **Issue:** React 19 `useRef<T>(null)` returns `RefObject<T | null>` not `RefObject<T>`; prop types specified `RefObject<HTMLButtonElement>` which TypeScript rejected
- **Fix:** Updated all `RefObject<HTMLButtonElement>` → `RefObject<HTMLButtonElement | null>` in AlertSnoozePopover and ClinicianAlertsPanel props/handlers
- **Files modified:** AlertSnoozePopover.tsx, ClinicianAlertsPanel.tsx
- **Verification:** `npx tsc --noEmit -p tsconfig.app.json` exits 0
- **Committed in:** 3a6b239 (GREEN commit)

**2. [Rule 1 - Bug] Import order lint — eslint auto-fix**
- **Found during:** lint run after GREEN commit
- **Issue:** ClinicianAlertsPanel.tsx had @/lib/* imports after local ./alerts/* imports
- **Fix:** `npx eslint --fix` applied; test re-run confirmed 21 tests still pass
- **Committed in:** 3a6b239 (included in GREEN commit via --fix before final commit)

---

**Total deviations:** 2 auto-fixed (1 TS strict null, 1 import order)
**Impact on plan:** Both correctness-required fixes. No scope change.

## Known Stubs

None — all data flows are wired to real Supabase queries and SECDEFs.

## Threat Flags

No new threat surface beyond what the plan's threat model covers. All SECDEFs enforce org-member re-check server-side (T-30-03-01 mitigated). PHI discipline: display_name only in alert rows (T-30-03-02 mitigated).

## Issues Encountered

- worktree spawned from origin/main (f68f527) which is behind local main (b396243). Foundation files from Plan 30-00 (migrations, SECDEFs) exist on local main but are not needed at runtime for this UI-only plan. `org-realtime.ts` (from Plan 28-04) IS in this worktree as it was merged to main. Implementation proceeded without cherry-pick since Plan 30-03 only needs the org-realtime.ts browser helper which IS present.
- node_modules not in worktree (gitignored); symlinked to main repo's leanshot/node_modules for test execution.

## Vitest Results

```
Test Files  2 passed (2)
     Tests  21 passed (21)
  Duration  ~800ms
```

Files tested:
- `src/components/clinic/alerts/ClinicianAlertsPanel.test.tsx` (12 tests)
- `src/components/clinic/alerts/AlertSnoozePopover.test.tsx` (9 tests)

Badge amber variant coverage:
- Test "tone='amber' renders with --color-amber background class (not --color-warning)" — PASS
- Test "tone='warning' still uses --color-warning (regression guard)" — PASS

## Self-Check

- [x] ClinicianAlertsPanel.tsx exists: PASS
- [x] AlertSnoozePopover.tsx exists: PASS
- [x] use-clinician-alerts.ts exists: PASS
- [x] use-clinician-alerts-realtime.ts exists: PASS
- [x] channelNameFor in realtime hook: PASS
- [x] acknowledge_clinician_alert in panel: PASS
- [x] amber tone in Badge.tsx: PASS
- [x] role=region aria-label=Clinician alerts: PASS
- [x] aria-live=polite in ClinicContextBar: PASS
- [x] aria-haspopup=dialog in ClinicContextBar: PASS
- [x] ClinicianAlertsPanel in ClinicContextBar: PASS
- [x] TypeScript clean: PASS
- [x] Lint clean: PASS
- [x] 21 tests pass: PASS

## Self-Check: PASSED

All files verified. Commits 516e666 (RED) + 3a6b239 (GREEN) exist in git log.

## Next Phase Readiness

- ClinicianAlertsPanel ready to consume alerts from Plan 30-01's deliver-cron broadcasts once merges propagate
- Plan 30-02 (ClinicRankingWeightsForm) and Plan 30-04 (ClinicDashboardOverview) can proceed in parallel
- Plan 30-05 (phase-close bundle budget) will verify that clinic chunk stays under 45 kB ceiling after all Phase 30 components land

---
*Phase: 30-clinician-dashboard-custom-rank-weights-dose-trend-alerts*
*Completed: 2026-05-18*
