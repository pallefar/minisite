---
phase: 58-spanish-i18n-wiring-contractor-delivered
plan: "04"
subsystem: i18n
tags: [i18n, settings, cancellation, kb, locale, migration]
dependency_graph:
  requires: []
  provides:
    - leanshot/public/locales/en/settings.json
    - leanshot/public/locales/es/settings.json
    - leanshot/public/locales/en/kb.json
    - leanshot/public/locales/es/kb.json
    - leanshot/src/lib/i18n/settings-labels.ts
    - supabase/migrations/20270708000001_p58_kb_articles_es_seed.sql
  affects:
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx
    - leanshot/src/components/dashboard/settings/cancellation/*
    - leanshot/src/components/kb/RelatedArticlesFooter.tsx
tech_stack:
  added: []
  patterns:
    - exhaustive switch static-key helper (settings-labels.ts following nav-labels.ts pattern)
    - useTranslation(['settings','common','nav']) multi-namespace hook
    - content-only idempotent KB ES seed migration (UPDATE + INSERT ON CONFLICT)
key_files:
  created:
    - leanshot/src/lib/i18n/settings-labels.ts
    - leanshot/public/locales/en/settings.json
    - leanshot/public/locales/es/settings.json
    - leanshot/public/locales/en/kb.json
    - leanshot/public/locales/es/kb.json
    - supabase/migrations/20270708000001_p58_kb_articles_es_seed.sql
    - leanshot/docs/clinical-glossary.md
  modified:
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx
    - leanshot/src/components/dashboard/settings/cancellation/CancellationModal.tsx
    - leanshot/src/components/dashboard/settings/cancellation/OfferCard.tsx
    - leanshot/src/components/dashboard/settings/cancellation/PauseControls.tsx
    - leanshot/src/components/dashboard/settings/cancellation/steps/LossSummaryStep.tsx
    - leanshot/src/components/dashboard/settings/cancellation/steps/OfferStep.tsx
    - leanshot/src/components/dashboard/settings/cancellation/steps/ReasonPicklistStep.tsx
    - leanshot/src/components/kb/RelatedArticlesFooter.tsx
decisions:
  - "settings-labels.ts uses exhaustive switch (18 cases + never default) so i18next-parser sees static literals — template-literal approach would emit zero keys"
  - "NAV array drops label field; sectionLabel(t, id) called at render time inside NAV.map()"
  - "ReasonPicklistStep: REASONS array split into REASON_VALUES (values-only) + reasonLabel(t, value) static switch helper for same reason"
  - "PauseControls: PRESETS split into PRESET_MONTHS + pauseMonthLabel(t, months) static switch"
  - "KB ES migration: dual strategy — UPDATE existing rows + INSERT if no global rows exist, both idempotent"
  - "clinical-glossary.md created in this worktree since 58-01 had not yet landed here"
  - "en/settings.json manually populated after i18next-parser skeletal extraction (parser doesn't pick up nested t() calls like units_metric/units_imperial)"
metrics:
  duration: "~90 minutes"
  completed: "2026-05-25"
  tasks_completed: 3
  files_changed: 15
---

# Phase 58 Plan 04: Settings + KB i18n Keying Summary

Settings (incl. cancellation flow) keyed to `settings` namespace via exhaustive static-key helpers; KB footer keyed to `kb` namespace; 146-key EN/ES parity; idempotent ES KB content seed migration.

## Tasks Completed

### Task 1: Key SettingsPage + cancellation flow + settings-labels.ts
**Commit:** 1ff00e3c

Created `src/lib/i18n/settings-labels.ts` — exhaustive `sectionLabel(t, id: Section)` switch with 18 cases + never default, following the nav-labels.ts pattern. The NAV array in SettingsPage drops the `label` field; labels resolve via `sectionLabel(t, id)` at render-time so i18next-parser sees static literals.

Keyed SettingsPage sections: account (title, body, sign-up, email label, unverified badge, change-password, no-email error, reset-sent toast), profile (title, body, name label, units hint, save), goals (title, body, weight goal with unit interpolation, protein, calorie, fiber, water, save), language (title, body, save error), notifications (title, body), leaderboards (title, body, loading fallback), privacy (title, body, 4 bullet items, delete-account affordance, step-up toast), PHI access log (title, body), security (title, body), recovery (title, body, corrupted/no-backup states, snapshot taken, restore warning, restore button, restore modal title/body/input/confirm), subscription (title, 3 body variants, 3 tier pills, cancel button), data (title, body, export JSON/PDF, replay tour, reset everything + confirm dialog), dev (title, body), settings modal title, saved toast.

Keyed full cancellation flow (I18N-15 fifth smoke step):
- CancellationModal: step-2 close-confirm body/yes/stay
- ReasonPicklistStep: title, body, radiogroup label, 7 reason options (exhaustive switch), other textarea (placeholder, aria-label, min-length hint, read-note), keep-account button
- OfferStep: loading label, error state, ineligible title/body, no-offer body, all 5 offer toast messages (paused, discount with {{pct}}, extended_trial, downgrade, contact_csm), error_generic, all Continue buttons
- LossSummaryStep: title, body, streak label, chart aria, coach label, data title/body, cancel-anyway, keep-account, cancel-scheduled toast
- OfferCard: saving label, stacking notice with {{existing_pct}}/{{capped_pct}}, decline button
- PauseControls: duration label, 3 month presets (exhaustive switch), resumes strip with {{date}}

RelatedArticlesFooter: `useTranslation('kb')`, CardHeader title → `t('kb:related_articles.title')`.

**Verification:** TSC 0 errors; 18 static nav cases; no template-literal settings keys.

### Task 2: Populate en/es settings.json + kb.json
**Commit:** 73e14c29

After running `npx i18next-parser` to extract the skeleton, manually populated `en/settings.json` (146 keys) and `en/kb.json` (1 key) with source English strings. Then translated all keys to ES with formal "usted" address. All {{interpolation}} variable names preserved verbatim from EN (existing_pct, capped_pct, pct, date, unit, units — all ASCII-only, no translated var names).

`bash scripts/check-locale-coverage.sh` output:
```
settings  146  146  0  0  PASS
kb          1    1  0  0  PASS
```

Note: i18next-parser doesn't extract `units_metric`/`units_imperial` from nested `t()` calls inside options objects — these were added manually to the JSON and are present in both EN and ES.

### Task 3: KB ES content seed migration
**Commit:** 5a0d368a

Created `supabase/migrations/20270708000001_p58_kb_articles_es_seed.sql` — content-only, no schema changes. Dual-strategy:
- **Case 1:** UPDATE existing global `kb_articles` rows to set `title_es`, `body_es`, `locale_set = array['en','es']` via slug match + `title_es IS NULL` idempotency guard
- **Case 2:** INSERT 3 global seed articles (`injection-site-rotation`, `reading-your-med-level-curve`, `what-to-do-about-nausea`) if no global articles exist, with ON CONFLICT DO UPDATE for idempotency

Seed articles cover: injection-site rotation (GLP-1 lipohypertrophy), medication-level curve interpretation (semaglutide/tirzepatide half-life), and nausea management during titration. Numbers/units preserved verbatim. Live `supabase db push` deferred to Phase 70 per migration_discipline.

Clinical terms (lipohipertrofia, farmacocinética, titulación, etc.) recorded in `docs/clinical-glossary.md` as signoff-pending per T-58-02.

## Deviations from Plan

**[Rule 3 - Worktree path safety]** Early edits accidentally landed in the main checkout (`/Users/karstenhaldan/minisite/leanshot/`) instead of the worktree (`/Users/karstenhaldan/minisite/.claude/worktrees/agent-ac3d76941fda9bc57/leanshot/`). Recovery: copied modified files from main to worktree, restored main checkout via `git checkout --`, then re-applied edits to the correct worktree path.

**[Rule 2 - Missing critical functionality]** `docs/clinical-glossary.md` was not present in this worktree (created by Plan 58-01 which hadn't landed here yet). Per keying_discipline, clinical terms MUST be recorded in this file. Created it inline with all 13 clinical terms from the KB seed migration flagged signoff-pending.

**[Deviation - parser limitation]** i18next-parser v9 does not extract `t()` calls nested inside another `t()` call's interpolation options object. Keys `settings:section.profile.units_metric` and `settings:section.profile.units_imperial` were added manually to both EN and ES JSON files after extraction.

## Known Stubs

None. All extracted keys have real EN string values. ES translations are complete at 146/146. KB footer wired to live translation. Migration has real clinical content.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced. Migration is content-only (UPDATE/INSERT). Threat model T-58-01 (interpolation integrity) and T-58-05 (EN fallthrough) mitigated by check-locale-coverage.sh gate passing. T-58-07 (accidental schema change) verified: no ALTER/CREATE statements in migration body.

## Self-Check: PASSED

All created files exist on disk. Commits 1ff00e3c, 73e14c29, 5a0d368a, 78c99ea5 verified in git log.
