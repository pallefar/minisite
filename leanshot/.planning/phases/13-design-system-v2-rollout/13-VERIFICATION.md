---
phase: 13-design-system-v2-rollout
verified: 2026-05-13T20:05:00Z
re_verified: 2026-05-17T00:00:00Z
status: passed
score: 5/5 success_criteria_verified
overrides_applied: 0
re_verification_note: |
  DS-12 BLOCKER closed 2026-05-13/14 by Plan 13-07 follow-up commits
  (413ba22, a84ce19, 6c947c9, 366a560, 7f8eb1d, c9d6f8c) — all 6 wiring
  commits under `feat(13-07): wire <Illustration> into <Tab>` pattern.
  All 8 illustrations now have at least one visible consumer render
  in MedicationTab (PenInjector L114, CalendarDose L264) / StreaksCard
  (AchievementShield L63) / ActivityTab (ActivityRings L188) /
  DoctorReport (DoctorClipboard L136) / InsightsTab (HeartPulse L166,
  EmptyInsights L170) / NutritionTab (EmptyPlate L258). All sized
  for visibility (w-12 to w-32). Typecheck green (npx tsc --noEmit).
  Re-verified 2026-05-17 during /gsd-audit-milestone v1.2 follow-up.
gaps:
  - truth: "User sees the full v2 illustration set on every surface that previously had v1 art — pen-injector, achievement-shield, activity-rings, doctor-clipboard, heart-pulse, calendar-dose, empty-plate, empty-insights (SC #4 / DS-12)"
    status: partial
    reason: |
      8 of the 10 net-new illustration components exist as source files in
      src/illustrations/ but are NEVER imported or rendered by any consumer
      surface. They are orphaned artifacts. The user cannot see them on any
      page. Plan 13-03 scoped exactly 6 consumer wirings (Topbar / OnboardingFlow
      / StreaksCard / ShareCardModal / SiteRotationCard / AIChatPanel-no-op)
      which covered DS-09/10/11 only. DS-12 — which lists pen-injector +
      achievement-shield + activity-rings + doctor-clipboard + heart-pulse +
      calendar-dose explicitly as things the user must SEE — was effectively
      down-scoped to "source-files-exist" without anyone declaring that
      down-scope in CONTEXT.md or in a deferral note. The two new illustrations
      that ARE wired are LoginHero (consumed by AuthHero.tsx) and SiteRotation
      (consumed by SiteRotationCard.tsx).
    artifacts:
      - path: "src/illustrations/PenInjector.tsx"
        issue: "Exists but no consumer imports it. grep across src/ returns zero matches outside src/illustrations/."
      - path: "src/illustrations/AchievementShield.tsx"
        issue: "Orphaned — no consumer."
      - path: "src/illustrations/ActivityRings.tsx"
        issue: "Orphaned — no consumer."
      - path: "src/illustrations/DoctorClipboard.tsx"
        issue: "Orphaned — no consumer."
      - path: "src/illustrations/HeartPulse.tsx"
        issue: "Orphaned — no consumer."
      - path: "src/illustrations/CalendarDose.tsx"
        issue: "Orphaned — no consumer."
      - path: "src/illustrations/EmptyPlate.tsx"
        issue: "Orphaned — no consumer."
      - path: "src/illustrations/EmptyInsights.tsx"
        issue: "Orphaned — no consumer."
    missing:
      - "Wire PenInjector into MedicationTab (next-dose / pen-supply card) or HeroCard so it renders for any dashboard user."
      - "Wire AchievementShield into StreaksCard / OnboardingFlow / a milestone surface so it renders."
      - "Wire ActivityRings into ActivityTab (steps / minutes card) so the rings render alongside step data."
      - "Wire DoctorClipboard into a report surface (DoctorReportModal or settings export card)."
      - "Wire HeartPulse into InsightsTab or a dose-day overlay card."
      - "Wire CalendarDose into MedicationTab schedule card or HomeTab next-dose hero."
      - "Wire EmptyPlate into FoodTab / NutritionTab empty state."
      - "Wire EmptyInsights into InsightsTab empty state."
      - "OR — explicitly defer DS-12 wiring of these 8 illustrations to a later phase (e.g. Phase 14 Stripe foundation has no natural home, Phase 18 HealthKit could absorb HeartPulse/ActivityRings, Phase 17 Push could absorb CalendarDose) and update REQUIREMENTS.md DS-12 status to reflect the partial."
human_verification:
  - test: "Open the Vercel preview, sign in with a seed account, then walk every tab (Home / Medication / Body / Activity / Food / Sleep / Symptoms / Insights / Settings) — confirm that PenInjector / AchievementShield / ActivityRings / DoctorClipboard / HeartPulse / CalendarDose / EmptyPlate / EmptyInsights are rendered SOMEWHERE that a user actually navigates to."
    expected: "Each illustration appears on at least one user-reachable surface."
    why_human: "Programmatic grep proves the components are not imported in src/; verification that a user 'sees' them needs a human walking the live surfaces."
  - test: "Run the focus-ring audit checklist (13-06-FOCUS-RING-AUDIT.md) on Card / Button / Pill / Sidebar in light + dark. Tab through every variant, confirm 2 px primary ring with 2 px bg offset is present and contiguous, that disabled buttons suppress the ring, and that the sidebar's `layoutId='sb-active'` motion bar does not obscure the focus ring."
    expected: "All checklist boxes checked PASS; signed sign-off block at the bottom."
    why_human: "Focus rings are visual; the audit is the explicit deliverable; plan 13-06 names this as an outstanding `/gsd-verify-phase 13` task in its 'Open items' section."
  - test: "Dispatch the `visual-baselines.yml` workflow on `main` (Actions tab → Visual baselines regen → Run workflow → reason: 'Phase 13 v2 design rollout — initial baselines'), wait for the PR, review each of the 12 PNG baselines, merge. Then open a no-op test PR and confirm `test-e2e` job passes the VR diff at maxDiffPixelRatio 0.01."
    expected: "Baseline PR opens with 12 PNGs covering the 8 surface groups × light/dark; merge succeeds; downstream no-op PR's test-e2e job runs through the VR diff and passes."
    why_human: "VR baselines must be captured manually via workflow_dispatch (D-06); SC #2 'verified by a visual regression snapshot diff on at least 6 surface screens' cannot be programmatically verified until baselines exist."
  - test: "Run the deployed Vercel preview through Lighthouse with mobile + desktop presets, capture FCP/LCP, confirm delta vs 13-FCP-BASELINE.json (586 ms FCP / 594 ms LCP) is within ±5%."
    expected: "CI lighthouse step's `Assert FCP/LCP delta vs Phase 13 baseline` step prints PASS with FCP delta and LCP delta both <5%."
    why_human: "Production Lighthouse run is end-to-end and requires a live PR (the gate is `if: pull_request`); cannot run during phase-close verification because there's no PR."
  - test: "Manually verify on a ≥ 768 px viewport (desktop browser) that AuthView renders hero LEFT / form RIGHT split-screen, that the LoginHero illustration is visible in the hero column, and that resizing below 768 px collapses to a single column with the hero column hidden."
    expected: "≥ 768 px: hero left + form right; < 768 px: form only, hero hidden."
    why_human: "Visual responsive behavior — Playwright spec (e2e/auth-split-screen.spec.ts) covers it programmatically, but human eyes confirm the visual intent."
---

# Phase 13: Design System v2 Rollout — Verification Report

**Phase Goal:** Every surface (app + marketing + emails + onboarding + auth pages) renders on the v2 token palette and the new component shapes. New illustrations replace the v1 hero/state art. Fonts load via `<link>` tags (NOT CSS `@import` chain) so no FCP regression.

**Verified:** 2026-05-13T20:05:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User loads any page and sees Geist + Geist Mono + Fraunces rendered consistently; FCP within 5% of pre-Phase-13 baseline | VERIFIED | `index.html` lines 25-41 contain 3 byte-identical `<link>` URLs (`preload` + `stylesheet media=print onload` + `<noscript>`) targeting Geist + Geist Mono + Fraunces. `src/index.css:80-82` declares `--font-display: 'Fraunces'`, `--font-sans: 'Geist'`, `--font-mono: 'Geist Mono'`. Zero `@import url(...fonts.googleapis...)` anywhere in `leanshot/` (grep confirmed). `scripts/assert-fcp-lcp-delta.sh` is executable + dry-run PASS at exactly-baseline. `13-FCP-BASELINE.json` committed at 586/594 ms with tolerance_pct=5. CI step wired at `.github/workflows/ci.yml:503-509` inside existing `lighthouse:` job (NOT a new top-level job). **Lighthouse FCP measurement remains a HUMAN verification item (next PR's CI run).** |
| 2 | User navigates marketing→login→dashboard observing consistent tokens — verified by VR snapshot diff on ≥6 surface screens | PARTIAL (infrastructure) | 12 spec files in `leanshot/e2e/visual/*.spec.ts` exist (verified `ls`). `playwright.config.ts:50-54` has `maxDiffPixelRatio: 0.01`. `test-e2e` job has `needs: [test-unit, lint]` chain (`.github/workflows/ci.yml:87`). `visual-baselines.yml` is `workflow_dispatch:` ONLY (no `push`/`pull_request:`). **Baseline PNGs not yet captured** — this is by design (D-06) and is a human-dispatch step. Until baselines exist, the diff gate is non-functional. Flagged for human verification. |
| 3 | User interacts with refreshed Card / Button / Pill / Sidebar without layout shift or focus-ring regressions | VERIFIED | `Card.tsx`: type union extended `default \| elevated \| interactive \| hero \| flat \| selected \| clickable \| tonal \| footer` (`grep` showed all 4 new). `Button.tsx`: `tonal` variant + `count?: number \| string` prop both present. `Pill.tsx`: `count?` + `iconOnly?` + `PillGroup` with `segmented?` boolean. `Sidebar.tsx`: emits `data-sidebar={collapsed ? 'collapsed' : 'expanded'}`; widths are `w-[72px]` / `w-[232px]` discrete classes; zero matches for `transition:\s*width` or `transition-\[width` (chat1 landmine 1 honoured). Focus-ring audit checklist file exists at `13-06-FOCUS-RING-AUDIT.md`. **Focus-ring audit operator sign-off is a HUMAN verification item.** |
| 4 | User sees the new illustration set on every surface that previously had v1 art (AI avatar / streak badges / site-rotation v2 / pen-injector / achievement-shield / activity-rings / doctor-clipboard / heart-pulse / calendar-dose / 4 empty states / hero-orbital) | **FAILED** | All 19 illustration files exist (`ls src/illustrations/` confirmed). However, only 2 of the 10 net-new illustrations are wired to consumers: `LoginHero` (in `AuthHero.tsx:27`) and `SiteRotation` (in `SiteRotationCard.tsx:49`). The other 8 (`PenInjector`, `AchievementShield`, `ActivityRings`, `DoctorClipboard`, `HeartPulse`, `CalendarDose`, `EmptyPlate`, `EmptyInsights`) are NEVER imported outside `src/illustrations/` — grep across `src/` returns zero matches. **Plan 13-03 explicitly scoped 6 wirings covering DS-09/10/11 only**; DS-12's "user sees pen-injector / achievement-shield / activity-rings / doctor-clipboard / heart-pulse / calendar-dose" was effectively down-scoped to "source-files-exist" without a formal deferral. The user cannot see these 8 illustrations anywhere. AIAvatar v2 / HeroOrbital / StreakBadge 4-tier / SiteRotation / LoginHero are correctly wired (DS-09/10/11 satisfied). |
| 5 | User signs in via new split-screen login page (form-right, hero-left at ≥ 768 px, stacked below) | VERIFIED | `AuthView.tsx:55-60` outer `<div>` is `h-screen overflow-hidden grid grid-cols-1 md:grid-cols-[1.1fr_1fr]`; mounts `<AuthHero />` + `<AuthFormShell />`. `AuthHero.tsx:24` uses `hidden md:flex` + imports `LoginHero` from `@/illustrations/LoginHero` (line 18). `AuthFormShell.tsx:67` uses `<PillGroup segmented>` for Sign in / Sign up tabs. `App.tsx` is byte-identical to base (D-08 confirmed by 13-04 SUMMARY git-diff). 6 Phase 5 sub-forms (`SignInForm`, `SignUpForm`, `ForgotPasswordForm`, `SetNewPasswordForm`, `VerifyEmailLanding`, `PostSignupSent`) untouched. Playwright spec at `e2e/auth-split-screen.spec.ts` exists. **Note:** ROADMAP SC #5 says "form left, hero illustration right" but the design bundle + 13-CONTEXT.md D-17 lock hero LEFT / form RIGHT — the 13-04 SUMMARY documents this as an accepted ROADMAP-vs-bundle discrepancy (bundle wins). |

**Score:** 4/5 truths VERIFIED · 1 truth FAILED (SC #4)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `leanshot/src/index.css` (v2 tokens + Geist/Geist Mono/Fraunces) | exists + v2 tokens + v2 fonts | VERIFIED | `--color-cream-100: #f2ede0` (v2), `--font-sans: 'Geist'`, `--font-mono: 'Geist Mono'`, `--font-display: 'Fraunces'` |
| `leanshot/index.html` (3 byte-identical Geist+Geist Mono+Fraunces `<link>` URLs) | exists, preload + stylesheet + noscript | VERIFIED | All three URLs match byte-for-byte (lines 28, 32, 39); preconnect tags preserved (lines 13-14) |
| `leanshot/scripts/assert-fcp-lcp-delta.sh` | exists, executable, reads JSON tolerance | VERIFIED | Mode 755, dry-run PASS with --current-fcp=586 --current-lcp=594 |
| `leanshot/.planning/phases/13-design-system-v2-rollout/13-FCP-BASELINE.json` | exists, FCP/LCP/tolerance documented | VERIFIED | 586 ms FCP / 594 ms LCP / 5% tolerance |
| `.github/workflows/ci.yml` lighthouse FCP/LCP step | exists, wired under existing lighthouse: job | VERIFIED | Lines 503-509; calls `bash leanshot/scripts/assert-fcp-lcp-delta.sh`; NOT a new top-level job |
| `leanshot/src/components/ui/Card.tsx` (9 variants total) | 5 existing + 4 new (selected/clickable/tonal/footer) | VERIFIED | type union widened; variantClasses table extended |
| `leanshot/src/components/ui/Button.tsx` (tonal + count chip) | tonal variant + count prop | VERIFIED | `'tonal'` in ButtonVariant union; `count?: number \| string` typed |
| `leanshot/src/components/ui/Pill.tsx` (count + iconOnly + PillGroup segmented) | new props + segmented variant | VERIFIED | `count?`, `iconOnly?`, `PillGroup.segmented?` all present |
| `leanshot/src/components/layout/Sidebar.tsx` (no `transition: width`) | data-sidebar attribute, discrete 72/232 px widths | VERIFIED | `data-sidebar={collapsed ? 'collapsed' : 'expanded'}` line 79; `w-[72px]` / `w-[232px]` discrete; no `transition:\s*width` matches |
| `leanshot/src/illustrations/` (19 files: 9 v1 + 10 net-new) | all 19 present | VERIFIED | `ls` confirms 19 files; StreakBadge.tsx exports `StreakTier` type + 4 literals |
| `leanshot/src/components/auth/AuthView.tsx` (split-screen) | grid md:cols [1.1fr_1fr] | VERIFIED | line 56 |
| `leanshot/src/components/auth/AuthHero.tsx` | imports LoginHero, hidden md:flex | VERIFIED | line 18 import, line 24 className |
| `leanshot/src/components/auth/AuthFormShell.tsx` | PillGroup segmented for tabs | VERIFIED | line 67 |
| `leanshot/e2e/visual/*.spec.ts` (12 specs ≥ 6 surface groups) | all 12 present | VERIFIED | `ls` confirms 12 spec files |
| `leanshot/e2e/auth-split-screen.spec.ts` | exists | VERIFIED | file present |
| `.github/workflows/visual-baselines.yml` (workflow_dispatch only) | no push, no pull_request | VERIFIED | `on:` block only contains `workflow_dispatch:` |
| `leanshot/playwright.config.ts` maxDiffPixelRatio 0.01 | configured | VERIFIED | line 50-51 |
| `13-06-FOCUS-RING-AUDIT.md` | exists | VERIFIED | file present |

---

## Key Link Verification (Wiring — Level 3)

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| AuthView.tsx | AuthHero.tsx | import + JSX render | WIRED | line 25 import + line 57 render |
| AuthView.tsx | AuthFormShell.tsx | import + JSX render | WIRED | line 24 import + line 58 render |
| AuthHero.tsx | LoginHero illustration | `@/illustrations/LoginHero` import + JSX render | WIRED | line 18 + line 27 |
| AuthFormShell.tsx | PillGroup (segmented) | `@/components/ui/Pill` import + `<PillGroup segmented>` | WIRED | line 67 |
| SiteRotationCard.tsx | SiteRotation illustration | `@/illustrations/SiteRotation` import + JSX render | WIRED | lines 3 + 49 |
| StreaksCard.tsx | StreakBadge 4-tier API | `@/illustrations/StreakBadge` import + `<StreakBadge tier={tier} />` | WIRED | line 5 |
| ShareCardModal.tsx | StreakBadge (visible-DOM) | `@/illustrations/StreakBadge` import + JSX render | WIRED | line 7 |
| Topbar.tsx | AIAvatar v2 | replaces Bot icon | WIRED | line 5 |
| OnboardingFlow.tsx | AIAvatar v2 | adjacent to step-7 H1 | WIRED | line 9 |
| AIChatPanel.tsx | AIAvatar v2 (cascade) | unchanged import — v2 cascades through mutated source | WIRED | line 8 (no-op) |
| Landing.tsx | v2 tokens + 3 v2 illustrations | pure cascade — zero source edits | WIRED | lines 20-22 imports preserved; all colors flow through `var(--color-*)` |
| **(any consumer)** | **PenInjector** | no import found | **NOT_WIRED** | orphan — file exists, no consumer |
| **(any consumer)** | **AchievementShield** | no import found | **NOT_WIRED** | orphan |
| **(any consumer)** | **ActivityRings** | no import found | **NOT_WIRED** | orphan |
| **(any consumer)** | **DoctorClipboard** | no import found | **NOT_WIRED** | orphan |
| **(any consumer)** | **HeartPulse** | no import found | **NOT_WIRED** | orphan |
| **(any consumer)** | **CalendarDose** | no import found | **NOT_WIRED** | orphan |
| **(any consumer)** | **EmptyPlate** | no import found | **NOT_WIRED** | orphan |
| **(any consumer)** | **EmptyInsights** | no import found | **NOT_WIRED** | orphan |

---

## Data-Flow Trace (Level 4)

Not applicable to most Phase 13 artifacts (visual/token changes). The data-flow concerns reduce to:

- StreakBadge tier comes from StreaksCard's count threshold logic — VERIFIED (line 5 `import StreakTier`; tier derived from existing `count` slice in store).
- AuthHero's LoginHero is decorative; no data flow.
- Sidebar collapsed state comes from AppShell-local `useState(false)` — works on first render.

---

## Requirements Coverage

| REQ-ID | Description | Status | Evidence |
|--------|-------------|--------|----------|
| DS-01 | Geist + Geist Mono + Fraunces via `<link>` | SATISFIED | index.html lines 25-41; src/index.css 80-82 |
| DS-02 | Refreshed tokens applied across app + marketing | SATISFIED | v2 cream/border/shadow/text-secondary in src/index.css; Landing.tsx audit confirmed full cascade (zero edits) |
| DS-03 | Marketing Landing refresh with new tokens + illustrations | SATISFIED | Landing.tsx imports AIAvatar/ConnectData/HeroOrbital at lines 20-22; tokens cascade; 13-05 SUMMARY confirms zero source edits needed |
| DS-04 | Split-screen login page with hero illustration | SATISFIED | AuthView/AuthHero/AuthFormShell present; LoginHero wired; 768 px breakpoint via Tailwind `md:` |
| DS-05 | Refreshed Card variants (selected/clickable/tonal/footer) | SATISFIED | type union widened; 4 new variantClasses table entries |
| DS-06 | Refreshed Button (tonal + count chip + states) | SATISFIED | tonal in ButtonVariant; count prop typed; aria-busy/disabled wiring preserved |
| DS-07 | Refreshed Pill (segmented + count + icon-only) | SATISFIED | count/iconOnly props + PillGroup segmented |
| DS-08 | Sidebar 72↔232 px instant collapse + 200 ms inner fade | SATISFIED | data-sidebar attribute; discrete widths; no `transition: width` matches; `transition-opacity duration-200` on inner labels |
| DS-09 | Site-rotation v2 with zone labels + numbered dots | SATISFIED | SiteRotationCard.tsx:49 mounts `<SiteRotation status={status} />` from `@/illustrations/SiteRotation` |
| DS-10 | Streak badge set (bronze/silver/gold/locked) | SATISFIED | StreakBadge.tsx exports `StreakTier` + 4 literals; StreaksCard + ShareCardModal both consume |
| DS-11 | Refreshed AI avatar (organic-mesh) | SATISFIED | AIAvatar v2 in Topbar + OnboardingFlow + AIChatPanel cascade |
| **DS-12** | User sees pen-injector / achievement-shield / activity-rings / doctor-clipboard / heart-pulse / calendar-dose / 4 empty states / hero-orbital | **BLOCKED** | 8 of 10 net-new illustrations have NO consumer in src/. Files exist, but the user cannot see them. HeroOrbital is wired (HeroCard, Landing); other 8 are orphaned. |

**11/12 REQ-IDs SATISFIED · 1 BLOCKED (DS-12).**

---

## Phase 12 Cross-Cutting Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| `assert-bundle-budget.sh` passes — index chunk ≤ 50 kB gz | PASS | exit 0; `2 chunk(s), total gz 137303 bytes; index chunk free of jsPDF identifier` |
| `assert-clinic-bundle-budget.sh` passes | PASS | exit 0; `index chunk OK: 13613 bytes gzipped (Phase 9 working ceiling 24500; absolute ceiling 50000)`; clinic bundle topology OK |
| Firewall ESLint rule on `src/lib/native/*` (`import-x/no-restricted-paths`) | PASS | rule present in `eslint.config.js`; lint on `src/lib/native` clean |
| CSP snapshot test (`tests/csp/`) | PASS | 1 test, 1 passed, 611 ms |
| Bundle ceiling (24.5 kB gz working target / 50 kB absolute) | PASS | index 13.6 kB gz |
| `assert-fcp-lcp-delta.sh` dry-run | PASS | 0.00% delta at exactly-baseline |

All Phase 12 invariants GREEN. Phase 13 did not introduce any regression in bundle ceilings, firewall rule, or CSP allowlist.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| 8 net-new illustration files | n/a (orphans) | Components shipped without any consumer surface | WARNING | DS-12 partial — user cannot see these illustrations anywhere. See gap above. |

No other anti-patterns surfaced. Pre-existing lint failures in `SharePage.tsx` and Phase 8 dead-import warnings (noted by 13-01 and 13-03 SUMMARYs) are out of Phase 13 scope.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Vitest CSP snapshot | `npx vitest run tests/csp/` | 1 test, 1 passed | PASS |
| Bundle budget (overall) | `bash scripts/assert-bundle-budget.sh` | exit 0, OK | PASS |
| Bundle budget (clinic) | `bash scripts/assert-clinic-bundle-budget.sh` | exit 0, OK, index 13.6 kB gz | PASS |
| FCP/LCP delta gate (dry-run) | `bash scripts/assert-fcp-lcp-delta.sh --dry-run --current-fcp=586 --current-lcp=594` | PASS, 0.00% delta | PASS |
| ESLint on src/lib/native | `npx eslint src/lib/native` | clean | PASS |
| Font-import-chain grep | `grep -RIn '@import url(' leanshot/ \| grep fonts.googleapis` | zero matches | PASS |
| Sidebar `transition: width` regression grep | `grep -nE "transition:\s*width\|transition-\[width" src/components/layout/Sidebar.tsx` | zero matches | PASS |
| Orphaned illustration check | `grep -rE "PenInjector\|AchievementShield\|ActivityRings\|DoctorClipboard\|HeartPulse\|CalendarDose\|EmptyPlate\|EmptyInsights" src/ \| grep -v "/illustrations/"` | zero matches | **FAIL** — 8 orphaned components |

---

## Human Verification Required

See `human_verification:` block in frontmatter. Five items:

1. **Manual surface-walk to confirm 8 illustrations actually render** — programmatic grep already says they DON'T; human walk would confirm or contradict.
2. **Focus-ring audit checklist sign-off** — plan 13-06 left this as an explicit `/gsd-verify-phase 13` open item.
3. **Dispatch visual-baselines workflow + observe diff gate** — must be triggered manually; SC #2 fully completes only after baselines exist.
4. **Live Lighthouse FCP/LCP gate observation** — `if: pull_request` step runs on real PRs, not on phase-close.
5. **Responsive viewport check on AuthView** — Playwright covers programmatically; human eyes confirm visual intent.

---

## Gaps Summary

**One BLOCKER:**

- **SC #4 / DS-12 — 8 net-new illustrations are orphaned source files.** PenInjector, AchievementShield, ActivityRings, DoctorClipboard, HeartPulse, CalendarDose, EmptyPlate, EmptyInsights all exist in `src/illustrations/` but are never imported, rendered, or referenced anywhere else in `src/`. The ROADMAP SC #4 promises the user "sees the new illustration set on every surface that previously had v1 art" and explicitly lists every one of these 8 components. REQ DS-12 makes the same promise. With no consumer surface, the user cannot see any of these illustrations.

  **Either** add consumer wirings (≈ 8 single-import-plus-JSX edits across MedicationTab / ActivityTab / InsightsTab / FoodTab / DoctorReportModal / appropriate empty-states), **or** formally defer the DS-12 wiring of these 8 components to a later phase (Phase 17 Push could absorb CalendarDose; Phase 18 HealthKit could absorb HeartPulse + ActivityRings; the others lack a natural downstream home) and update REQUIREMENTS.md DS-12 to reflect that this phase shipped source-only.

**Note on SC #4 partial credit:** AIAvatar v2 (DS-11), HeroOrbital, StreakBadge 4-tier (DS-10), SiteRotation v2 (DS-09), and LoginHero (DS-04 only) ARE correctly wired. The 4 v1-existing empty-state illustrations (EmptyInjections / EmptyPhotos / EmptySymptoms / Vial) cascade automatically through their pre-existing consumers (MedicationTab / BodyTab / SymptomsTab). The gap is strictly the 8 net-new ones.

**Five HUMAN verification items** — each spelled out in frontmatter.

---

## Re-verification Path

When this phase is re-verified after gap closure, focus on:

1. Walk `src/` and confirm at least one consumer import of each of: PenInjector, AchievementShield, ActivityRings, DoctorClipboard, HeartPulse, CalendarDose, EmptyPlate, EmptyInsights. **OR** confirm REQUIREMENTS.md DS-12 entry has been updated to a deferred/partial status with explicit rationale.
2. Quick regression check on Phase 13 invariants that already passed (illustration files still exist; tokens still v2; index.html still byte-identical fonts; budget scripts still GREEN).
3. Mark the 5 human-verification items as either completed (with evidence) or carried forward.

---

_Verified: 2026-05-13T20:05:00Z_
_Verifier: Claude (gsd-verifier)_
