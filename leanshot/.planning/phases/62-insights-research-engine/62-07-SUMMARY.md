---
phase: 62-insights-research-engine
plan: "07"
subsystem: settings-consent
tags:
  - research-consent
  - hipaa
  - settings
  - opt-in
dependency_graph:
  requires:
    - 62-01  # profiles.research_consent column (Wave 0)
  provides:
    - research-consent toggle UI
    - revoke confirmation modal
  affects:
    - SettingsPage NAV
    - profiles.research_consent
    - profiles.consent_revoked_at
tech_stack:
  added: []
  patterns:
    - "role='switch' + aria-checked toggle pattern"
    - "lazy-loaded settings section"
    - "vitest src-components project (jsdom + @testing-library/react)"
key_files:
  created:
    - leanshot/src/components/dashboard/settings/ResearchConsentSection.tsx
    - leanshot/src/components/dashboard/settings/__tests__/ResearchConsentSection.test.tsx
    - leanshot/vitest.62-07.config.ts
  modified:
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx
    - leanshot/src/lib/i18n/settings-labels.ts
    - leanshot/public/locales/en/settings.json
    - leanshot/public/locales/es/settings.json
    - leanshot/vitest.config.ts
decisions:
  - "Used Modal DS primitive + inline button layout for revoke confirm (no ConfirmModal DS — needed custom 44px danger button and full verbatim copy)"
  - "Lazy import via import('./ResearchConsentSection') default export (no named re-export needed for lazy)"
  - "Section title passed directly as string to Section component (not i18n key) — research-consent section heading is owned by ResearchConsentSection component itself"
  - "Added src-components project to vitest.config.ts with jsdom + jest-dom setup + node_modules symlink workaround for worktree isolation"
  - "i18n nav labels added to both en + es locales for newsletter + research_consent"
metrics:
  duration: "~9 minutes"
  completed: "2026-05-26"
  tasks_completed: 2
  files_count: 9
---

# Phase 62 Plan 07: Research Consent Toggle + Revoke Modal Summary

**One-liner:** HIPAA-opt-in consent toggle in Settings with revoke confirmation modal — writes `research_consent` + `consent_revoked_at` to `profiles`, modal copy verbatim from UI-SPEC.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing ResearchConsentSection tests | 924d1756 | `__tests__/ResearchConsentSection.test.tsx`, `vitest.config.ts` |
| 1 (GREEN) | ResearchConsentSection component | 890dc332 | `ResearchConsentSection.tsx` |
| 2 | Wire into SettingsPage NAV | 88efde44 | `SettingsPage.tsx`, `settings-labels.ts`, `locales/*.json` |

## Verification

- **Modal copy verified:** `ResearchConsentSection.tsx` contains verbatim "Revoke research consent?" + "within 24 hours" + "past publications are not retracted"
- **Default OFF confirmed:** `useState(false)` initial state; DB default also false (Wave 0 migration)
- **Revoke path:** toggle OFF → `setShowRevokeModal(true)` (no DB write until confirm)
- **Enable path:** toggle ON → direct `supabase.from('profiles').update(...)` (no modal)
- **SettingsPage NAV:** `{ id: 'research-consent', Icon: FlaskConical, Component: ResearchConsentSection }` entry present
- **tsc clean:** `npx tsc -p tsconfig.app.json --noEmit` passes
- **Tests:** 7/7 pass (6 RTL behavior tests + 1 pure helper test)

## SettingsPage NAV Diff

```
NAV array additions (after 'newsletter', before 'leaderboards'):
  { id: 'research-consent', Icon: FlaskConical }

Lazy import added:
  const ResearchConsentSection = lazy(() => import('./ResearchConsentSection'));

Section render added (section === 'research-consent'):
  <ResearchConsentSection /> wrapped in <Suspense>
```

## Deviations from Plan

### Auto-fixes

**1. [Rule 2 - Missing functionality] vitest src-components project + node_modules symlink**
- **Found during:** Task 1 (TDD RED)
- **Issue:** Worktree has no `node_modules`; vitest.config.ts `projects:` array masked default test surface; React JSX runtime unresolvable; jest-dom matchers missing
- **Fix:** Added `src-components` project to `vitest.config.ts` with jsdom env + `@vitejs/plugin-react` + `setupFiles: ['./src/test-setup.ts']`. Created `node_modules → ../../../leanshot/node_modules` symlink in worktree.
- **Files modified:** `vitest.config.ts`
- **Commits:** 924d1756

**2. [Rule 2 - Missing i18n keys] newsletter + research_consent nav labels**
- **Found during:** Task 2
- **Issue:** `sectionLabel()` calls `t('settings:nav.newsletter')` and `t('settings:nav.research_consent')` but neither key existed in en/es locale files; would render raw key strings
- **Fix:** Added both keys to `public/locales/en/settings.json` and `public/locales/es/settings.json`
- **Files modified:** `locales/en/settings.json`, `locales/es/settings.json`
- **Commits:** 88efde44

## TDD Gate Compliance

- RED: commit 924d1756 — `test(62-07)` — failing tests shipped before component existed
- GREEN: commit 890dc332 — `feat(62-07)` — component implemented, all 7 tests pass
- REFACTOR: not needed — implementation is clean

## Known Stubs

None — all data is fetched from `supabase.from('profiles')` on mount; no hardcoded empty values flowing to render.

## Threat Flags

No new trust boundaries introduced beyond the plan's threat model. Component reads/writes only `profiles.research_consent` and `profiles.consent_revoked_at` via authenticated Supabase client — RLS limits writes to `auth.uid() = id`.

## Self-Check: PASSED

All created files exist. All commit hashes verified in git log. Tests 7/7 pass. tsc clean.
