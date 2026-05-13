# Phase 13 — Discussion Log

**Date:** 2026-05-13
**Workflow:** `/gsd-discuss-phase 13 leanshot`
**Mode:** default (interactive)

---

## Areas Selected for Discussion

User selected ALL 4 proposed gray areas (multiSelect):
1. Component refresh strategy
2. Illustration delivery format
3. Visual regression tooling + surfaces
4. Login page route + onboarding integration

---

## Area 1 — Component refresh strategy

### Q1: Refresh style for Card / Button / Pill / Sidebar against ~100 call sites

**Options presented:**
- Refresh-in-place + add variants (Recommended)
- Side-by-side v2 (CardV2/ButtonV2/etc.)
- Refresh-in-place, NO new variants this phase

**User chose:** Refresh-in-place + add variants (Recommended)
**Rationale captured in CONTEXT:** D-01. Lowest churn, visual regression catches unintended drift; the design bundle anticipates these variants and downstream phases (14/15) would end up adding them anyway.

### Q2: PR sequencing

**Options presented:**
- Two-PR ladder: tokens → components (Recommended)
- Multi-PR ladder per surface
- Single mega-PR

**User chose:** Two-PR ladder
**Rationale captured in CONTEXT:** D-02. Matches goal's "tokens-only FIRST" phrasing; clean FCP rollback granularity.

---

## Area 2 — Illustration delivery format

### Q1: Format for the v2 illustration set

**Options presented:**
- All inline JSX components (Recommended)
- Static .svg files in /public/illustrations/
- Hybrid: inline-JSX for animated, static .svg for decorative

**User chose:** All inline JSX components (Recommended)
**Rationale captured in CONTEXT:** D-03. Matches existing pattern (9 illustrations already inline JSX with `useReducedMotion` gating). Inline preserves TS-typed props, reduced-motion gating, and `thinking={true}` imperative hooks. Tree-shaking per React.lazy route keeps bundle in check.

**Scope clarification:** ~10 net-new components to add: `PenInjector`, `AchievementShield`, `ActivityRings`, `DoctorClipboard`, `HeartPulse`, `CalendarDose`, `EmptyPlate`, `EmptyInsights`, `LoginHero`, plus 4 streak-badge tiers (bronze/silver/gold/locked).

---

## Area 3 — Visual regression tooling + surfaces

### Q1: VR tool choice

**Options presented:**
- Playwright `toHaveScreenshot` (Recommended)
- Chromatic (Storybook-hosted cloud diff)
- Percy by BrowserStack

**User chose:** Playwright `toHaveScreenshot` (Recommended)
**Rationale captured in CONTEXT:** D-04. Zero new deps (Playwright already wired for CSP tests), zero auth wall (per `feedback_mcp_auth_walls_block_full_automation`). Storybook scaffolding rejected — 2–3 days net-new infra not in Phase 13 scope.

### Q2: Surfaces in the suite

**Options presented (multiSelect):**
- Marketing Landing + Split-screen Login
- Home tab + Medication tab (light + dark each)
- Body tab + Settings drawer
- Onboarding flow + AI Chat panel (Recommended for thoroughness)

**User chose:** ALL FOUR groups
**Rationale captured in CONTEXT:** D-05. Aggressive coverage per `feedback_aggressive_foundations.md` (Phase 13 is end-user-facing UX). 12 snapshots total across 8 surface groups — exceeds SC #2's ≥6 mandate.

---

## Area 4 — Login page route + onboarding integration

### Discovery during discussion

While preparing options, scouting `src/App.tsx:177–269` revealed the repo ALREADY has an `'auth'` view (added in Phase 5 D-01), triggered by `#/auth/*` hash routes and any unauthenticated `/clinic/*` path. The DS-04 split-screen design is therefore the **visual restyle** of an existing view, not a net-new route. Question framing was adjusted accordingly.

### Q1: Login integration

**Options presented:**
- Restyle existing 'auth' view in place (Recommended)
- Promote split-screen to net-new entry for unauthed users
- Split-screen login + marketing landing redesign side-by-side

**User chose:** Restyle existing 'auth' view in place (Recommended)
**Rationale captured in CONTEXT:** D-08. NO routing change; preserves the local-first new-user flow (marketing → onboarding without sign-in) mandated by CLAUDE.md.

### Q2: Onboarding refresh scope

**Options presented:**
- Token swap only, keep full-screen layout (Recommended)
- Match onboarding to split-screen rhythm

**User chose:** Token swap only, keep full-screen layout (Recommended)
**Rationale captured in CONTEXT:** D-09. Design bundle has no onboarding mock; subjective design choices would need an iteration cycle outside Phase 13 scope. SC #5 explicitly scopes the LOGIN split-screen.

---

## Claude's Discretion (NOT asked, captured for transparency)

Locked from goal text (already-decided, no question needed):
- D-10: Fonts via `<link>` + preconnect (NOT `@import` chain) — goal phrasing + chat1.md landmine 2.
- D-11: Token swap lands FIRST — goal phrasing.
- D-12: Sidebar 72↔232 px instant snap, 200 ms inner fade — goal phrasing + chat1.md landmine 1.
- D-13: FCP ≤ 5 % delta — SC #1; mechanism (Lighthouse CI before/after on `main`) is D-07.
- D-14–17: Inherited from SC verbatim.

Locked from design bundle (already-decided in `.planning/design-system/`):
- Token VALUES (cream `#F2EDE0`, surface `#FEFCF7`, warm shadows, body 16 px floor, paper-grain noise).
- Font STACK (Geist + Geist Mono + Fraunces).
- 24 illustrations to deliver (9 mutate + ~10 new + 4 streak tiers + 1 login-hero).
- Component variant SET (Card 5 vars, Button tonal+counter, Pill segmented+count+icon-only, Sidebar instant snap + fade).
- Split-screen login LAYOUT (form-right ~48 %, hero-left ~52 %).

Locked from memory carryovers:
- VR coverage breadth: 8 surface groups not 6 (`feedback_aggressive_foundations.md`).
- PR-2 wave structure should respect pathspec isolation (`feedback_parallel_executor_git_isolation.md`).

---

## Deferred Ideas

- Onboarding split-screen refresh (future polish phase).
- Watch complication streak badge rendering (Phase 21 WATCH-05).
- Pricing page styling (Phase 15 page builder).
- Mobile Capacitor token overrides (Phase 16).
- Storybook scaffolding (future team-growth phase).
- Dark-theme login snapshot (follow-up if it diverges).

---

## Open Pre-flight Items for Planner

- Verify the exact file path of the `'auth'` view component (D-08 restyle target).
- Confirm Lighthouse CI is wired in `.github/workflows/`; scaffold as PR 1 dependency if absent.
- Reconcile ROADMAP SC #5 ("form left, hero illustration right") with design bundle (form-right, hero-left) — bundle is the visual source of truth.
- Read `chat1.md` landmines into the Sidebar plan as in-source comments.
