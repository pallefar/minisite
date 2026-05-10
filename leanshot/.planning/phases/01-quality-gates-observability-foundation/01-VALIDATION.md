---
phase: 1
slug: quality-gates-observability-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.5 + @testing-library/react 16.3.2 + @playwright/test 1.59.1 |
| **Config file** | `vite.config.ts` (test block, Vitest 4) + `playwright.config.ts` (Wave 0 installs) |
| **Quick run command** | `npm run test:unit -- --run` |
| **Full suite command** | `npm test` (lint + format:check + typecheck + test:unit + test:e2e) |
| **Estimated runtime** | ~90 seconds full suite (unit ~10s, e2e ~30s, lint+format+typecheck ~50s combined) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- --run` (Vitest unit tests, no watch)
- **After every plan wave:** Run `npm test` (full local suite mirroring CI)
- **Before `/gsd-verify-work`:** Full suite must be green; Sentry test-error visible in dashboard; PostHog `tab_viewed` visible
- **Max feedback latency:** ~10 seconds for unit-level signal; ~90 seconds for full-suite parity

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD — populated by gsd-planner from PLAN.md task IDs | | | PROD-02/03/04/05 | T-1-XX (per planner threat model) | Per task acceptance | unit/integration/e2e/manual | `npm run test:unit -- <pattern>` etc. | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vite.config.ts` test block — Vitest 4 jsdom env, setup file, `@/*` alias resolution
- [ ] `vitest.setup.ts` — `@testing-library/jest-dom` import + global cleanup
- [ ] `playwright.config.ts` — Chromium-only, dev-server reuse, trace on first retry
- [ ] `eslint.config.js` — flat-config with full health-app ruleset (D-02)
- [ ] `.prettierrc` — single-quote, semi true, ~100 col, trailing-comma all
- [ ] `.github/workflows/ci.yml` — five-job pipeline (lint/format:check/typecheck/test:unit/test:e2e)
- [ ] `package.json` scripts — `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:unit`, `test:e2e`
- [ ] `src/lib/sentry.ts` + `src/lib/analytics.ts` modules with stubs for D-09/D-13/D-14/D-15 patterns
- [ ] `.env.example` — `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_ANALYTICS_ENABLED`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sentry receives intentional error within 60s of "Throw test error" click | PROD-02 | Requires real Sentry DSN + dashboard inspection; can't be asserted from CI without coupling tests to a live external service | (1) `npm run dev` with `VITE_SENTRY_DSN` set; (2) Open Settings → Dev Tools → "Throw test error → Sentry"; (3) Open Sentry project dashboard within 60s; (4) Verify event appears with stack trace; (5) Verify `symptom`/`mood`/`note`/`aiHistory` fields show `[Redacted]` |
| PostHog `onboarding_started` + `tab_viewed` events visible in dashboard | PROD-03 | PostHog event ingestion is async + remote; no automated way to assert without polling PostHog API | (1) `VITE_ANALYTICS_ENABLED=true` `npm run dev`; (2) Complete onboarding flow; (3) Click through tabs; (4) Open PostHog cookieless dashboard; (5) Verify events present and contain ZERO free-text health content |
| CI blocks merge to `main` on any failed gate | PROD-04, PROD-05 | Requires push to GitHub + PR + branch protection rules; not a unit test | (1) Open PR with deliberate lint error; (2) Verify GitHub blocks merge; (3) Repeat for typecheck error; (4) Repeat for failing unit test; (5) Repeat for failing Playwright smoke |
| `BaseChart.tsx` orphan `eslint-disable` resolved | PROD-05 | Code-quality regression check; verified by ESLint passing on a fresh repo clone after lint fix lands | (1) Fresh clone; (2) `npm i && npm run lint` exits 0 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (populated by planner)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
