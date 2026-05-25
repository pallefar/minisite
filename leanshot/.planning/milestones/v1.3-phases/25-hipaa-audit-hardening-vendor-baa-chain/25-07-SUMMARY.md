---
phase: 25-hipaa-audit-hardening-vendor-baa-chain
plan: "07"
subsystem: analytics-phi-guard
tags: [hipaa, posthog, session-recording, phi-guard, zustand, react-hook]
dependency_graph:
  requires: []
  provides:
    - useSessionReplayPhiGuard hook (src/lib/posthog-route-disable.ts)
    - PHI_URL_REGEX constant
    - disable_session_recording global default in posthog.init
  affects:
    - src/App.tsx (hook wired at top of App component)
    - src/lib/analytics.ts (disable_session_recording: true added to init)
tech_stack:
  added: []
  patterns:
    - Dynamic import (posthog-js) for bundle-budget compliance
    - Zustand selector + popstate event for routerless PHI detection
    - Module-level memo deduplication for start/stop calls
key_files:
  created:
    - src/lib/posthog-route-disable.ts
    - src/lib/__tests__/posthog-route-disable.test.ts
  modified:
    - src/lib/analytics.ts
    - src/App.tsx
decisions:
  - "RESEARCH correction #1: disable_session_recording_on_url does not exist in posthog-js; implemented programmatic start/stop via route-change hook instead"
  - "PHI_URL_REGEX and DISABLE_RECORDING_URL_REGEX coexist: PHI_URL_REGEX is the hook's local export (pattern ^/...); DISABLE_RECORDING_URL_REGEX in src/lib/posthog/disable-recording-regex.ts is the sibling-plan canonical (pattern /.../ i flag). No deduplication attempted to avoid cross-plan merge conflicts."
  - "Phase 28 modal PHI case (share/doctor-report modals) deferred with it.skip + TODO comment; the URL side of PHI_URL_REGEX already covers /share/* when Phase 28 wires real URLs"
metrics:
  duration: "8 minutes"
  completed: "2026-05-18T15:27:00Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
---

# Phase 25 Plan 07: PostHog Session-Replay PHI Guard Summary

**One-liner:** Global `disable_session_recording: true` default + `useSessionReplayPhiGuard()` React hook with Zustand currentTab + popstate driven start/stop via dynamic-import posthog-js.

## What Was Built

### analytics.ts — posthog.init hardening

Audit result: `disable_session_recording: true` was **absent** from the init options object. Added alongside the existing config keys (`persistence`, `autocapture`, `capture_pageview`, `disable_surveys`). Added a header comment citing HIPAA-17 + RESEARCH correction #1 explaining that `disable_session_recording_on_url` does not exist.

### src/lib/posthog-route-disable.ts (new)

Exports:
- `PHI_URL_REGEX` — `/^\/(clinic|patient|admin\/users|dose-log|share|auth)(\/|$)/i` — boundary-safe deny-list regex
- `useSessionReplayPhiGuard()` — React hook wired into App.tsx top
- `__test` seam — `reset()`, `isPhiRoute()`, `applyDecision()` for unit testing

Hook behavior:
- Subscribes to `useStore((s) => s.currentTab)` changes via `useEffect`
- Subscribes to `window.popstate` events for auth callback URL detection
- Maps Zustand `currentTab` to synthetic route via `TAB_TO_SYNTHETIC_ROUTE` record
- `medication` tab → synthetic `/dose-log` → PHI → `posthog.stopSessionRecording()`
- Non-PHI tab → `posthog.startSessionRecording()`
- Dynamic import failure silently no-ops (fail-closed: no recording if posthog-js blocked)
- Module-level `lastDecision` memo deduplicates redundant calls

### Tab → Synthetic Route Mappings (v1.3)

| Tab | Synthetic Route | PHI? |
|-----|----------------|------|
| `medication` | `/dose-log` | Yes |
| `home` | (none) | No |
| `symptoms` | (none) | No |
| `body` | (none) | No |
| `nutrition` | (none) | No |
| `activity` | (none) | No |
| `supplements` | (none) | No |
| `mood` | (none) | No |
| `insights` | (none) | No |

Note: `share` and `doctor-report` are modals (in-tab `useState` in App.tsx), not `TabId` values. They are deferred to Phase 28 when real `/share/*` URLs ship.

### src/lib/__tests__/posthog-route-disable.test.ts (new)

26 passing tests / 1 skipped (Phase 28 modal deferred):
- PHI_URL_REGEX boundary: 12 cases covering all 6 path prefixes + boundary exclusion (/clinicians) + /admin/billing non-PHI
- `applyDecision` routing: stop on PHI, start on non-PHI, dedupe guard, import-rejection silent no-op
- Synthetic tab → route: medication→PHI, home→non-PHI, URL-side checks (clinic, auth, patient, admin/users, share)
- Phase 28 modal case documented with `it.skip` + TODO comment

### src/App.tsx — hook wiring

`useSessionReplayPhiGuard()` added as the FIRST hook call in `App()` (line 617), before any `useStore` selector reads. Import added in the import block after the Phase 22 consent imports.

## Bundle Size

Index JS chunk: **21.17 kB gz** (50 kB ceiling; no regression). The `posthog-route-disable.ts` hook is ~2.5 kB uncompressed and imports only React's `useEffect` + `useStore` (both already in the index chunk). posthog-js stays in `vendor-telemetry` via the existing dynamic import pattern.

## Verification

- All 5 automated verification checks from Task 1 verified spec: PASS
- Typecheck (`tsc -b --noEmit`): PASS
- Build: PASS (no errors)
- 26 vitest cases pass, 1 skipped (Phase 28 deferred)

## Deviations from Plan

### Sibling-plan file observed (not scaffolded)

`src/lib/posthog/disable-recording-regex.ts` already exists, created by a sibling plan (likely 25-01 or 25-03), and `analytics.ts` already re-exports `DISABLE_RECORDING_URL_REGEX` from it. This plan's `PHI_URL_REGEX` is a separate export in `posthog-route-disable.ts` with a slightly different regex pattern (anchored `^/` vs non-anchored `/`). The coexistence is intentional to avoid cross-plan merge conflicts during Wave 1 parallel execution.

### Node_modules symlink for worktree test execution

Created `node_modules -> /Users/karstenhaldan/minisite/leanshot/node_modules` symlink in the worktree leanshot directory to enable vitest test execution. This is gitignored and does not affect the committed files.

## Known Stubs

None. All code paths are functional. The Phase 28 modal deferral is documented with `it.skip` + TODO comment in the test file and a `// TODO Phase 28` comment in `TAB_TO_SYNTHETIC_ROUTE`.

## Threat Flags

None. The security surface added (PostHog session recording gate) is already in the plan's threat model. No new network endpoints, auth paths, or file access patterns introduced.

## Future-Proofing Notes (Phase 28)

When Phase 28 introduces real `/clinic/*` and `/share/*` URL routes:
1. The URL-side of `PHI_URL_REGEX` automatically lights up (no code change needed)
2. If `share` and `doctor-report` become Zustand modal flags, add entries to `TAB_TO_SYNTHETIC_ROUTE` and un-skip the Phase 28 `it.skip` test case
3. If a `currentSensitiveModal: 'share' | 'doctor-report' | null` store slice ships, extend `isPhiRoute(currentTab, pathname, currentSensitiveModal)` signature

## Self-Check: PASSED

- [x] `src/lib/posthog-route-disable.ts` exists
- [x] `src/lib/__tests__/posthog-route-disable.test.ts` exists
- [x] Commit `df67ed2` exists (RED)
- [x] Commit `f806cac` exists (GREEN)
- [x] Commit `168f3c3` exists (Task 2 wire)
- [x] `disable_session_recording: true` in analytics.ts
- [x] `useSessionReplayPhiGuard` in App.tsx
- [x] 26 tests pass
- [x] Bundle: 21.17 kB gz index (within 50 kB ceiling)
