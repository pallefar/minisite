# Phase 13: Design System v2 Rollout - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

**First end-user-facing v1.2 phase.** Phase 12 shipped CI/operational foundations (firewall, bundle ceilings, CSP snapshot, vendor scaffolds). Phase 13 swaps the v1 design palette and component shapes for the v2 system mocked in `.planning/design-system/` (Claude Design bundle, chats at `.planning/design-system/chats/chat1.md`). After this phase, every surface that already exists (marketing Landing, dashboard tabs, settings, onboarding, AI panel, auth) renders on the v2 token palette and refreshed components, and every later v1.2 phase (Stripe pricing, page builder, mobile shells, etc.) inherits the new tokens for free.

**In scope:**

1. **Token swap** — `src/index.css` `@theme` block values migrate from v1 (`--color-cream-100: #efebe0`) to v2 (`#F2EDE0` cream + `#FEFCF7` paper-white surface + warm-tinted shadows `rgba(40,32,20,…)` + body 16 px floor + paper-grain SVG noise overlay). Tailwind v4 plumbing already exists — values change, structure doesn't.
2. **Font swap** — Inter → Geist (sans), JetBrains Mono → Geist Mono (mono). Fraunces stays as the display/italic accent. Load via `<link>` + preconnect (NOT `@import` chain — chat1.md proves the chain breaks in iframe contexts).
3. **Component refresh (in-place, additive variants)** — `src/components/ui/{Card,Button,Pill,Sidebar}.tsx` get refreshed defaults + new variants: Card adds `selected/clickable/tonal/footer` to existing `default/elevated/hero`; Button adds `tonal` variant + counter-chip slot + better focus/disabled/loading states; Pill adds segmented control + count badge + icon-only; Sidebar gets instant 72↔232 px snap (NO width transition — `var()` can't be interpolated without `@property` registration; chat1.md hit this bug 4 rounds in a row) + 200 ms inner-content fade.
4. **Illustrations** — mutate the 9 existing files in `src/illustrations/*.tsx` to the v2 designs from the bundle, plus add ~10 net-new components: `PenInjector`, `AchievementShield`, `ActivityRings`, `DoctorClipboard`, `HeartPulse`, `CalendarDose`, `EmptyPlate`, `EmptyInsights`, `LoginHero`, plus 4 streak-badge tier components (bronze/silver/gold/locked) replacing the single `StreakBadge.tsx`. Site-rotation v2 with zone labels + numbered rotation dots replaces the current body diagram inside `BodyTab` / `MedicationTab`.
5. **Split-screen login** — restyle the EXISTING `'auth'` view (Phase 5 D-01, triggered by `#/auth/*` hash + unauthed `/clinic/*` paths) to the design-bundle layout: form-right (Sign in / Sign up segmented tabs, Google + Apple SSO, email + password) + hero-left (`<LoginHero />`, brand, headline with Fraunces accent, testimonial card). NO new routing logic — same view ID, new layout.
6. **Marketing landing refresh** — `src/components/marketing/Landing.tsx` picks up new tokens + uses new illustrations (`HeroOrbital` v2, `AIAvatar` v2). No structural redesign — token swap + illustration swap only.
7. **Visual regression suite** — Playwright `toHaveScreenshot` across 12 snapshots (8 surface groups, see D-08). Stored in `tests/visual/__screenshots__/`, baseline captured from CI Linux. SC #2 hard gate.
8. **FCP baseline gate** — capture FCP on `main` before the token-swap PR merges; verify post-merge FCP is within 5% on the same CI hardware. SC #1 hard gate.

**Explicitly NOT in scope:**
- Onboarding split-screen refresh (token swap only — keep full-screen layout; design bundle has no onboarding mock; D-07).
- Watch face complication streak badges (DS-10 mentions watch; that's Phase 21 WATCH-05 consumer — Phase 13 only ships the badge React components).
- Pricing page (Phase 15 page builder owns this).
- Any future marketing surfaces beyond `Landing.tsx`.
- Storybook scaffolding (we picked Playwright `toHaveScreenshot`, not Chromatic).
- Side-by-side v2 component files (we picked refresh-in-place; D-01).

</domain>

<canonical_refs>
## Canonical References

**Design source (MUST READ before research/planning):**
- `.planning/design-system/README.md` — bundle index + visual foundations
- `.planning/design-system/chats/chat1.md` — full back-and-forth with the design assistant (970 lines, captures intent + landmines like the sidebar `transition: width` bug + the `@import`-in-iframe font-loading bug)
- `.planning/design-system/colors_and_type.css` — token specimen file (final values)
- `.planning/design-system/project/leanshot/src/index.css` — Tailwind v4 `@theme` source-of-truth for the v2 tokens
- `.planning/design-system/project/leanshot/src/components/` — refreshed Card / Button / Pill / Sidebar JSX prototypes
- `.planning/design-system/project/leanshot/src/illustrations/` — 9 refreshed inline-JSX illustration components
- `.planning/design-system/project/ui_kits/leanshot-app/` — full dashboard prototype (`app.jsx`, `cards.jsx`, `tabs.jsx`, `app-components.css`, `shell.jsx`)
- `.planning/design-system/project/ui_kits/leanshot-app/login.html` + `login.jsx` + `login.css` — split-screen login reference for DS-04
- `.planning/design-system/project/ui_kits/leanshot-marketing/` — refreshed marketing Landing reference
- `.planning/design-system/project/assets/*.svg` — 24 static SVG exports (for reference; we deliver as inline JSX per D-03)

**Project plumbing:**
- `.planning/ROADMAP.md` (line 56) — Phase 13 goal + success criteria + DS-01..12 requirement list
- `.planning/REQUIREMENTS.md` (lines 21–36) — DS-01..12 detailed acceptance lines
- `leanshot/CLAUDE.md` — repo stack + architecture (router-less, Zustand store, `src/components/ui/*` primitives, `useReducedMotion` hook)
- `src/index.css` — current Tailwind v4 `@theme` block (already structured for token swap)
- `src/App.tsx:177–269` — view selector with existing `'auth'` view (Phase 5 D-01); login restyle target
- `src/components/ui/{Card,Button,Pill,Sidebar,Sheet,Modal}.tsx` — primitives to refresh in place
- `src/illustrations/*.tsx` — 9 existing inline-JSX illustration components (9 mutate + ~10 add)
- `playwright.config.ts` + `tests/csp/` — Playwright already wired; visual regression suite extends here
- `index.html:13–37` — existing `<link>` font-loading pattern with `preload` + `onload` swap (Phase 2.1 perf fix); the Geist/Geist-Mono URLs replace the Inter/JetBrains-Mono URLs here

**Memory carryovers (LeanShot reference):**
- `feedback_aggressive_foundations.md` — Phase 13 is end-user-facing UX → aggressive on coverage (locked: 8 surface groups in VR, not 6)
- `feedback_regulator_vs_user_audience_pattern.md` — operator UX = end-user (not process); same rule applies to design rollout
- `reference_bundle_budget_hash_hyphen.md` — chunk budgets re-set by Phase 12; new illustration components must fit
- `feedback_parallel_executor_git_isolation.md` — Wave-based execution: tokens PR ships solo; component+illustration+login PR can parallel-execute by file pathspec

</canonical_refs>

<code_context>
## Reusable Assets + Patterns

**Already exists, reuse directly:**
- Tailwind v4 `@theme` block in `src/index.css` — same structure, values migrate.
- `useReducedMotion` hook (`src/hooks/useReducedMotion.ts`) — required pattern for any new animated illustration (`AIAvatar`, `HeroOrbital`, login hero orbital motion).
- `cn()` helper (`src/lib/helpers.ts`) — class composition; used by every UI primitive.
- `applyThemeToDOM()` in `src/hooks/useTheme.ts` — pre-paint theme application; v2 tokens flow through this unchanged.
- `data-theme="light"` / `data-theme="dark"` on `<html>` — token overrides via `[data-theme=dark]` selector in `index.css`.
- Card has `variant` prop today (`default/elevated/hero`) — additive (`selected/clickable/tonal/footer`) needs prop union widening, not a rewrite.
- `'auth'` view in `src/App.tsx:180` — restyle target for DS-04, no routing change.
- Playwright already configured with CSP test in `tests/csp/` — visual regression suite adds `tests/visual/`.

**Consumer counts (from grep):**
- `<Card>` — 38 files
- `<Button>` — 57 files
- `<Pill>` — 3 files
- Sidebar — single consumer (`AppShell.tsx`)

**Bundle ceiling context (Phase 12 set the caps):**
- Index chunk ceiling: 50 kB gz (currently ~21 kB gz post-Phase 10).
- Each illustration component is ~0.5–1.5 kB gz inline; ~20 components → ~15–25 kB total but tree-shaken per route (only ones a route imports ship in that chunk).
- Geist + Geist Mono replacing Inter + JetBrains Mono is roughly net-neutral in network weight (both ~30–40 kB of font subsetting).
- New token additions to `index.css` are CSS — counted under critical CSS, not JS bundle.

**Known landmines (from chat1.md):**
1. `transition: width` on `.sidebar` where width is set via `var(--sidebar-w)` does NOT animate without `@property` registration. Use explicit `[data-sidebar=expanded] .sidebar { width: 232px }` selectors + zero transition on width. Inner content gets the 200 ms fade instead.
2. Triple-chained `@import` for fonts (HTML → app.css → tokens.css → fonts.googleapis.com) stalls in iframe contexts. Always direct `<link>` tags in `<head>`.
3. `display: flex` on `.app-shell` + `flex: 1` on `.app-main` breaks `position: fixed` sidebar's `margin-left: var(--sidebar-w)`. Sidebar is fixed-positioned; shell is a plain block container.
4. Login page hero side stretches when `.auth` has default grid behavior. Pin both halves to `100vh` + `overflow: hidden` on `.auth`; `overflow-y: auto` on the form half only.

</code_context>

<decisions>
## Implementation Decisions

### Component refresh strategy

- **D-01 (LOCKED, refresh style):** **Refresh-in-place + additive variants.** Mutate `src/components/ui/{Card,Button,Pill,Sidebar}.tsx` directly. Update default shapes (radius, shadows, padding) AND add new variants as additive props. All ~100 consumers pick up new defaults silently; visual regression suite (D-04) catches any unwanted change. **Rejected:** side-by-side `CardV2.tsx` files (doubles surface area + bundle, mixed v1/v2 UI defeats the "visually current" goal of SC #2). **Rejected:** refresh-in-place without new variants (the design bundle anticipates `selected/clickable/tonal/footer` etc. and downstream Phase 14/15 would end up adding them in scattered PRs anyway).

- **D-02 (LOCKED, PR sequencing):** **Two-PR ladder.**
  - **PR 1 (token swap)** — `src/index.css` `@theme` block value migration + font `<link>` swap in `index.html` + FCP baseline gate. Revertable in one commit. Verified by FCP delta ≤5% AND the visual regression suite passing (already-existing snapshots will drift, but the SC is to assert NEW v2 snapshots match — see D-04 sequencing note).
  - **PR 2 (components + illustrations + login + marketing)** — every other DS-NN deliverable. Parallel-executable by file pathspec (per `feedback_parallel_executor_git_isolation.md`).
  - **Rejected:** multi-PR-per-surface ladder (5× review overhead, risk of intermediate states like new-components-on-old-tokens shipping to main). **Rejected:** single mega-PR (no FCP rollback granularity).

### Illustrations

- **D-03 (LOCKED, illustration format):** **All inline JSX components.** Mutate the 9 existing `src/illustrations/*.tsx` files to v2 designs + add ~10 net-new components: `PenInjector`, `AchievementShield`, `ActivityRings`, `DoctorClipboard`, `HeartPulse`, `CalendarDose`, `EmptyPlate`, `EmptyInsights`, `LoginHero`, plus split `StreakBadge.tsx` into `StreakBronze` / `StreakSilver` / `StreakGold` / `StreakLocked` (or a single component with `tier` prop — planner's call). Each follows the existing pattern: `size`/`className` props, `useReducedMotion()` gating on any motion, `aria-hidden` on decorative SVG, viewBox-driven scaling. **Rejected:** static `.svg` files in `/public` (loses reduced-motion gating + TS-typed props; thinking/animated states require imperative React state). **Rejected:** hybrid (two import patterns to remember; harder to retheme uniformly).

### Visual regression + FCP gate

- **D-04 (LOCKED, VR tool):** **Playwright `toHaveScreenshot`** with `maxDiffPixelRatio: 0.01` (1 % fuzziness for font subpixel rendering). Snapshots stored in `tests/visual/__screenshots__/` and committed to repo. CI Linux is the baseline (snapshots regenerated via `--update-snapshots` only on opt-in label). **Rejected:** Chromatic (requires Storybook scaffolding — 2–3 days net-new infra + auth wall + $$). **Rejected:** Percy (auth wall, paid plan above 5 k snapshots, same caveats).

- **D-05 (LOCKED, VR surfaces — 12 snapshots across 8 groups):**
  1. Marketing `Landing.tsx` — light theme
  2. Marketing `Landing.tsx` — dark theme
  3. Split-screen login (`'auth'` view) — light theme
  4. Dashboard `HomeTab` — light theme
  5. Dashboard `HomeTab` — dark theme
  6. Dashboard `MedicationTab` — light theme (highest token sensitivity: chart colors + site-rotation v2 + titration plan)
  7. Dashboard `MedicationTab` — dark theme
  8. Dashboard `BodyTab` — light theme (weight chart + photos grid + empty-state illustration)
  9. `SettingsPage` drawer — light theme (Button variants + form inputs)
  10. `OnboardingFlow` — final summary step (multi-step Button + progress flow)
  11. `AIChatPanel` — idle state (new AI avatar v2 organic mesh)
  12. `AIChatPanel` — thinking state (avatar animated pulse — reduced-motion variant covered by static fallback path)
  - SC #2 mandates ≥6; we ship 12 because operator/end-user-facing UX gets aggressive coverage (`feedback_aggressive_foundations.md`).

- **D-06 (LOCKED, VR sequencing):** Baseline snapshots captured AFTER token swap PR merges to `main` (snapshots are the new normal). Pre-token-swap state is verified by manual visual review + FCP gate; visual regression suite enforces stability from PR 2 onward. **Rationale:** we are explicitly drifting the visual baseline; pre-drift snapshots have no value, post-drift snapshots become the regression gate.

- **D-07 (LOCKED, FCP gate):** Capture FCP from current `main` (production Vercel deploy via Lighthouse CI) **before** PR 1 merges — record in `13-FCP-BASELINE.json` (or similar). Run same Lighthouse CI on PR 1 head — assert FCP delta ≤ 5 % AND LCP delta ≤ 5 % (LCP added defensively; the new paper-grain SVG noise overlay is a potential LCP regression vector). Hard CI gate.

### Login + routing + onboarding fit

- **D-08 (LOCKED, login routing):** **Restyle the existing `'auth'` view in place.** The view ID already exists in `src/App.tsx:180` (Phase 5 D-01). Mutate `src/components/auth/AuthPage.tsx` (or equivalent — planner verifies file path) to the design-bundle split-screen layout. NO new routing logic, NO change to `selectView()` in `App.tsx`. Marketing landing → onboarding flow for net-new local users is preserved (CLAUDE.md "local-first must continue to work" constraint). **Rejected:** promoting split-screen to net-new entry (breaks local-first; conflicts with Phase 5 auth-bridge wiring). **Rejected:** dual marketing+auth split-screen refresh (more work, no SC mandate).

- **D-09 (LOCKED, onboarding fit):** **Token swap only — keep full-screen layout.** `OnboardingFlow.tsx` inherits new tokens automatically (paper-white surface, warm shadows, Geist) — no structural redesign. The design bundle has no onboarding mock; subjective design choices would need an iteration cycle that doesn't fit Phase 13. SC #5 explicitly mentions the LOGIN split-screen; onboarding is silent in DS-01..12.

### Inherited from goal text (no re-decision needed)

- **D-10:** Fonts via `<link>` + preconnect in `<head>`, NOT `@import` chain (goal + chat1.md proof).
- **D-11:** Tokens-only swap lands FIRST (PR 1), components/illustrations/login second (PR 2) — goal phrasing.
- **D-12:** Sidebar 72↔232 px instant snap, 200 ms inner-content fade — goal phrasing + chat1.md landmine 1.
- **D-13:** FCP within 5 % of pre-Phase-13 baseline — SC #1; mechanism in D-07.
- **D-14:** Visual regression snapshot diff on at least 6 surface screens — SC #2; we ship 12 (D-05).
- **D-15:** Refreshed Card / Button / Pill / Sidebar without layout shift or focus-ring regressions — SC #3.
- **D-16:** Refreshed AI avatar (organic mesh) across `AIChatPanel`, topbar, onboarding — DS-11.
- **D-17:** Split-screen login responsive at ≥ 768 px breakpoint, gracefully stacks below — SC #5.

</decisions>

<deferred>
## Deferred Ideas

- **Onboarding split-screen refresh** — Phase 13 only token-swaps `OnboardingFlow.tsx`. Future phase (likely Phase 22 lifecycle email tie-in or a v1.3 polish pass) can adopt the split-screen rhythm with proper design iteration.
- **Watch complication streak badge rendering** — DS-10 mentions watch surfaces; Phase 13 ships the React badge components; Phase 21 WATCH-05 wires them to watchOS / Wear OS complications.
- **Pricing page styling** — Phase 15 page builder owns this; will inherit Phase 13 tokens automatically.
- **Cross-platform parity polish** (mobile Capacitor shell tokens) — Phase 16 owns mobile shells; mobile reads the same web tokens by default, but native-specific overrides (status-bar colors, safe-area-inset padding) are a Phase 16 concern.
- **Storybook scaffolding** — rejected for Phase 13 but worth revisiting in a future polish phase if the team grows; would help isolated component review and Chromatic adoption later.
- **Dark theme login** — Phase 13 ships light-theme login snapshot only; dark login is a follow-up if the dark-mode `'auth'` view diverges enough to warrant a dedicated baseline.

</deferred>

<scope_guardrail>
## Scope Guardrail

**Phase 13 ships token + component + illustration + login + marketing visual refresh.** It does NOT add new capabilities — no new tabs, no new modals, no new auth flows, no new routes, no new SDK integrations. The Phase 12 firewall + bundle ceilings + CSP snapshot all stay green.

**If something surfaces during research/planning/execution that looks like scope creep:**
- New tab / new modal → defer to a future phase or skip.
- New SDK / new vendor dependency → defer (every vendor add is its own phase entry per `feedback_vendor_account_circular_dependency.md`).
- Onboarding flow restructure → D-09 LOCKS this out; capture as deferred idea.
- Pricing page → Phase 15 owns; defer.

</scope_guardrail>

<success_criteria_carry>
## Success Criteria (verbatim from ROADMAP Phase 13)

1. User loads any page (marketing landing, login, dashboard home, any tab) and sees Geist (body) + Geist Mono (numeric/code) + Fraunces (display) rendered consistently; **FCP on cold load is within 5 % of pre-Phase-13 baseline** (no font-loading regression). — Enforced by D-07.
2. User navigates from marketing site → login → dashboard and observes consistent color / shadow / spacing / radius tokens — **verified by a visual regression snapshot diff on at least 6 surface screens.** — Enforced by D-04 + D-05 (12 snapshots).
3. User interacts with refreshed Card (5 variants), Button (tonal + counter chips + loading), Pill (segmented + count badges + icon-only), and Sidebar (instant 72↔232 px collapse + 200 ms inner fade) **without layout shift or focus-ring regressions.** — Enforced by visual regression suite + manual focus-state review.
4. User sees the new illustration set on every surface that previously had v1 art: AI avatar (organic-mesh), streak badges (bronze/silver/gold/locked), site-rotation v2 with zone labels + numbered dots, pen-injector, achievement-shield, activity-rings, doctor-clipboard, heart-pulse, calendar-dose, 4 empty states, hero-orbital. — Enforced by D-03 illustration component delivery.
5. User signs in via the new split-screen login page (form left, hero illustration right) — verified responsive at ≥ 768 px breakpoint and gracefully stacking below. — Enforced by D-08. (Note: ROADMAP says "form left, hero illustration right" but design bundle has form-right, hero-left — planner: reconcile with the design bundle; bundle is the visual source of truth.)

</success_criteria_carry>

<next_step>
**Next:** `/clear` then `/gsd-plan-phase 13 leanshot` (or `/gsd-plan-phase 13 leanshot --chunked` since Phase 13 is bounded but multi-faceted — token + components + illustrations + login + marketing + VR suite + FCP gate ≈ 6 plans; chunked parallel planning will be faster).

**Pre-flight checks for the planner:**
- [ ] Verify `src/components/auth/AuthPage.tsx` exists (or find the equivalent file the `'auth'` view renders) for D-08 restyle target.
- [ ] Confirm Lighthouse CI is wired in `.github/workflows/` (D-07) — if not, scaffold it as PR 1 dependency.
- [ ] Re-read `feedback_parallel_executor_git_isolation.md` before designing the PR-2 wave structure (token/component/illustration/login files are mostly independent → parallel-executable by pathspec).
- [ ] Don't forget the design bundle's chat1.md landmines (D-12, sidebar `var()` transition bug) — bake into the Sidebar plan as a "do NOT use `transition: width`" comment in source.

</next_step>
