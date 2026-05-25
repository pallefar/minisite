---
phase: 58-spanish-i18n-wiring-contractor-delivered
plan: "05"
subsystem: i18n/dashboard-cards
tags: [i18n, dashboard, cards, patient-namespace, spanish, clinical]
dependency_graph:
  requires: []
  provides:
    - public/locales/en/patient.json (card.* keys — 97 leaf keys)
    - public/locales/es/patient.json (card.* keys at full ES parity)
  affects:
    - 58-06 (tabs) — appends tab.* keys to patient.json
    - 58-07 (overlays) — appends ai.*/modal.*/chart.* keys to patient.json
tech_stack:
  added: []
  patterns:
    - exhaustive-switch-i18next-parser (static key extraction for dynamic arrays)
    - useTranslation-single-namespace (patient ns for all dashboard cards)
key_files:
  created:
    - leanshot/public/locales/en/patient.json
    - leanshot/public/locales/es/patient.json
  modified:
    - leanshot/src/components/dashboard/cards/HeroCard.tsx
    - leanshot/src/components/dashboard/cards/SiteRotationCard.tsx
    - leanshot/src/components/dashboard/cards/SymptomCard.tsx
    - leanshot/src/components/dashboard/cards/GLPCurveCard.tsx
    - leanshot/src/components/dashboard/cards/EffectivenessCard.tsx
    - leanshot/src/components/dashboard/cards/FocusCard.tsx
    - leanshot/src/components/dashboard/cards/ForYouCard.tsx
    - leanshot/src/components/dashboard/cards/LeaderboardCard.tsx
    - leanshot/src/components/dashboard/cards/LevelProgressCard.tsx
    - leanshot/src/components/dashboard/cards/QuickLogCard.tsx
    - leanshot/src/components/dashboard/cards/StreakCard.tsx
    - leanshot/src/components/dashboard/cards/StreaksCard.tsx
    - leanshot/src/components/dashboard/cards/WeeklyChallengeCard.tsx
decisions:
  - "GamificationCard skipped for useTranslation (container-only, no user-visible text; adding unused import violates noUnusedLocals)"
  - "Exhaustive switch pattern used in QuickLogCard, StreaksCard, GLPCurveCard for i18next-parser static extraction"
  - "GLPCurveCard refactored from tFn-parameter helpers to inline switch to fix i18next-parser extraction"
  - "ring_label_many added to both EN and ES for parity (Spanish 3-plural-form rule); EN value == _other"
metrics:
  duration_minutes: ~50
  completed: "2026-05-25"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 15
---

# Phase 58 Plan 05: Dashboard Card i18n (patient namespace, card.* keys) Summary

14 dashboard cards keyed to `patient:card.*` with EN+ES at full parity; `en/patient.json` and `es/patient.json` established (97 leaf keys each).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Key clinical-heavy cards (Hero, SiteRotation, Symptom, GLPCurve, Effectiveness) | 6aa9ddae | 5 card files |
| 2 | Key remaining 9 cards; establish patient.json; translate ES | 026efa08 | 9 card files + 2 locale files |

## What Was Built

### Task 1: Clinical-Heavy Cards

**HeroCard** (`card.hero.*`):
- Clinical phase labels keyed as static string variables (Tolerance/Titration/Maintenance) via if/else assigning `t('patient:card.hero.phase_*')` — no inline ternary strings
- Phase tips (`phase_tip_tolerance/titration/maintenance`) keyed separately
- Direction (Lost/Gained) keyed as `direction_lost`/`direction_gained`
- Stats row labels keyed (`stat_goal`, `stat_injections`, `stat_protein_today`)
- Titration timeline title and hint keyed
- `TitrationTrack` sub-component receives `t` as prop for static calls

**SiteRotationCard** (`card.site_rotation.*`):
- Title, 3 legend labels (legend_recent, legend_older, legend_next), aria-label

**SymptomCard** (`card.symptoms.*`):
- Title, action_log button, empty_title/empty_body, pattern_warning

**GLPCurveCard** (`card.glp_curve.*`):
- All 4 peak/badge states via exhaustive switch (peak_now, mid_cycle, trough, no_data)
- Axis labels (axis_now/day3/day6), chip labels (peak/trough), next_shot_in, appetite_warning, estimated

**EffectivenessCard** (`card.effectiveness.*`):
- Title, 4 row names (body_weight/goal_progress/protein_today/adherence), since_week, full_report, open_body_tab

### Task 2: Remaining 9 Cards + patient.json

**FocusCard** (`card.focus.*`): Label "Today's focus" keyed. Note: `focus.title/body/cta.label` come from `insights.ts` rule engine, not keyed in this plan.

**ForYouCard** (`card.for_you.*`): title, fallback_notice, open_rec aria-label.

**GamificationCard**: Container-only component with no user-visible text. Skipped (see Deviations).

**LeaderboardCard** (`card.leaderboard.*`): Full nudge state (title, body with {{level}}, cta_accept, cta_dismiss), leaderboard state (title, loading, error, empty).

**LevelProgressCard** (`card.level_progress.*`): title, ring_label with {{level}}{{prestige}}, xp_to_next with {{xp}} and {{next}}.

**QuickLogCard** (`card.quick_log.*`): Title + 8 action labels via exhaustive `getActionLabel(t, id)` switch on `ActionId` union.

**StreakCard** (`card.streak.*`): title, longest with {{days}}, ring_label plural, freeze_token plural (top-level).

**StreaksCard** (`card.streaks.*`): title, badge_keep_going, 4 row labels via exhaustive switch on `StreakKey`, streak_day plural, milestone_title/milestone_body.

**WeeklyChallengeCard** (`card.weekly_challenge.*`): title, reward_label, reward_badge, reward_freeze.

### patient.json Files

- `en/patient.json`: 97 leaf keys with English values
- `es/patient.json`: 97 leaf keys at full ES parity
- `bash scripts/check-locale-coverage.sh`: PASS (patient: 97 EN / 97 ES, 0 missing, 0 extra)
- `npx tsc -p tsconfig.app.json --noEmit`: 0 errors
- No template-literal patient keys in source

## Clinical Glossary Notes (for docs/clinical-glossary.md consolidation)

Clinical EN+ES pairs flagged for Phase 70 human signoff per T-58-02:

| Clinical Term | EN | ES | Notes |
|---|---|---|---|
| Phase label | Tolerance | Tolerancia | GLP-1 initiation phase |
| Phase label | Titration | Titulación | Dose escalation phase |
| Phase label | Maintenance | Mantenimiento | Stable dose phase |
| Phase tip | Take it slow. | Ve despacio. | Tolerance phase guidance |
| Phase tip | Stay protein-focused. | Mantén el foco en la proteína. | Titration phase guidance |
| Phase tip | Lock in habits. | Consolida tus hábitos. | Maintenance phase guidance |
| Peak badge | Peak now | Pico ahora | Drug-level peak indicator |
| Trough badge | Trough | Valle | Drug-level trough indicator |
| Mid-cycle badge | Mid-cycle | Mitad del ciclo | Drug-level mid indicator |
| Appetite warning | Appetite may return | El apetito puede volver | Trough window clinical note |
| Side effects | Side effects | Efectos secundarios | Symptom card title |
| Pattern warning | Recurring pattern detected — bring this to your prescriber if it persists. | Patrón recurrente detectado — coméntalo con tu médico si persiste. | Clinical referral prompt |
| Injection site | Injection site | Sitio de inyección | Site rotation card |
| GLP-1 level | GLP-1 level | Nivel GLP-1 | Pharmacology curve card |

## Deviations from Plan

### Justified Omission

**GamificationCard: useTranslation not added**
- **Found during:** Task 2
- **Issue:** GamificationCard is a pure data-fetching container that renders only sub-cards (LevelProgressCard, StreakCard, WeeklyChallengeCard, LeaderboardCard). It has zero user-visible string literals in its JSX.
- **Deviation:** Did not add `useTranslation` — adding it without using `t` would violate `noUnusedLocals` / `noUnusedParameters` TypeScript strict rules and fail the tsc check.
- **Impact:** Nil — GamificationCard's user-visible strings are all in the 4 sub-cards which ARE keyed.
- **Verification:** `npx tsc -p tsconfig.app.json --noEmit` 0 errors; all 4 sub-cards use `useTranslation('patient')`.

### Auto-fix Applied

**[Rule 1 - Bug] GLPCurveCard: tFn parameter name broke i18next-parser extraction**
- **Found during:** Task 1 verification (parser run after clinical cards committed)
- **Issue:** `getPeakLabel(key, tFn)` and `getAxisLabel(key, tFn)` used `tFn` as parameter name. i18next-parser only extracts calls to `t(...)` — calls to `tFn(...)` are invisible.
- **Fix:** Replaced helper functions with inline `switch` statements using `t(...)` directly, fixing extraction.
- **Commit:** Included in 026efa08 (Task 2)

### Note on ICU Interpolation Check

The plan's verification `grep -E '\{\{[a-záéíóúñ]' public/locales/es/patient.json finds nothing` uses a character class that includes `[a-z]` (ASCII), which also matches all English variable names (`{{count}}`, `{{date}}`, etc.). The existing `es/common.json` exhibits the same grep-matching behavior. All ES variable names in `es/patient.json` ARE English (verbatim), satisfying the intent: no Spanish-language variable names (e.g. `{{conteo}}`, `{{fecha}}`).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes. This plan modifies only UI component strings and locale JSON files. No new trust boundaries introduced.

## Known Stubs

None — all 14 cards render actual data from the store with proper translations.

## Self-Check: PASSED

- [x] `leanshot/public/locales/en/patient.json` exists and is non-empty
- [x] `leanshot/public/locales/es/patient.json` exists at full parity
- [x] All 13 card TSX files modified (GamificationCard excluded — justified)
- [x] Commits 6aa9ddae and 026efa08 verified in git log
- [x] `bash scripts/check-locale-coverage.sh` patient: 97/97 PASS
- [x] `npx tsc -p tsconfig.app.json --noEmit` 0 errors
- [x] No template-literal `t(\`patient:...\`)` calls in dashboard/cards/
