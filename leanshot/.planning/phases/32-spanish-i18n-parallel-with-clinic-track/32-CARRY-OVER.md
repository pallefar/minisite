---
phase: 32-spanish-i18n-parallel-with-clinic-track
type: carry-over
status: deferred
created: 2026-05-18T20:23:00Z
deferred_to: v1.4 (most likely) OR Phase 51 if a contractor lands sooner
---

# Phase 32 carry-over — Plan 32-06 + dependent items

Phase 32 is **partial-complete** as of 2026-05-18:

- **Shipped (6/7 plans):** 32-01 (runtime) · 32-02 (string extraction) · 32-03 (profiles.locale + Settings) · 32-04 (locale_overrides admin) · 32-05 (Edge Fn email i18n) · 32-07 partial (hreflang + CSS RTL prep)
- **Not shipped (1/7 plans):** 32-06 (contractor-delivered ES corpus + glossary + KB content)

## What's deferred

### Primary blocker: Plan 32-06 — Bilingual clinical contractor delivery

Per Phase 32 D-02 the ES content must come from a bilingual clinical contractor (NOT machine translation, NOT in-house engineer translation). This is a **vendor engagement**, not a coding task. Specifically deferred:

- 8 ES locale JSON namespaces (`leanshot/public/locales/es/{common,nav,patient,onboarding,kb,admin,clinic,settings}.json`)
- ES email body translations (`supabase/functions/_shared/locales/es/emails.json` — wired by Plan 32-05 but body content empty)
- KB article ES variants (`leanshot/public/kb-articles/**/*.es.md`)
- ES clinical glossary (`docs/i18n/clinical-glossary-es.md`)
- TRANSLATOR-WORKFLOW.md documentation (`docs/i18n/TRANSLATOR-WORKFLOW.md`)
- Contractor engagement record + glossary sign-off header (Plan 32-06 Task 3 gate)

### Dependent items deferred with 32-06 (Plan 32-07 sub-tasks)

- **Checkpoint 1 — PostHog ship-gate UAT.** Querying `i18n_missing_key` events trailing 24h with the threshold `< 100 unique keys` is meaningless without native ES content; every key would register as "missing" today. Re-run when 32-06 lands.
- **Task 3.5 — Daily missing-key GH Actions cron.** Same dependency. Also requires `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` GH Actions secrets to be verified present.
- **Task 4 — Mark Phase 32 Complete in ROADMAP/REQUIREMENTS.** Phase 32 stays In-Progress. 4 of the 10 I18N REQ-IDs remain Pending: I18N-04 (translated emails wired & sending), I18N-05 (KB ES content), I18N-06 (clinical glossary), I18N-09 (TRANSLATOR-WORKFLOW publishable).

### I18N REQ-IDs status snapshot

| REQ-ID | Status | Closed by |
|--------|--------|-----------|
| I18N-01 | ✅ Complete | Plan 32-07 (hreflang) |
| I18N-02 | ✅ Complete | Plan 32-03 (profiles.locale) |
| I18N-03 | ✅ Complete | Plan 32-01 (runtime + namespaces) |
| I18N-04 | ⏸ Pending | Plan 32-06 (contractor email content) |
| I18N-05 | ⏸ Pending | Plan 32-06 (KB ES articles) |
| I18N-06 | ⏸ Pending | Plan 32-06 (clinical glossary) |
| I18N-07 | ✅ Complete | Plan 32-01 (ICU plural test) |
| I18N-08 | ✅ Complete | Plan 32-04 (locale_overrides + Realtime) |
| I18N-09 | ⏸ Pending | Plan 32-06 (TRANSLATOR-WORKFLOW.md) |
| I18N-10 | ✅ Complete | Plan 32-07 (CSS RTL prep) |

## Unblock plan

1. **Engage contractor** — RFP / Upwork / clinical-translation agency. Phase 32 D-02 was explicit: bilingual clinician with GLP-1 / peptide domain familiarity preferred. Budget signal: see Phase 32 CONTEXT for sizing.
2. **When contractor delivers**, run Plan 32-06 inline (small — mostly file drops + glossary header check + Task 3 gate).
3. **Then re-run Plan 32-07 Checkpoint 1** (PostHog ship-gate UAT + 3 Edge Fn smokes) + the manual `?lang=es` walkthrough.
4. **Then execute Plan 32-07 Task 3.5** (missing-key GH Actions cron) + Task 4 (mark REQ-IDs Complete + ROADMAP Phase 32 status flip).
5. **Then tag Phase 32 complete** as part of the v1.4 milestone close.

Path is short (~2 hours of executor time) once content lands.

## Cross-references

- Plan 32-07 SUMMARY records the partial-close decision: `.planning/phases/32-spanish-i18n-parallel-with-clinic-track/32-07-SUMMARY.md`
- Existing infra ready to receive contractor delivery:
  - `leanshot/public/locales/es/*.json` files exist (created by 32-01 / 32-02 with empty or partial values)
  - `_shared/i18n-server.ts` resolves `profiles.locale` and wires to email templates (Plan 32-05)
  - Realtime locale_overrides admin module accepts hot-patches (Plan 32-04)
