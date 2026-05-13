# Phase 13: Design System v2 Rollout — Plan Outline

**Phase:** 13 — Design System v2 Rollout
**Mode:** standard (mvp granularity in ROADMAP)
**Total plans:** 6
**Total waves:** 2
**Generated:** 2026-05-13
**Source artifacts:** 13-CONTEXT.md (17 D-NN decisions), 13-PATTERNS.md (28 analog files), `.planning/design-system/chats/chat1.md` (landmines)

---

## Two-Wave Sequencing (LOCKED by D-02 + D-11)

- **Wave 1 (PR 1)** — must land alone, FCP/LCP-gated, revertable in one commit. Sets the visual baseline that PR 2 snapshots against.
- **Wave 2 (PR 2)** — every other DS-NN deliverable, parallel-executable by file pathspec (`feedback_parallel_executor_git_isolation.md`). 5 plans run as 4 parallel executors + 1 dependent on the others (visual regression suite captures baselines AFTER components/illustrations/login/marketing land on `main`, per D-06).

---

## Plan Table

| Plan ID | Objective | Wave | Depends On | Requirements |
|---------|-----------|------|------------|--------------|
| **13-01** | **Token swap + font swap + FCP/LCP gate (Wave 1 SOLO).** Mutate `src/index.css` `@theme` block from v1 to v2 (cream `#F2EDE0` + paper-white `#FEFCF7` + warm-tinted shadows + body 16 px floor + paper-grain SVG noise overlay). Swap font `<link>` tags in `index.html:13-37` from Inter/JetBrains-Mono to Geist/Geist-Mono (preserve preload + onload swap pattern; NO `@import` chain per D-10 + chat1.md landmine 2). Wire Lighthouse CI workflow capturing FCP + LCP baseline from current `main` Vercel deploy; assert head FCP delta ≤ 5 % AND LCP delta ≤ 5 % (D-07). Persist baseline in `.planning/phases/13-design-system-v2-rollout/13-FCP-BASELINE.json`. **MUST land alone on main before Wave 2 starts** (D-02). | 1 | — | DS-01, DS-02 |
| **13-02** | **Component refresh: Card + Button + Pill + Sidebar.** Mutate `src/components/ui/Card.tsx` (38 consumers — widen `variant` union with `selected/clickable/tonal/footer`, refresh default radius/shadow/padding to v2). Mutate `src/components/ui/Button.tsx` (57 consumers — add `tonal` variant + counter-chip slot + improved focus/disabled/loading visuals; preserve `aria-busy` + `aria-label` patterns). Mutate `src/components/ui/Pill.tsx` (3 consumers — add segmented control + count badge + icon-only + disabled). Mutate `src/components/layout/Sidebar.tsx` + AppShell wiring for instant 72↔232 px snap WITHOUT `transition: width` (D-12 + chat1.md landmine 1 — use `[data-sidebar=expanded]` selectors + zero width transition; inner content gets 200 ms fade). Keep `useReducedMotion` gating on all motion. NO new consumer files; defaults flow silently to all ~100 call sites. | 2 | 13-01 | DS-05, DS-06, DS-07, DS-08 |
| **13-03** | **Illustration set: mutate 9 + add ~10 + split streak badges (all inline JSX per D-03).** Mutate the 9 existing `src/illustrations/*.tsx` to v2 designs from `.planning/design-system/project/leanshot/src/illustrations/`. Add net-new: `PenInjector`, `AchievementShield`, `ActivityRings`, `DoctorClipboard`, `HeartPulse`, `CalendarDose`, `EmptyPlate`, `EmptyInsights`, `LoginHero`, `HeroOrbital` v2 (mutate existing if present). Split `StreakBadge.tsx` into 4 tier components (`StreakBronze` / `StreakSilver` / `StreakGold` / `StreakLocked`) OR single component with `tier` prop (executor's call — pick whichever has lower consumer-rewrite cost). Site-rotation v2 with zone labels + numbered dots replaces current body diagram inside `BodyTab` / `MedicationTab` consumers. Each component: `size`/`className` props, `useReducedMotion()` gating on motion, `aria-hidden` on decorative SVG, viewBox-driven scaling. Wire `AIAvatar` v2 (organic-mesh) into `AIChatPanel`, topbar, onboarding (DS-11). Wire 4 streak tiers into `StreaksCard` + `ShareCardModal` consumers (DS-10 — watch complications are Phase 21, NOT here). | 2 | 13-01 | DS-09, DS-10, DS-11, DS-12 |
| **13-04** | **Split-screen login restyle (in-place).** Mutate the EXISTING auth view target (file path: `src/components/auth/AuthPage.tsx` or whatever the `'auth'` view in `src/App.tsx:180` renders — executor verifies during pre-flight) to the design-bundle split-screen layout per `.planning/design-system/project/ui_kits/leanshot-app/login.{html,jsx,css}`. Form-RIGHT (Sign in / Sign up segmented tabs using new Pill component from 13-02, Google + Apple SSO, email + password) + hero-LEFT (`<LoginHero />` from 13-03, brand wordmark, headline with Fraunces accent, testimonial card). Responsive: ≥ 768 px split, < 768 px stacks gracefully (D-17 + SC #5). Pin both halves to `100vh` + `overflow: hidden` on `.auth`; `overflow-y: auto` on form half only (chat1.md landmine 4). NO routing change, NO `selectView()` change in `App.tsx` (D-08). Reconcile direction discrepancy with design bundle (bundle is visual source of truth — form-right, hero-left). | 2 | 13-01, 13-02, 13-03 | DS-04 |
| **13-05** | **Marketing Landing refresh (token + illustration swap only).** Mutate `src/components/marketing/Landing.tsx` to pick up new tokens automatically (cascades from 13-01) + swap to new `HeroOrbital` v2 + `AIAvatar` v2 illustration imports (consumed from 13-03). NO structural redesign; this is a token + illustration swap. Reference `.planning/design-system/project/ui_kits/leanshot-marketing/` for any visual choice not covered by the cascade (component layout, copy hierarchy stays unchanged). | 2 | 13-01, 13-03 | DS-03 |
| **13-06** | **Visual regression suite (12 snapshots across 8 surface groups) + focus-ring audit (Wave 2 final).** Add Playwright `toHaveScreenshot` config with `maxDiffPixelRatio: 0.01` (D-04). Author 12 snapshot specs in `tests/visual/` covering D-05 groups: Marketing Landing (light + dark), split-screen login (light), HomeTab (light + dark), MedicationTab (light + dark — token-sensitive: chart colors + site-rotation + titration), BodyTab (light — weight chart + photos + empty state), SettingsPage drawer (light — Button variants + form inputs), OnboardingFlow final summary (multi-step + progress), AIChatPanel idle (avatar v2), AIChatPanel thinking (avatar pulse — reduced-motion fallback). Capture baselines from CI Linux AFTER 13-02..05 land on `main` (D-06). Wire CI hard gate. Manual focus-ring audit checklist as part of plan summary (SC #3). | 2 | 13-02, 13-03, 13-04, 13-05 | DS-02, DS-05, DS-06, DS-07, DS-08, DS-09, DS-10, DS-11, DS-12 |

---

## Requirement Coverage Audit

Every DS-NN ID is owned by at least one plan:

| Requirement | Primary owner | Secondary (verification) |
|-------------|---------------|--------------------------|
| DS-01 (Geist/Geist Mono/Fraunces via `<link>`) | **13-01** | 13-06 (snapshot proof) |
| DS-02 (color/shadow/spacing/radius tokens) | **13-01** | 13-06 (snapshot proof) |
| DS-03 (Marketing Landing refresh) | **13-05** | 13-06 (light + dark snapshots) |
| DS-04 (Split-screen login) | **13-04** | 13-06 (login snapshot) |
| DS-05 (Card variants) | **13-02** | 13-06 (HomeTab + Medication + Body snapshots) |
| DS-06 (Button tonal + counter chips + states) | **13-02** | 13-06 (Settings drawer snapshot) |
| DS-07 (Pill segmented + count badges + icon-only) | **13-02** | 13-06 (login tabs in 13-04 snapshot) |
| DS-08 (Sidebar 72↔232 px instant snap + 200 ms fade) | **13-02** | manual focus-ring audit in 13-06 |
| DS-09 (Site-rotation v2 with zone labels + numbered dots) | **13-03** | 13-06 (MedicationTab + BodyTab) |
| DS-10 (Streak badge tiers — bronze/silver/gold/locked) | **13-03** | 13-06 (HomeTab snapshot) |
| DS-11 (AI avatar organic-mesh) | **13-03** | 13-06 (AIChatPanel idle + thinking) |
| DS-12 (Full illustration set deployed) | **13-03** | 13-06 (BodyTab empty state) |

**No DS-NN is silently omitted. No deferred idea is implemented.**

---

## Wave Visualization

```
Wave 1 (PR 1 — MUST land alone, FCP/LCP-gated):
└── 13-01 (token + font + Lighthouse CI)

Wave 2 (parallel batch — both depend only on 13-01):
├── 13-02 (components: Card/Button/Pill/Sidebar variants)
└── 13-03 (illustrations: mutate 9 + add 10 + StreakBadge 4-tier API)

Wave 3 (parallel batch — both depend on wave-2 plans):
├── 13-04 (login restyle — needs Pill v2 from 13-02 + LoginHero from 13-03)
└── 13-05 (marketing — needs v2 illustrations from 13-03)

Wave 4 (VR baseline capture, depends on all of 13-02..05 on main):
└── 13-06 (visual regression suite + Phase 12 gate verify)
```

**Wave-by-wave dispatch** (corrected after plan-checker iter-2; the original "Wave 2 = PR 2" conflation has been split into 4 dispatch waves while the PR-merge topology stays as the 2-PR ladder per D-02):

- **Wave 1 (SOLO):** 13-01. Token swap + font swap + FCP/LCP gate. MUST merge to `main` before Wave 2 starts (PR 1 of the 2-PR ladder).
- **Wave 2 (Batch A, 2 parallel):** 13-02, 13-03. Disjoint file sets after 13-01 lands.
  - 13-02 owns `src/components/ui/{Card,Button,Pill}.tsx` + `src/components/layout/Sidebar.tsx` + `AppShell.tsx`
  - 13-03 owns `src/illustrations/*.tsx` + consumers `StreaksCard.tsx`, `ShareCardModal.tsx`, `AIChatPanel.tsx`, `Topbar.tsx`, `OnboardingFlow.tsx`, `SiteRotationCard.tsx` (no overlap with 13-02 file set)
- **Wave 3 (Batch B, 2 parallel):** 13-04, 13-05. Both depend on wave-2 plans landing on `main`.
  - 13-04 owns `src/components/auth/**` — consumes Pill v2 segmented (13-02) + `<LoginHero />` (13-03)
  - 13-05 owns `src/components/marketing/Landing.tsx` only — consumes v2 illustration mutations from 13-03 via import-name contract
- **Wave 4 (final):** 13-06. Visual regression baselines captured from CI Linux AFTER 13-02..05 all merge to `main` (D-06).

PR-2 of the 2-PR ladder (D-02) bundles waves 2 + 3 + 4 as the second merge group.

**File-pathspec discipline reminder** (memory `feedback_parallel_executor_git_isolation.md`): every parallel executor uses `git commit -- <pathspec>` to avoid sweeping sibling-plan files.

---

## Memory-Aware Constraints (planner verified, executors must respect)

1. **Index chunk ceiling 50 kB gz** (Phase 12 12-01) — currently ~21 kB. New illustrations are tree-shaken per route. 13-01 + 13-02 + 13-03 combined should add < 5 kB gz to index (illustration consumers route-split). 13-06 must include a bundle-size assertion in the CI gate.
2. **Phase 12 12-02 firewall** (`src/lib/native/*`) — Phase 13 touches NO native files. Lint must continue to pass; 13-06 verifies.
3. **Phase 12 12-04 CSP snapshot** — Phase 13 adds NO new script/style sources (fonts are first-party `<link>` to googleapis allowed in existing CSP — verify in 13-01). 13-06 verifies CSP snapshot test continues to pass.
4. **Sidebar instant-snap WITHOUT `transition: width`** (chat1.md landmine 1) — baked into 13-02 task action as a code comment.
5. **`@import` font chain forbidden** (chat1.md landmine 2) — baked into 13-01 task action.
6. **`flex` + fixed sidebar conflict** (chat1.md landmine 3) — Sidebar stays `position: fixed`; AppShell stays plain block. 13-02 verifies.
7. **Login height stretch** (chat1.md landmine 4) — 13-04 pins `100vh` + `overflow` correctly.

---

## OUTLINE COMPLETE

**Plan count:** 6
**Wave count:** 2
**Parallel-execution batches in Wave 2:** 3 (Batch A: 3 parallel | Batch B: 1 | Batch C: 1)
**Requirements covered:** DS-01..DS-12 (12/12, no gaps)
**Deferred items respected:** onboarding split-screen, watch complications, pricing page, mobile parity, Storybook, dark-theme login (all out-of-scope per `<deferred>` block in 13-CONTEXT.md)
