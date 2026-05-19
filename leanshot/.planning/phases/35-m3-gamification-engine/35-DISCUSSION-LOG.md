# Phase 35 — Discussion Log

**Date:** 2026-05-19
**Phase:** 35 — M3 Gamification Engine
**Mode:** discuss (default; batched questions)

Audit / retrospective use only — downstream agents read `35-CONTEXT.md`.

---

## Gray-area selection

**Q:** Which gray areas to lock?
**A:** ALL 4 — XP economy + level curve · Streak rules + freeze-token semantics · Leaderboard scope + opt-in policy · Weekly challenges admin UX + user mechanics

Confetti UX, share-card OG image, badge-catalog seed, ProgressRing reuse, and gamification-burst chunk packaging deferred to Claude's discretion.

---

## Area 1: XP economy + level curve

**Q1:** XP point values? → **Wide scale (10/25/50/100/250/1000)** → D-01
**Q2:** Level curve shape? → **Quadratic (typical game pattern)** → D-02
**Q3:** Max level cap? → **No cap (prestige forever)** → D-03

Follow-on: D-04 (compute_level pure function for rollback test); D-05 (server-side capture via Phase 24 D-13).

---

## Area 2: Streak rules + freeze tokens

**Q1:** Streak-qualifying action? → **ANY qualifying XP action (cross-action OK)** → D-06
**Q2:** Freeze token rules? → **1 token = 1 day, max 3 stockpile, auto-applied** → D-08
**Q3:** Streak-break notification timing? → **24h ahead (afternoon-before warning)** → D-09

Follow-on: D-07 (daily pg_cron per timezone); D-10 (admin grant path, never monetized).

---

## Area 3: Leaderboard scope + opt-in

**Q1:** Which cohorts get leaderboards? → **Admin-curated subset (handpicked cohorts only)** → D-11
**Q2:** Default opt-in or opt-out? → **Opt-IN (privacy-default)** with level-5 nudge → D-12
**Q3:** Handle format + display window? → **User-chosen handle + top-10 + ±5 neighborhood** → D-13 + D-14

Follow-on: D-15 (opt-out within one 15-min refresh cycle); D-16 (rolling 7d XP as leaderboard score, not total XP).

---

## Area 4: Weekly challenges

**Q1:** Admin creation flow? → **Simple form, per-cohort scoping** → D-17
**Q2:** Active challenges simultaneously? → **1 global + 1 cohort-specific (max 2 active)** → D-18
**Q3:** Reward types? (multi-select) → **ALL 4 — XP + Badge + Freeze token + Combo (GAME-09)** → D-19

Follow-on: D-20 (PostHog Experiments for A/B variants); D-21 (Monday-only kickoff + 24h-ahead nudge).

---

## Ethical-only as theme

The user direction "ethical-only / no dark patterns" surfaces in 4 distinct decision points:
- D-06 (cross-action streak = generous)
- D-08 (auto-applied freeze tokens, max 3 stockpile, no use-or-lose)
- D-09 (single 24h notification, no escalation)
- D-12 (opt-IN leaderboards, privacy-default)

CONTEXT.md `<specifics>` calls out the load-bearing nature of this constraint for plan-checker.

## Out-of-scope items raised

None from user. The "full builder with branching" challenge-creation option was offered but user chose simple form (correctly captured as deferred for v1.4).
