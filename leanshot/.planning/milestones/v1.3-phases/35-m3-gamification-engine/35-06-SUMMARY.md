---
phase: 35-m3-gamification-engine
plan: "06"
subsystem: frontend-gamification
tags:
  - gamification
  - dashboard
  - cards
  - confetti
  - bundle-budget
  - reduced-motion
  - canvas-confetti

dependency_graph:
  requires:
    - 35-01  # xp_total_for SECDEF RPC
    - 35-02  # freeze_tokens_remaining + streak_state schema
    - 35-03  # computeLevel / xpToNextLevel / computePrestige (client mirror) — scaffolded here
    - 35-04  # get_leaderboard_for_user RPC + LeaderboardRow types
    - 35-05  # fetchActiveChallenges + WeeklyChallenge types
  provides:
    - GamificationCard parent (mounts 4 sub-cards in HomeTab)
    - LevelProgressCard (ProgressRing reuse + level display)
    - StreakCard (ProgressRing + freeze tokens)
    - LeaderboardCard (top-10 + ±5; opt-in nudge)
    - WeeklyChallengeCard (PostHog A/B variant framing)
    - LevelUpBurst overlay (framer-motion + confetti)
    - ConfettiBurst (pure side-effect; defense-in-depth gate)
    - gamification-defer.ts (canvas-confetti lazy-load wrapper; 60s cooldown)
    - dashboard-data.ts (Promise.all batch RPC reader)
    - xp.ts client mirror (scaffolded for 35-03 sibling-wave)
    - xp-event-client.ts (scaffolded for 35-03 sibling-wave)
  affects:
    - HomeTab.tsx (GamificationCard mounted after StreaksCard)
    - vite.config.ts gamification-burst chunk rule (pre-existing; routes /src/lib/gamification/ and /src/components/gamification/)

tech_stack:
  added:
    - canvas-confetti ^1.9.4
    - "@types/canvas-confetti ^1.9.0 (devDep)"
  patterns:
    - sync-defer.ts FIFO+idle+dynamic-import pattern (mirrored in gamification-defer.ts)
    - ProgressRing v1.2 DS-9 reuse for level + streak rings
    - Defense-in-depth reduced-motion: React-level gate (#1) + disableForReducedMotion (#2)
    - 60s localStorage cooldown anti-spam (T-35-06-01)

key_files:
  created:
    - leanshot/src/lib/gamification-defer.ts
    - leanshot/src/lib/gamification/dashboard-data.ts
    - leanshot/src/lib/gamification/xp.ts (scaffold for 35-03)
    - leanshot/src/lib/gamification/xp-event-client.ts (scaffold for 35-03)
    - leanshot/src/components/dashboard/burst/ConfettiBurst.tsx
    - leanshot/src/components/dashboard/burst/LevelUpBurst.tsx
    - leanshot/src/components/dashboard/burst/__tests__/LevelUpBurst.test.tsx
    - leanshot/src/components/dashboard/cards/GamificationCard.tsx
    - leanshot/src/components/dashboard/cards/LevelProgressCard.tsx
    - leanshot/src/components/dashboard/cards/StreakCard.tsx
    - leanshot/src/components/dashboard/cards/LeaderboardCard.tsx
    - leanshot/src/components/dashboard/cards/WeeklyChallengeCard.tsx
    - leanshot/src/components/dashboard/cards/__tests__/LevelProgressCard.test.tsx
    - leanshot/src/components/dashboard/cards/__tests__/StreakCard.test.tsx
  modified:
    - leanshot/package.json (canvas-confetti + @types/canvas-confetti added)
    - leanshot/package-lock.json (regenerated)
    - leanshot/src/components/dashboard/tabs/HomeTab.tsx (GamificationCard mounted)
    - leanshot/src/lib/gamification/__tests__/handle-validate.test.ts (eslint blank-line fix)

decisions:
  - GamificationCard mounts in HomeTab after StreaksCard (NIT-3 reconciliation: existing StreaksCard provides visual continuity; gamification cards extend the streak+level theme below it)
  - xp.ts and xp-event-client.ts scaffolded by this plan (Rule 3 auto-fix) to unblock sibling-wave compilation. Plan 35-03 owns the canonical Vitest parity tests (35-03-04 / T-35-06-05)
  - priorLevelRef (useRef) used for level-up detection instead of useState to avoid extra re-render cycle
  - eslint-disable inline on stop-propagation div inside LevelUpBurst (jsx-a11y/click-events-have-key-events + no-static-element-interactions): the div is purely a propagation stopper on a dialog overlay, not an interactive element

metrics:
  duration: "~25 minutes"
  completed: "2026-05-21T12:34:00Z"
  tasks_completed: 3
  files_created: 14
  files_modified: 4
---

# Phase 35 Plan 06: Dashboard Cards + LevelUpBurst + Gamification Defer Summary

**One-liner:** Dashboard gamification with canvas-confetti lazy-loaded via FIFO defer wrapper (60s cooldown, dual reduced-motion gate), 4 bento cards in HomeTab, and framer-motion level-up overlay.

## Dashboard Tab Placement

`GamificationCard` is mounted in `leanshot/src/components/dashboard/tabs/HomeTab.tsx` after `<StreaksCard />` (and before `<QuickLogCard />`). This placement was chosen for visual continuity — the existing StreaksCard shows streak data, and the new gamification cards extend that theme with progress rings, leaderboard, and weekly challenges directly below.

Grid layout: GamificationCard renders as a React fragment with 4 child cards occupying their respective bento grid spans:
- `LevelProgressCard`: `span={4}` (desktop 4/12 col)
- `StreakCard`: `span={4}` (desktop 4/12 col)
- `WeeklyChallengeCard`: `span={12}` (full width; renders null when no active challenges)
- `LeaderboardCard`: `span={8}` (renders null when cohortId=null — stubbed until Plan 35-08)

## Bundle Budget

The `gamification-burst` chunk ceiling of 8 kB gz is enforced by `scripts/assert-bundle-budget.sh` (CHUNK_CONFIG row already present from Phase 24 D-18..20). The vite.config.ts `manualChunks` rule already routes:
- `/src/lib/gamification/` → `gamification-burst`
- `/src/components/gamification/` → `gamification-burst`

canvas-confetti is lazily imported via `gamification-defer.ts` — it does NOT appear on the entry chunk's static graph. The bundle budget verification (full `npm run build` + bundle-budget script) is owned by Plan 35-10's wave-4 verification step.

**Important:** framer-motion (used in LevelUpBurst) is already in `vendor-motion` chunk — it is NOT counted against the gamification-burst ceiling.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 75dcfee | canvas-confetti install + gamification-defer.ts + ConfettiBurst + 5 RTL tests |
| 2 | 3b6ce12 | LevelUpBurst overlay + dashboard-data batch reader + xp.ts scaffold |
| 3 | 313ee34 | 4 dashboard cards + GamificationCard + HomeTab wiring + 9 RTL tests |

## Deviations from Plan

### Auto-fixed Issues (Rule 3 — Blocking Dependencies)

**1. [Rule 3 - Blocker] xp.ts scaffolded to unblock sibling-wave compilation**
- **Found during:** Task 2 (LevelUpBurst needs `fireXpEvent` which needs `@/lib/gamification/xp-event-client`)
- **Issue:** Plan 35-03 (sibling parallel wave) owns `computeLevel`, `xpToNextLevel`, `computePrestige`, `fireXpEvent` — these were not yet shipped
- **Fix:** Created `src/lib/gamification/xp.ts` (D-02 quadratic client mirror) and `src/lib/gamification/xp-event-client.ts` (dynamic-import wrapper to xp-event Edge Function) as scaffolds
- **Files modified:** `leanshot/src/lib/gamification/xp.ts`, `leanshot/src/lib/gamification/xp-event-client.ts`
- **Commits:** 3b6ce12

**2. [Rule 2 - Missing Critical] canvas-confetti types installed as devDep**
- **Found during:** Task 1
- **Issue:** canvas-confetti 1.9.4 does not bundle its own TypeScript types; `import type confetti from 'canvas-confetti'` fails tsc without types
- **Fix:** Installed `@types/canvas-confetti ^1.9.0` as devDependency
- **Files modified:** `package.json`, `package-lock.json`
- **Commits:** 75dcfee

**3. [Rule 1 - Bug] fetchActiveChallengesForUser → fetchActiveChallenges**
- **Found during:** Task 3
- **Issue:** Plan's interface spec uses `fetchActiveChallengesForUser()` but Plan 35-05's actual implementation exports `fetchActiveChallenges()`
- **Fix:** WeeklyChallengeCard uses `fetchActiveChallenges()` (the correct, existing export)
- **Commits:** 313ee34

**4. [Rule 1 - Bug] GamificationCard uses signedIn?.user?.id not user.id**
- **Found during:** Task 3 (TypeScript error)
- **Issue:** Plan template uses `useStore(s => s.user)` + `.id` but the Zustand `User` type (local profile) has no `id` field. The Supabase auth user ID lives in `s.signedIn?.user?.id`
- **Fix:** GamificationCard reads from `s.signedIn?.user?.id ?? null`
- **Commits:** 313ee34

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `cohortId={null}` | GamificationCard.tsx | Plan 35-08 threads user's primary leaderboard-enabled cohort from store |
| `hasOptedIn={false}` | GamificationCard.tsx | Plan 35-08 wires the leaderboard opt-in store toggle |
| `nudgeDismissed={false}` | GamificationCard.tsx | Plan 35-08 wires the persisted nudge-dismissed preference |

These stubs intentionally do NOT prevent the plan's goals: LevelProgressCard, StreakCard, and WeeklyChallengeCard render unconditionally. LeaderboardCard renders null when cohortId=null (expected behavior documented in code comments).

## Threat Flags

None — no new trust boundaries introduced beyond those in the plan's threat_model.

## Self-Check: PASSED

Files exist:
- leanshot/src/lib/gamification-defer.ts ✓
- leanshot/src/lib/gamification/dashboard-data.ts ✓
- leanshot/src/lib/gamification/xp.ts ✓
- leanshot/src/lib/gamification/xp-event-client.ts ✓
- leanshot/src/components/dashboard/burst/ConfettiBurst.tsx ✓
- leanshot/src/components/dashboard/burst/LevelUpBurst.tsx ✓
- leanshot/src/components/dashboard/burst/__tests__/LevelUpBurst.test.tsx ✓
- leanshot/src/components/dashboard/cards/GamificationCard.tsx ✓
- leanshot/src/components/dashboard/cards/LevelProgressCard.tsx ✓
- leanshot/src/components/dashboard/cards/StreakCard.tsx ✓
- leanshot/src/components/dashboard/cards/LeaderboardCard.tsx ✓
- leanshot/src/components/dashboard/cards/WeeklyChallengeCard.tsx ✓
- leanshot/src/components/dashboard/cards/__tests__/LevelProgressCard.test.tsx ✓
- leanshot/src/components/dashboard/cards/__tests__/StreakCard.test.tsx ✓

Commits exist:
- 75dcfee ✓ (Task 1)
- 3b6ce12 ✓ (Task 2)
- 313ee34 ✓ (Task 3)

Tests: 14/14 passing across 3 test files ✓
TypeScript: clean ✓
ESLint: clean ✓
