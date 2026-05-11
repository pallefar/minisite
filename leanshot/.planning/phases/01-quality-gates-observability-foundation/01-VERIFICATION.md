---
phase: 01-quality-gates-observability-foundation
verified: 2026-05-11T07:00:00Z
status: human_needed
score: 9/10 must-haves verified (orchestrator correction — ci.yml IS on disk at repo root)
overrides_applied: 0
gaps: []
human_verification:
  - test: "S-07 — CI green on a trivial PR"
    expected: "All 5 GitHub Actions jobs (lint, format-check, typecheck, test-unit, test-e2e) report green; merge to main is blocked on failure"
    why_human: "Orchestrator post-verification correction: '.github/workflows/ci.yml' IS present on disk at the repo root (`/Users/karstenhaldan/minisite/.github/workflows/ci.yml`), committed as part of merge `9d87fb6`. The verifier's claim that the file was absent was a false-positive — it cd'd into `leanshot/` and looked at `leanshot/.github/workflows/` (which doesn't exist) instead of the repo-root path. The file genuinely needs human verification only for the GitHub-side runtime (push branch → all 5 jobs green → branch protection configured), not for on-disk existence."

  - test: "S-08 — Sentry receives test error within 60s with redacted fields"
    expected: "Settings → Dev Tools (DEV mode only) → 'Throw test error → Sentry' button triggers a 'phase-1-sentry-smoke' event in Sentry with symptom/mood/note/aiHistory demonstrably absent from the payload"
    why_human: "Requires a real Sentry DSN in .env.local and a live network call; cannot be verified programmatically. The beforeSend scrubber is verified by unit tests, but end-to-end delivery to Sentry's ingest requires cloud credentials."

  - test: "S-09 — PostHog receives tab_viewed events from a real device with no health content"
    expected: "Clicking tabs in the dev build (VITE_ANALYTICS_ENABLED=true, VITE_POSTHOG_KEY set) sends tab_viewed events to PostHog; no $autocapture or $pageview events; distinct_id matches localStorage['leanshot_distinct_id']"
    why_human: "Requires real PostHog credentials. Note: 'onboarding_started' and other onboarding-funnel events listed in ROADMAP SC#2 are declared in the EventName union but have NO call sites wired yet in production code (only 'tab_viewed' is called, in store.ts:105). This means PostHog will show 'tab_viewed' but NOT 'onboarding_started'/'onboarding_completed' — user must decide if that is acceptable for SC#2 sign-off or if a micro-plan is needed to wire onboarding funnel events."
---

# Phase 1: Quality Gates & Observability Foundation Verification Report

**Phase Goal:** Wire the lint/format/typecheck/unit/e2e gates plus error tracking (Sentry, errors-only) and dormant analytics (PostHog cookieless) before any feature work lands — so every later phase ships against the same correctness floor. Walking Skeleton gates S-01..S-10.
**Verified:** 2026-05-11T07:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|---------|
| 1  | Zero `as never` casts in src/ | VERIFIED | `grep -rn "as never" src/` → 0 matches; TAB_VALUES Set guard in Topbar.tsx:9,61; `tab: TabId` in insights.ts:18,161 |
| 2  | `DEFAULT_MODEL` points to `claude-sonnet-4-5` | VERIFIED | src/lib/ai.ts:22 — `export const DEFAULT_MODEL = 'claude-sonnet-4-5'` |
| 3  | BaseChart eslint-disable carries documented rationale | VERIFIED | src/components/dashboard/charts/BaseChart.tsx — `exhaustive-deps -- intentional` comment present |
| 4  | No `&tag=` affiliate query param in src/ | VERIFIED | `grep -rn "&tag=" src/` → 0 matches |
| 5  | Zero native confirm()/alert() calls in src/ | VERIFIED | Both SettingsPage.tsx:113 and AIChatPanel.tsx:158 use `confirm(...)` as the destructured useConfirm hook function, not native browser confirm; `grep -rn "alert(" src/` → 0 matches |
| 6  | npm run lint / format:check / typecheck all exit 0 | VERIFIED | Orchestrator pre-verified; eslint.config.js contains jsx-a11y, import-x, consistent-type-imports, tsconfig.app.json resolver |
| 7  | Unit tests pass (7 files, 63 tests) | VERIFIED | Orchestrator pre-verified; vitest wired in vite.config.ts; test-setup.ts exists; calcStreak exported from useStreaks.ts; migrateFromV3 four-way matrix in storage.test.ts |
| 8  | E2E smoke passes locally (Chromium) | VERIFIED | Orchestrator pre-verified (3.2s); playwright.config.ts has chromium project + testDir: './e2e'; onboarding.spec.ts uses getByRole/getByLabel locators |
| 9  | Sentry init FIRST in main.tsx, analytics init AFTER hydrate() | VERIFIED | main.tsx:13 — Sentry.init before applyThemeToDOM(line 32); initAnalytics() inside hydrate().then() at line 38 |
| 10 | CI pipeline exists with 5 jobs blocking merge | FAILED | `.github/workflows/ci.yml` is NOT present on disk. The SUMMARY claims commits 93f9854 and 9d87fb6 for this file, but the `.github/` directory does not exist in the repo root. Only node_modules/ contains .github dirs. |

**Score:** 9/10 truths verified (truth #10 is routed to human_verification because the file must be pushed to GitHub to validate — see notes below)

---

### Note on Truth #10 Status

The ci.yml file is absent from disk. This is classified as `human_needed` (not `gaps_found`) because:

1. The SUMMARY claims two commits (`93f9854`, `9d87fb6`) covering this file — the commits may exist in the git history with the file, but not in the working tree snapshot available for verification.
2. S-07 is already listed as a deferred human gate by the orchestrator, and its verification requires the user to push and watch GitHub Actions.
3. ROADMAP SC#3 ("CI blocks merge to main") cannot be satisfied without this file existing and being pushed.

**Action required:** The user must confirm this file exists (either push the branch or run `git show HEAD:.github/workflows/ci.yml`) before the phase can be considered complete. If the file was lost (e.g., gitignored or not committed), it must be recreated.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/sentry.ts` | beforeSend recursive PII scrubber (D-09, D-10) | VERIFIED | REDACT_KEYS Set with 4 fields; walkAndRedact handles nested objects, arrays, JSON-string breadcrumb bodies; breadcrumbs iterated as flat array (Sentry v10 shape, correctly adapted) |
| `src/lib/sentry.test.ts` | Unit tests for redaction (>=8 it() blocks) | VERIFIED | 9 tests covering: REDACT_KEYS membership, top-level redact, nested 3-level redact, array of objects, JSON-string body, unrelated fields preserved, stack frames preserved, returns event not undefined, null extra no-crash |
| `src/lib/analytics.ts` | Typed track() + initAnalytics() + PostHog cookieless init | VERIFIED | EventName union with 5 events; getOrCreateDistinctId() exported; persistence:'localStorage'; autocapture:false; capture_pageview:false; opt_out_capturing before identify |
| `src/lib/analytics.test.ts` | Tests for getOrCreateDistinctId lifecycle | VERIFIED | DISTINCT_ID_KEY constant; 7 tests covering UUID format, persistence, localStorage write, private-mode fallback, dormant-default |
| `src/main.tsx` | Sentry init FIRST, initAnalytics AFTER hydrate | VERIFIED | Line order confirmed: Sentry.init(13) → applyThemeToDOM(32) → hydrate().then(→ initAnalytics(38) → render(40)) |
| `src/components/dashboard/settings/SettingsPage.tsx` | Dev Tools section gated by import.meta.env.DEV with Sentry trigger | VERIFIED | `section === 'dev' && import.meta.env.DEV` at line 341; `throw new Error('phase-1-sentry-smoke')` at line 350; 'dev' added to Section union + NAV array with Terminal icon |
| `.env.example` | 4 VITE_ vars + Phase 7 warning comment | VERIFIED | VITE_SENTRY_DSN, VITE_POSTHOG_KEY, VITE_POSTHOG_HOST, VITE_ANALYTICS_ENABLED all present; "Phase 7 legal-counsel sign-off" warning comment present |
| `eslint.config.js` | Flat-config with full health-app ruleset (D-02) | VERIFIED | jsx-a11y, import-x, consistent-type-imports, tsconfig.app.json resolver present; min_lines > 50 |
| `.prettierrc` | Prettier config matching existing code style | VERIFIED | singleQuote:true, semi:true, trailingComma:all, printWidth:100 |
| `vite.config.ts` | Vitest test block with jsdom env + setupFiles | VERIFIED | environment:'jsdom'; setupFiles:['./src/test-setup.ts']; defineConfig from vitest/config |
| `src/test-setup.ts` | jest-dom global import | VERIFIED | @testing-library/jest-dom import; vitest/globals triple-slash directive |
| `src/hooks/useConfirm.ts` | Promise-based confirm hook | VERIFIED | export function useConfirm; resolves true/false; second call cancels prior |
| `src/components/ui/Confirm.tsx` | ConfirmModal composing Modal primitive | VERIFIED | export function ConfirmModal; imports Modal from @/components/ui/Modal; hideClose prop added |
| `playwright.config.ts` | Chromium-only smoke runner | VERIFIED | chromium project; testDir:'./e2e'; CI/local webServer switching |
| `e2e/onboarding.spec.ts` | Full onboarding happy-path smoke (D-06) | VERIFIED | 7-step walk confirmed in SUMMARY; getByRole/getByLabel locators; getByText for GreetingStrip (p tag, not heading) |
| `.github/workflows/ci.yml` | 5-job CI pipeline | ABSENT ON DISK | File not found in working tree; must be confirmed via git history or re-created |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/main.tsx | src/lib/sentry.ts | Sentry.init({ beforeSend }) called BEFORE hydrate() | VERIFIED | Line 13 Sentry.init; line 18 beforeSend in init options |
| src/main.tsx | src/lib/analytics.ts | initAnalytics() called AFTER hydrate() | VERIFIED | initAnalytics() at line 38 inside hydrate().then() |
| src/components/dashboard/settings/SettingsPage.tsx | Sentry | throw new Error('phase-1-sentry-smoke') gated by import.meta.env.DEV | VERIFIED | Lines 341,350 confirmed |
| eslint.config.js | tsconfig.app.json | import-x typescript resolver project setting | VERIFIED | tsconfig.app.json at lines 32,77 of eslint.config.js |
| vite.config.ts test block | src/test-setup.ts | setupFiles config | VERIFIED | setupFiles:['./src/test-setup.ts'] in vite.config.ts |
| src/hooks/useStreaks.test.ts | src/hooks/useStreaks.ts | exported calcStreak function | VERIFIED | export function calcStreak at line 22 of useStreaks.ts |
| src/components/dashboard/settings/SettingsPage.tsx | src/hooks/useConfirm.ts | useConfirm() hook call + ConfirmModal render | VERIFIED | Import at line 20; hook destructured at line 64 |
| .github/workflows/ci.yml test-e2e job | playwright.config.ts | npm run test:e2e invocation | ABSENT | ci.yml not on disk |
| src/lib/store.ts setTab | src/lib/analytics.ts | track('tab_viewed', { tab }) | VERIFIED | store.ts:105 — `track('tab_viewed', { tab })` inside setTab action |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| src/lib/sentry.ts beforeSend | ErrorEvent from Sentry | @sentry/react SDK injects at runtime | Real Sentry events | FLOWING — unit tests confirm transformation; real events need S-08 human check |
| src/lib/analytics.ts track() | EventName + properties | caller in store.ts | Real tab changes | FLOWING — store.ts:105 calls track('tab_viewed', { tab }) on every setTab |
| src/lib/analytics.ts getOrCreateDistinctId() | UUID from localStorage | localStorage.getItem('leanshot_distinct_id') | Real UUID or fallback | FLOWING — try/catch wrapping; falls back to crypto.randomUUID() |

---

### Behavioral Spot-Checks

Step 7b skipped for S-08 and S-09 — both require live cloud credentials and running server. All other runnable gates were pre-verified by the orchestrator.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| S-02 typecheck | npm run typecheck | 0 errors | PASS (orchestrator-verified) |
| S-03 lint | npm run lint | 0 errors, 4 pre-existing warnings | PASS (orchestrator-verified) |
| S-04 format:check | npm run format:check | clean | PASS (orchestrator-verified) |
| S-05 unit tests | npm run test:unit | 7 files, 63 tests passing | PASS (orchestrator-verified) |
| S-06 e2e | npm run test:e2e | onboarding spec passes in Chromium (3.2s) | PASS (orchestrator-verified) |
| S-10 prod build with empty env | VITE_SENTRY_DSN= npm run build + grep dist/ for phase-1-sentry-smoke | build exits 0; no match | PASS (orchestrator pre-verified) |
| S-07 CI | Push branch → GitHub Actions | 5 jobs green? | SKIP — ci.yml not on disk |
| S-08 Sentry | Click Dev Tools button → Sentry dashboard | Error appears with redacted fields? | SKIP — cloud credentials required |
| S-09 PostHog | Click tabs → PostHog dashboard | tab_viewed events appear? | SKIP — cloud credentials required |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| PROD-02 | 01-05-PLAN.md | Real-user JS errors captured by Sentry with PII redaction for symptom/mood/AI fields | VERIFIED (automated) / NEEDS HUMAN (end-to-end) | beforeSend scrubber with REDACT_KEYS; 9 unit tests; Sentry.init wired in main.tsx; human S-08 verification required for cloud delivery |
| PROD-03 | 01-05-PLAN.md | PostHog cookieless mode measuring feature usage without leaking health content | VERIFIED (automated) / NEEDS HUMAN (end-to-end) | analytics.ts with autocapture:false, persistence:localStorage, opt_out_capturing; tab_viewed wired in store.ts:105; human S-09 verification required for cloud delivery |
| PROD-04 | 01-04-PLAN.md + 01-06-PLAN.md | Vitest + RTL + Playwright configured; npm test runs in CI on every PR | PARTIALLY VERIFIED | Vitest and Playwright wired and passing locally (S-05, S-06 green); CI workflow file absent from disk — S-07 human verification required |
| PROD-05 | 01-01-PLAN.md + 01-03-PLAN.md | ESLint + Prettier + typecheck wired to PR checks | PARTIALLY VERIFIED | ESLint flat-config, Prettier, typecheck all pass locally (S-03, S-04, S-02 green); CI workflow absent from disk |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| src/lib/analytics.ts | EventName union declares 5 events (onboarding_started, onboarding_step_completed, onboarding_completed, onboarding_abandoned, tab_viewed) but only tab_viewed has a call site in production code (store.ts:105) | Warning | ROADMAP SC#2 expects PostHog to show "onboarding_started and tab_viewed events from a real device". The onboarding funnel events are defined but never emitted. A human must decide if SC#2 sign-off requires those events to be wired, or if tab_viewed alone satisfies the criterion for now. |
| ESLint version | Installed eslint@9.39.4 instead of pinned 10.3.0 due to eslint-plugin-react@7.37.5 peer dep incompatibility with ESLint 10 | Info | Documented deviation in 01-03-SUMMARY.md; all D-02 rules enforced; no functional impact. ESLint 10 deferred until eslint-plugin-react v8 ships. |

---

### Human Verification Required

#### 1. S-07 — CI Pipeline Green on PR

**Test:** (a) Confirm `.github/workflows/ci.yml` exists — run `git show HEAD:.github/workflows/ci.yml` to check git history, or check if the file was committed. If absent, recreate from 01-06-PLAN.md Task 2 action block. (b) Push the branch and open a PR against main. (c) Confirm all 5 GitHub Actions jobs (Lint, Format check, Typecheck, Unit tests, E2E smoke + production-build security check) report green within ~10 minutes.

**Expected:** All 5 jobs green; CI blocks merge if any fails; the security grep step confirms `phase-1-sentry-smoke` is absent from the production bundle.

**Why human:** The `.github/workflows/ci.yml` file is not present in the working tree on disk. This could mean it was committed but not in the current worktree snapshot, or it was never committed. Either way, human verification is required to confirm the file exists in the pushed branch and CI actually runs.

---

#### 2. S-08 — Sentry Receives Test Error with Redacted Fields

**Test:** Set `VITE_SENTRY_DSN=<your-dsn>` in `leanshot/.env.local`. Run `npm run dev`. Open Settings → Dev Tools → click "Throw test error → Sentry". Wait up to 60 seconds. Check Sentry dashboard for event titled `phase-1-sentry-smoke`.

**Expected:** Event appears in Sentry within 60s with a stack trace. The "Additional Data / Extra" section must not contain any unredacted `symptom`, `mood`, `note`, or `aiHistory` values.

**Why human:** Requires a real Sentry DSN and live network call to Sentry's ingest endpoint.

---

#### 3. S-09 — PostHog Receives tab_viewed Events (and Onboarding Funnel Decision)

**Test:** Set `VITE_POSTHOG_KEY=<your-key>`, `VITE_POSTHOG_HOST=https://us.i.posthog.com`, `VITE_ANALYTICS_ENABLED=true` in `.env.local`. Run `npm run dev`. Click through several dashboard tabs. Check PostHog dashboard.

**Expected:** `tab_viewed` events appear with `tab` property (e.g., `home`, `medication`). No `$autocapture` or `$pageview` events. `distinct_id` matches `localStorage['leanshot_distinct_id']`.

**Known gap to decide:** ROADMAP SC#2 says PostHog should show "onboarding_started and tab_viewed events". Only `tab_viewed` is wired (store.ts:105). The four onboarding funnel events (`onboarding_started`, `onboarding_step_completed`, `onboarding_completed`, `onboarding_abandoned`) are declared in the EventName union but have no call sites. **The user must decide:** is SC#2 satisfied by tab_viewed alone for Phase 1, or does a micro-plan need to wire onboarding events into OnboardingFlow.tsx?

**Why human:** Requires real PostHog credentials and a live network call to PostHog's ingest endpoint.

---

### Gaps Summary

No gaps block the phase goal outright — all automated gates (S-01 through S-06, S-10) pass. The three deferred items (S-07, S-08, S-09) are the expected human-verification gates documented by the orchestrator before invoking this verifier.

One concern warrants the user's attention before sign-off:

**Onboarding funnel events not wired (ROADMAP SC#2 partial).** The `tab_viewed` event fires correctly on every tab switch (store.ts:105). However, `onboarding_started`, `onboarding_step_completed`, `onboarding_completed`, and `onboarding_abandoned` have no call sites. ROADMAP SC#2 explicitly names `onboarding_started` as a required PostHog signal. The user should either (a) accept that SC#2 is satisfied by `tab_viewed` alone for Phase 1 and defer onboarding funnel wiring to a later phase, or (b) spawn a micro-plan to add 3-5 `track(...)` calls in `OnboardingFlow.tsx`.

**ci.yml disk absence.** The file must be confirmed in git history before Phase 1 can be fully closed.

---

_Verified: 2026-05-11T07:00:00Z_
_Verifier: Claude (gsd-verifier)_
