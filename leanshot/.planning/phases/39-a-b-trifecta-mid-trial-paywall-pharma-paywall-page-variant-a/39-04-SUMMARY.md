---
phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a
plan: 04
subsystem: consumer-paywall-surfaces
tags: [paywall, mid-trial, variant-resolver, consent-adapter, utm-capture, onboarding-flow, six-screen, fraunces-accent, e2e]

# Dependency graph
requires:
  - phase: 39
    plan: 01
    provides: user_experiments + variant_config schema (resolved server-side by variant-resolver)
  - phase: 39
    plan: 02
    provides: phaCheck() runtime helper (D-06 layer 2); D-05 5-category safety carveout
  - phase: 39
    plan: 03
    provides: supabase.functions.invoke('variant-resolver', { body: { surface: 'paywall' } }) — {variant_id, config} contract
  - phase: 22
    provides: vanilla-cookieconsent v3 acceptedCategory('analytics') read API (OQ-2 resolution)
provides:
  - "src/lib/paywall/consent-adapter.ts getPaywallTrackingConsent(): boolean — stable boolean contract decoupling paywall surfaces from upstream Phase 22 consent shape"
  - "src/lib/utm/capture-first-touch.ts captureFirstTouchUtm(): void — first-touch idempotent lt_utm_source cookie writer (PAYWALL-07, D-09, OQ-5)"
  - "src/components/paywall/PaywallGate.tsx — cascade wrapper consumed by Plan 39-05 PharmaContentBlock"
  - "src/components/paywall/safety-carveout.ts shouldShortCircuitForSafety(content): boolean — D-06 layer 3 grep-gate-safe helper that owns the safety_category field read"
  - "src/components/paywall/PaywallModal.tsx — Surface A single-screen paywall over Modal primitive"
  - "src/components/paywall/OnboardingFlowPaywall/ — Surface B 6-screen state machine + 6 Screen presentational shells + shared ScreenProps types"
  - "e2e/paywall-mid-trial.spec.ts — PAYWALL-01 Playwright proof (gated on PLAYWRIGHT_RUN_P39=1)"
  - "App.tsx top-of-body useEffect → captureFirstTouchUtm() (mount-once, StrictMode safe)"
affects:
  - "Plan 39-05 PharmaContentBlock — consumes PaywallGate.tsx cascade"
  - "Phase 51 UTM map pipeline — will adopt the lt_utm_source cookie key set here (OQ-5)"
  - "supabase/functions/variant-resolver — invoked from PaywallModal + OnboardingFlowPaywall + PaywallGate (3 client surfaces, all with body { surface: 'paywall' })"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RESEARCH OQ-2 resolution: thin consent shim (getPaywallTrackingConsent) wraps Phase 22 vanilla-cookieconsent.acceptedCategory('analytics'); strict boolean === true coercion; try/catch around library call for pre-load / throw resilience"
    - "RESEARCH OQ-5 resolution: Phase 39 OWNS the lt_utm_source cookie key; idempotent first-touch write with SameSite=Lax + Secure + 1y max-age"
    - "UI-SPEC Hard Constraint #5 honoured: zero useQuery/useMutation imports; every paywall surface uses useEffect + setState + cancellation flag (mirrors OnboardingABPanel pattern from Phase 34)"
    - "UI-SPEC Typography ramp pinned at 4 sizes (text-sm / text-base / text-xl / text-2xl) + 2 weights (font-normal / font-bold). Screen 6 final-CTA heading uses .font-display (Fraunces) as the single accent moment in the phase"
    - "Dismiss UX uses inline Card primitive (NOT Modal-on-Modal); confirms with Keep watching (primary) / Yes, skip (ghost) per UI-SPEC copy table"
    - "D-06 layer 3 grep-gate-safe split: safety_category field read extracted into safety-carveout.ts so PaywallGate.tsx (which contains the Paywall* identifier) passes the comment-stripped CI gate — uses the gate's own documented option-3 carveout"

key-files:
  created:
    - "leanshot/src/lib/paywall/consent-adapter.ts"
    - "leanshot/src/lib/paywall/consent-adapter.test.ts"
    - "leanshot/src/lib/utm/capture-first-touch.ts"
    - "leanshot/src/lib/utm/capture-first-touch.test.ts"
    - "leanshot/src/components/paywall/PaywallGate.tsx"
    - "leanshot/src/components/paywall/PaywallGate.test.tsx"
    - "leanshot/src/components/paywall/safety-carveout.ts"
    - "leanshot/src/components/paywall/PaywallModal.tsx"
    - "leanshot/src/components/paywall/PaywallModal.test.tsx"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/index.tsx"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/types.ts"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/Screen1.tsx"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/Screen2.tsx"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/Screen3.tsx"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/Screen4.tsx"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/Screen5.tsx"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/Screen6.tsx"
    - "leanshot/src/components/paywall/OnboardingFlowPaywall/__tests__/index.test.tsx"
    - "leanshot/e2e/paywall-mid-trial.spec.ts"
  modified:
    - "leanshot/src/App.tsx"

decisions:
  - "OQ-2 resolution shipped: Phase 22 stores tracking via vanilla-cookieconsent's `acceptedCategory('analytics')` (read-side) — NOT a boolean `tracking` flag. consent-adapter wraps that single call, strict-coerces to boolean === true, and absorbs throws/undefined for the privacy default. Tested with 5 cases."
  - "OQ-5 resolution shipped: Phase 39 OWNS `lt_utm_source` cookie key. capture-first-touch.ts uses URLSearchParams.get (which URL-decodes), guards against existing cookie (first-touch immutability), emits SameSite=Lax + Secure + 1y max-age. App.tsx mounts the call via useEffect (NOT main.tsx) per must_haves clarification (jsdom tests stub window.location after main.tsx init)."
  - "D-14 (6-screen fixed order) shipped via SCREENS literal const + SCREEN_COMPONENTS index array; no admin-configurable count. Plan verify grep `^const SCREENS = ['value-pillar-1'` returns 1."
  - "UI-SPEC accent allowlist enforced: --color-primary only on primary CTAs (Start subscription / Next / Keep watching) and active progress dot."
  - "Single Fraunces accent moment in entire phase: Screen 6 final-CTA heading className=text-2xl font-bold font-display. All other paywall surfaces use Geist (default --font-sans)."
  - "D-06 layer 3 grep gate adaptation (Rule 2 auto-fix): safety_category field read extracted into safety-carveout.ts so PaywallGate.tsx no longer co-occurs with the Paywall* identifier in stripped content. Behaviour unchanged; gate passes."
  - "Adjacent vitest config workaround (per Plan 39-02 SUMMARY deferred-issue) used for verification — top-level vitest.config.ts `projects:[]` array supersedes `test.include`, so `npx vitest run src/...` finds no tests. Adjacent config deleted post-run; not shipped."

metrics:
  duration: "~50 min"
  completed: "2026-05-24"
  commits: 2
  files_created: 19
  tests_added: "27 vitest (5 consent-adapter + 6 capture-first-touch + 5 PaywallGate + 5 PaywallModal + 6 OnboardingFlowPaywall) + 1 Playwright e2e file"
---

# Phase 39 Plan 04: Wave 3 consumer slice A — mid-trial paywall surfaces (single-screen + 6-screen + Gate + adapters) Summary

**Shipped two consumer-visible paywall surfaces (PaywallModal + 6-screen OnboardingFlowPaywall), the PaywallGate cascade wrapper consumed by Plan 39-05, the OQ-2 consent-adapter shim decoupling paywall from Phase 22's library shape, the OQ-5 first-touch UTM cookie writer wired into App.tsx, and a PAYWALL-01 Playwright e2e proof — all in 19 new files + 1 modified, with 27/27 vitest tests green and zero UI-SPEC hard-constraint violations.**

## Performance

- **Started:** 2026-05-24T15:20:00Z (approx — initial worktree setup)
- **Completed:** 2026-05-24T15:30:25Z
- **Duration:** ~50 min
- **Tasks:** 2 / 2 (both fully autonomous; zero checkpoints)
- **Files shipped:** 19 created + 1 modified

## Accomplishments

### Task 1 — consent-adapter + capture-first-touch + PaywallGate (commit `ebc77183`)

- **consent-adapter (OQ-2 resolution):** `src/lib/paywall/consent-adapter.ts` exports `getPaywallTrackingConsent(): boolean` that wraps `vanilla-cookieconsent.acceptedCategory('analytics')` with try/catch + strict-boolean coercion. Privacy default: returns `false` on throw / undefined / non-boolean / non-`true` value. Test suite: 5 cases including the "library not yet loaded" + "library throws" + "library returns string 'yes'" defensive paths.
- **capture-first-touch (OQ-5 resolution):** `src/lib/utm/capture-first-touch.ts` exports `captureFirstTouchUtm(): void`. Reads `URLSearchParams(window.location.search).get('utm_source')`, writes `lt_utm_source` cookie with `SameSite=Lax; Secure; Max-Age=31536000`. Idempotent (first-touch immutable). Test suite: 6 cases including URL-decode + cookie-already-set no-op + idempotency on repeat call + attribute presence.
- **PaywallGate cascade:** `src/components/paywall/PaywallGate.tsx` delegates the safety check to `safety-carveout.ts` (delegates to phaCheck inside try/catch — D-06 layer 2). Cascade: safety carveout (D-05) → consent gate (UI-SPEC #6) → variant-resolver invoke (Plan 39-03). On resolver error / null variant / phaCheck throw: silently falls through to children. Render slot uses `data-testid="paywall-content"` for downstream consumer test assertions. Test suite: 5 cases including safety carveout + consent=false + resolver error + phaCheck throw (synthetic).

### Task 2 — PaywallModal + OnboardingFlowPaywall + App.tsx UTM mount + e2e (commit `a5b487cb`)

- **PaywallModal (Surface A):** Wraps `Modal` primitive (inherits `role="dialog"` + `aria-modal="true"`). On mount when `open && consent`, invokes variant-resolver with `body: { surface: 'paywall' }`. Renders `variant.config.headline` (defaults to `'Start your subscription'`), primary CTA `"Start subscription"`, secondary `"Maybe later"`. On vendor_unconfigured response: Pattern A soft banner. Test suite: 5 cases.
- **OnboardingFlowPaywall (Surface B):** 6-screen state machine; `SCREENS = ['value-pillar-1', 'value-pillar-2', 'value-pillar-3', 'social-proof', 'pricing', 'final-CTA']` (D-14, verified by `grep -c "^const SCREENS = ['value-pillar-1'"` = 1). Per-screen Screen1..Screen6 components consume the standard `ScreenProps` contract (config + onNext + onBack? + onDismiss + stepLabel). Screen 6 heading uses `text-2xl font-bold font-display` (Fraunces — single accent moment in the phase). Progress: sr-only `<p>Step {N} of 6</p>` + visual 6-dot row marked `aria-hidden="true"`; active dot in `--color-primary` (reserved-for list item 3). Dismiss flow uses inline `Card` (NOT Modal-on-Modal) via `data-testid="dismiss-confirm-card"`. Test suite: 6 cases including the full 1→6 advance walk + final heading className assertion + dismiss-card single-dialog assertion.
- **6 Screen presentational components:** Each implements `ScreenProps` and renders a section with `text-xl font-bold` heading (Screens 1-5) or `text-2xl font-bold font-display` (Screen 6). Defaults inline when `config` is missing keys; admin-edited variant copy lands via `variant_config.config` at runtime (per UI-SPEC). All buttons are `Button variant="primary"` (Next / Start subscription) or `Button variant="ghost"` (Back / Not now — keep my trial).
- **App.tsx UTM mount:** `captureFirstTouchUtm()` imported and invoked inside a single empty-deps `useEffect` at the top of the App component body. Idempotent under React StrictMode double-mount. Per must_haves: NOT mounted in `main.tsx` because jsdom tests stub `window.location` after main.tsx init.
- **Playwright e2e (paywall-mid-trial.spec.ts):** PAYWALL-01 end-to-end proof gated on `PLAYWRIGHT_RUN_P39=1` + live Supabase. Seeds `cc_cookie` (Phase 22 acceptedCategory shape) via `page.context().addCookies(...)`, creates a test user via admin client, signs in via magiclink, waits for variant-resolver POST, asserts `[role="dialog"]` + `Start subscription` button visible. Excluded from default chromium run; milestone close-out plan exercises this spec.

## UI-SPEC Hard Constraint Compliance

| Constraint | Status | Evidence |
|------------|--------|----------|
| #1 Typography — exactly 4 sizes (text-sm/text-base/text-xl/text-2xl) + 2 weights (400/700) | PASS | `grep -nE 'text-\[[0-9]+px\]\|font-\[[0-9]+\]' src/components/paywall src/lib/paywall src/lib/utm -r` → no hits |
| #4 Accent reservation — `--color-primary` only on CTAs + active progress dot | PASS | Manual audit: every `bg-[var(--color-primary)]` occurrence is a primary CTA OR the active dot in OnboardingFlowPaywall |
| #5 NO useQuery/useMutation | PASS | `grep -E "import.*useQuery\|import.*useMutation" src/components/paywall src/lib/paywall src/lib/utm -r` → no hits |
| #6 Cookie-consent gate (silent skip) | PASS | PaywallModal + OnboardingFlowPaywall + PaywallGate all return null when `getPaywallTrackingConsent() !== true` — tests assert all three |
| #9 6-screen template fixed order (D-14) | PASS | `grep -c "^const SCREENS = ['value-pillar-1'"` → 1; vitest asserts array equality against 6-element literal |

## Threat Mitigation Status

| Threat ID | Disposition | Evidence |
|-----------|-------------|----------|
| T-39-04-01 GDPR (paywall before consent) | MITIGATED | All 3 paywall surfaces return null when getPaywallTrackingConsent()=false; never enqueue variant-resolver; vitest asserts no `invokeMock` calls when consent=false (3 tests) |
| T-39-04-02 Safety-info paywalled | MITIGATED | PaywallGate via safety-carveout.ts calls phaCheck FIRST and short-circuits when `content.safety_category` non-null; defense-in-depth above ESLint rule from Plan 39-02; vitest case "renders children directly when content has safety_category" passes |
| T-39-04-03 lt_utm_source tampering | ACCEPTED (low value, doc) | Per threat model: server-authoritative user_experiments table records variant assignment on first invoke; subsequent invocations read DB-pinned variant; cookie tampering only affects own first-touch — no cross-user impact |
| T-39-04-04 cohort_id leak in client | MITIGATED | PaywallModal + OnboardingFlowPaywall read only `variant_id` + `config` from resolver response (per Plan 39-03 contract pinned in 39-03-SUMMARY); cohort_id never returned in payload |
| T-39-04-05 Dismiss no record | MITIGATED | variant-resolver captureServer event fires server-side before response per Plan 39-03 — even if user dismisses immediately, the assignment is logged in user_experiments |
| T-39-04-06 DoS (repeat-fire) | MITIGATED | useEffect with `[shouldFetch]` dep + cancellation flag in all 3 surfaces; double-mount under StrictMode handled by cancellation flag (mirrors OnboardingABPanel pattern) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — D-06 layer 3 grep gate carveout via file split] Extracted `shouldShortCircuitForSafety` into safety-carveout.ts**
- **Found during:** Task 1 end-of-task verification (lint:safety run).
- **Issue:** `PaywallGate.tsx` legitimately needs to read `content.safety_category` (it's the gate that ENFORCES the carveout). But the D-06 layer 3 grep gate (`scripts/check-no-paywall-on-safety-category.sh`) flags ANY file with both a `Paywall*` identifier and `safety_category` reference in stripped content. The gate's own help text option 3 suggests "split into two files so the proximity window no longer co-occurs".
- **Fix:** Created `src/components/paywall/safety-carveout.ts` exporting `shouldShortCircuitForSafety(content)` that owns the phaCheck call + safety_category read. `PaywallGate.tsx` now imports the boolean helper only; no longer mentions `safety_category` in its source.
- **Files modified:** `src/components/paywall/PaywallGate.tsx`, `src/components/paywall/safety-carveout.ts` (new)
- **Commit:** `a5b487cb`
- **Verification:** `bash scripts/check-no-paywall-on-safety-category.sh src` → OK; all 27 vitest still pass.

### Adaptations (NOT deviations — driven by pre-existing project infra)

**1. Adjacent vitest config workaround (re-applied from Plan 39-02)**
- Top-level `vitest.config.ts` declares `test.include` AND `projects:[phase38-eval]`. In Vitest 4.x the projects array supersedes the outer config, so `npx vitest run src/lib/paywall ...` collects no tests project-wide. Per Plan 39-02 SUMMARY's deferred-issue note, used adjacent `vitest-39-04.config.ts` ONLY for verification; deleted before commit and not shipped (mirrors 39-02 pattern verbatim).
- This remains a phase-wide carry-over for any future plan that wants src/ unit tests in `<verify>`.

**2. Symlinked node_modules from main repo (per `[[reference_npm_install_worktree_main_drift]]`)**
- Worktree spawns without `node_modules`; symlinked `leanshot/node_modules → /Users/karstenhaldan/minisite/leanshot/node_modules` to avoid `npm install`. Mirrors Plan 39-02 SUMMARY adaptation #4.

### Architectural Changes (Rule 4)
None — both tasks shipped without architectural decisions surfaced.

### Authentication Gates
None — fully autonomous (autonomous=true, no checkpoints).

## Self-Check

| Item | Status | Evidence |
|------|--------|----------|
| `src/lib/paywall/consent-adapter.ts` exists | PASS | `git show ebc77183 --stat` |
| `src/lib/utm/capture-first-touch.ts` exists | PASS | `git show ebc77183 --stat` |
| `src/components/paywall/PaywallGate.tsx` exists | PASS | `git show ebc77183 --stat` |
| `src/components/paywall/PaywallModal.tsx` exists | PASS | `git show a5b487cb --stat` |
| `src/components/paywall/OnboardingFlowPaywall/index.tsx` exists | PASS | `git show a5b487cb --stat` |
| 6 Screen{1..6}.tsx + types.ts created | PASS | `ls src/components/paywall/OnboardingFlowPaywall/Screen*.tsx` → 6 files |
| `src/components/paywall/safety-carveout.ts` exists (Rule 2 split) | PASS | `git show a5b487cb --stat` |
| `e2e/paywall-mid-trial.spec.ts` exists | PASS | `ls e2e/paywall-mid-trial.spec.ts` |
| App.tsx imports + invokes captureFirstTouchUtm | PASS | `grep -n captureFirstTouchUtm src/App.tsx` → 2 hits (import + useEffect call) |
| SCREENS grep verify command passes | PASS | `grep -c "^const SCREENS = ['value-pillar-1'" src/components/paywall/OnboardingFlowPaywall/index.tsx` → 1 |
| Vitest 27/27 GREEN (consent-adapter + capture-first-touch + PaywallGate + PaywallModal + OnboardingFlowPaywall) | PASS | Verified via adjacent vitest-39-04.config.ts before deletion |
| TypeScript clean (`tsc -p tsconfig.app.json --noEmit`) | PASS | Exit 0, no diagnostics |
| lint:safety (D-06 layer 3 grep gate) passes | PASS | `bash scripts/check-no-paywall-on-safety-category.sh src` → OK |
| No useQuery/useMutation imports in paywall code | PASS | `grep -E "import.*useQuery\|import.*useMutation" src/components/paywall src/lib/paywall src/lib/utm -r` → 0 hits |
| No arbitrary text-[Npx]/font-[Nnnn] in paywall files | PASS | `grep -nE 'text-\[[0-9]+px\]\|font-\[[0-9]+\]' src/components/paywall src/lib/paywall src/lib/utm -r` → 0 hits |

## Self-Check: PASSED

All 19 created files + 1 modified file present in disk + 2 commits (`ebc77183`, `a5b487cb`) verified via `git log`. All must_haves truths satisfied. Zero failing verifies. UI-SPEC Hard Constraints 1, 4, 5, 6, 9 all honoured. Threat mitigations applied per `<threat_model>`.

## Carry-Forward

- **Wave 3 sibling Plan 39-05 (pharma surface F)** consumes `PaywallGate.tsx` cascade. Plan 39-05 PharmaContentBlock wraps content with `<PaywallGate content={pharma_content_row} surface="pharma">{...}</PaywallGate>` — the gate's safety-carveout + consent + variant-resolver cascade applies uniformly.
- **Milestone close-out UAT** must run the Playwright e2e once Wave 4 admin surfaces are deployed:
  ```bash
  PLAYWRIGHT_RUN_P39=1 SUPABASE_SERVICE_ROLE_KEY=... npx playwright test e2e/paywall-mid-trial.spec.ts
  ```
  Requires the variant-resolver Edge Fn deployed AND a seeded variant_config row with `surface='paywall'` matching the test user's cohort.
- **Phase 51 UTM map pipeline** will adopt the `lt_utm_source` cookie key set by `captureFirstTouchUtm()` (per RESEARCH OQ-5). Do NOT rename without coordinating both phases.
- **Vitest projects[] config gap** (pre-existing, project-wide): Wave 4 or close-out plan should add a default `unit` project entry to `vitest.config.ts` so `src/**/*.test.{ts,tsx}` collect without needing per-plan adjacent configs. Deferred per SCOPE BOUNDARY of this plan.
