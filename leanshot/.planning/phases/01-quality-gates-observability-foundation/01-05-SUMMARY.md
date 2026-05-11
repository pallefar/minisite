---
phase: 1
plan: 5
subsystem: observability
tags: [sentry, posthog, analytics, pii-scrubbing, error-tracking, cookieless]
dependency_graph:
  requires: [01-04]
  provides: [sentry-init, posthog-init, beforeSend-scrubber, analytics-track]
  affects: [src/main.tsx, src/lib/sentry.ts, src/lib/analytics.ts, src/components/dashboard/settings/SettingsPage.tsx]
tech_stack:
  added:
    - "@sentry/react@10.52.0"
    - "posthog-js@1.372.10"
  patterns:
    - "beforeSend recursive PII scrubber (walkAndRedact pattern)"
    - "localStorage UUID for analytics distinct_id"
    - "opt_out_capturing before identify (Pitfall 2 mitigation)"
    - "import.meta.env.DEV tree-shaking for dev-only UI"
key_files:
  created:
    - src/lib/sentry.ts
    - src/lib/sentry.test.ts
    - src/lib/analytics.ts
    - src/lib/analytics.test.ts
    - .env.example
  modified:
    - src/main.tsx
    - src/components/dashboard/settings/SettingsPage.tsx
    - package.json
decisions:
  - "Sentry v10 ErrorEvent.breadcrumbs is Breadcrumb[] (flat array), not { values: Breadcrumb[] } — updated both sentry.ts and sentry.test.ts to match the actual type"
  - "SettingsPage uses a tab-switch pattern with Section type union — added 'dev' to union and conditional NAV entry using Terminal icon from lucide-react"
  - "Import order in main.tsx: hooks/ before lib/ per alphabetical ESLint import-x/order rule"
metrics:
  duration: "6 minutes"
  completed: "2026-05-10"
  tasks_completed: 3
  files_created: 5
  files_modified: 3
---

# Phase 1 Plan 5: Sentry + PostHog Observability Foundation Summary

Wired `@sentry/react` (errors-only with recursive PII scrubber) and `posthog-js` (cookieless, dormant-until-Phase-7) into the LeanShot SPA, satisfying Walking Skeleton gates S-08, S-09, and S-10, with all four CONTEXT.md redaction fields covered by 9 unit tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Sentry beforeSend PII scrubber | 060f6ba | src/lib/sentry.ts, src/lib/sentry.test.ts |
| 2 | PostHog cookieless analytics module | 28c0786 | src/lib/analytics.ts, src/lib/analytics.test.ts |
| 3 | Wire main.tsx + SettingsPage Dev Tools + .env.example | 073275e | src/main.tsx, src/components/dashboard/settings/SettingsPage.tsx, .env.example |
| fix | Prettier formatting on analytics.ts + sentry.test.ts | 2e507c9 | src/lib/analytics.ts, src/lib/sentry.test.ts |

## Verification Gates

All gates pass on final state:

- `npm run typecheck` exits 0
- `npm run lint` exits 0 (4 pre-existing warnings from Plans 01-03, no new errors)
- `npm run format:check` exits 0
- `npm run test:unit` exits 0 — 7 test files, 63 tests (16 new: 9 sentry + 7 analytics)
- `VITE_SENTRY_DSN= VITE_POSTHOG_KEY= VITE_ANALYTICS_ENABLED=false npm run build` exits 0 (S-10)

## What Was Built

### src/lib/sentry.ts

Exports `REDACT_KEYS` (a `Set` with the four D-10 fields: `symptom`, `mood`, `note`, `aiHistory`) and `beforeSend(event: ErrorEvent): ErrorEvent`. The scrubber uses a recursive `walkAndRedact`/`redactValue` pair that handles:

- Top-level matching keys
- Nested objects at arbitrary depth
- Arrays of objects (each item walked recursively)
- JSON-stringified string values in breadcrumb data bodies (parse → walk → re-stringify)
- Unmatched fields, stack frames, error class/value, message — all preserved (D-09)

Key fix: Sentry v10's `ErrorEvent.breadcrumbs` is `Breadcrumb[]` (a flat array), not `{ values: Breadcrumb[] }` as in older SDK versions. The implementation and tests were updated to match the actual API.

### src/lib/analytics.ts

Exports:
- `EventName` union type with the 5 starter events from D-14
- `getOrCreateDistinctId()` — localStorage UUID with private-mode fallback (D-15)
- `initAnalytics()` — PostHog init with `persistence: 'localStorage'`, `autocapture: false`, `capture_pageview: false`, and `opt_out_capturing()` fired BEFORE `identify()` when not enabled (Pitfall 2 mitigation)
- `track(event: EventName, properties?)` — type-safe no-op guard when `VITE_ANALYTICS_ENABLED !== 'true'` (D-13)

### src/main.tsx — Init Order

```
Sentry.init()          ← line 13 (FIRST — before theme read, before hydrate)
applyThemeToDOM()      ← line 32
hydrate().then(() => {
  initAnalytics()      ← line 38 (AFTER hydrate — distinct_id available)
  createRoot().render  ← line 40
})
```

### SettingsPage.tsx — Dev Tools Section

The SettingsPage uses a `Section` type union and a `NAV` array for the tab-switch navigation. The implementation:

1. Added `'dev'` to the `Section` type union
2. Added a conditional NAV entry using spread: `...(import.meta.env.DEV ? [{ id: 'dev' as Section, label: 'Dev Tools', Icon: Terminal }] : [])`
3. Added a section block gated by both `section === 'dev' && import.meta.env.DEV` containing a `Button variant="destructive"` that throws `new Error('phase-1-sentry-smoke')`

The throw is synchronous inside an `onClick` handler (not inside Promise/async), outside any try/catch, so it reaches Sentry's global error handler.

### .env.example

Documents all four `VITE_*` vars with:
- `VITE_SENTRY_DSN=` (empty — no-op in local dev)
- `VITE_POSTHOG_KEY=` and `VITE_POSTHOG_HOST=https://us.i.posthog.com`
- `VITE_ANALYTICS_ENABLED=false` with the Phase 7 production-firing warning comment

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Sentry v10 breadcrumbs type mismatch**

- **Found during:** Task 1 implementation (typecheck)
- **Issue:** The plan's code template used `event.breadcrumbs?.values` (Sentry v8/v9 API with `{ values: Breadcrumb[] }` shape). Sentry v10 changed `ErrorEvent.breadcrumbs` to be `Breadcrumb[]` directly.
- **Fix:** Updated `beforeSend` in `sentry.ts` to iterate `event.breadcrumbs` directly, and updated `sentry.test.ts` to pass `breadcrumbs` as an array instead of `{ values: [...] }`.
- **Files modified:** `src/lib/sentry.ts`, `src/lib/sentry.test.ts`
- **Commit:** 060f6ba

**2. [Rule 1 - Bug] ESLint import-x/order violations in test/lib files**

- **Found during:** Task 1 lint check; Task 3 main.tsx edit
- **Issue:** Type imports from `@sentry/react` needed to precede `vitest` imports. In main.tsx, `./hooks/useTheme` must precede `./lib/analytics` (alphabetical order within sibling group).
- **Fix:** Reordered imports to satisfy `import-x/order` rule.
- **Files modified:** `src/lib/sentry.test.ts`, `src/main.tsx`
- **Commit:** 060f6ba, 073275e

**3. [Rule 1 - Bug] Prettier formatting on analytics.ts and sentry.test.ts**

- **Found during:** Task 3 final format:check
- **Issue:** Line-length wrapping in `analytics.ts` (VITE_POSTHOG_HOST cast) and array literal formatting in `sentry.test.ts` failed `prettier --check`.
- **Fix:** Ran `prettier --write` on both files.
- **Files modified:** `src/lib/analytics.ts`, `src/lib/sentry.test.ts`
- **Commit:** 2e507c9

**4. [Rule 2 - Missing critical functionality] SettingsPage required adapter for tab-switch pattern**

- **Found during:** Task 3 — reading SettingsPage.tsx
- **Issue:** The plan's template code showed a bare `{section === 'dev' && import.meta.env.DEV && ...}` pattern, but the file uses a typed `Section` union AND an explicit `NAV` array that controls which tabs render in the navigation sidebar. Without adding `'dev'` to both the type and the NAV, the section would never be reachable.
- **Fix:** Added `'dev'` to the `Section` type union, added a conditional NAV entry using spread operator with `Terminal` icon from lucide-react, and added the section content block.
- **Files modified:** `src/components/dashboard/settings/SettingsPage.tsx`
- **Commit:** 073275e

## Walking Skeleton Gates

| Gate | Status |
|------|--------|
| S-08 (Sentry receives error) | Unblocked — manual verify in Plan 06 checkpoint (requires DSN in .env.local) |
| S-09 (PostHog receives events) | Unblocked — manual verify in Plan 06 checkpoint (requires POSTHOG_KEY + ANALYTICS_ENABLED=true) |
| S-10 (Production build with empty env) | PASSED — `npm run build` exits 0 with all VITE vars empty |

## Threat Surface Scan

No new threat surface beyond what was planned in the threat model. The four threats (T-1-01 through T-1-PostHog-pre-7) are all mitigated as designed:

- `beforeSend` scrubber covers all four D-10 fields with 9 regression tests
- `autocapture: false` and typed `track()` wrapper prevent unintended health-content capture
- `VITE_ANALYTICS_ENABLED=false` default + `opt_out_capturing()` guards production silence
- Dev Tools section (`phase-1-sentry-smoke` button) is fully gated by `import.meta.env.DEV`

## Self-Check: PASSED

Files created:
- `src/lib/sentry.ts`: FOUND
- `src/lib/sentry.test.ts`: FOUND
- `src/lib/analytics.ts`: FOUND
- `src/lib/analytics.test.ts`: FOUND
- `.env.example`: FOUND

Commits:
- `060f6ba`: FOUND (Sentry module + tests)
- `28c0786`: FOUND (Analytics module + tests)
- `073275e`: FOUND (main.tsx + SettingsPage + .env.example)
- `2e507c9`: FOUND (Prettier formatting fix)

All `npm run` gates exit 0.
