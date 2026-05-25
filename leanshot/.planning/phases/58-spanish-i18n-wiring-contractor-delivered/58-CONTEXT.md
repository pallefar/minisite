# Phase 58: Spanish i18n Wiring (Contractor-Delivered) - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — REALITY CHECK overrode the ROADMAP framing; user chose full keying

<domain>
## Phase Boundary

**ROADMAP framed this as "wiring + verification only" (D-04), but the reality check found that assumption false:**
- The v1.3/Phase-32 i18next infrastructure exists (`src/lib/i18n/init.ts`, http-backend, detector, `useLocale`, `LanguageSwitcher`, locale-overrides admin) and works.
- BUT only **3 namespaces** are actually keyed + ES-translated at parity: `nav`, `admin`, `common`. The patient-facing flow uses **inline English** — `OnboardingFlow.tsx` has 0 i18n refs; only 1 dashboard file uses `useTranslation`; namespace files `patient/onboarding/settings/clinic/kb.json` are empty `{}` in BOTH en and es.
- **No contractor TMX, glossary, or TRANSLATOR-WORKFLOW.md exists** anywhere in the repo. The "contractor delivery" never materialized for the patient surfaces.

**User decision (2026-05-25, overrides D-04 for this phase):** "Full keying + translate now." Externalize all inline English in the **patient-facing surfaces — onboarding + dashboard + settings + KB (+ clinic)** — into i18n keys under the existing namespaces, and machine/Claude-translate to ES now (no contractor TMX). Admin/marketing/dev surfaces are OUT of scope (stay as-is).

**Net deliverable:** the es-smoke flow (signup → onboarding → first dose log → AI chat → cancellation → KB search) renders in Spanish when locale=es, with CI lint enforcing en↔es key parity + ICU validity.
</domain>

<decisions>
## Implementation Decisions

### Translation approach
- Full i18n keying of patient-facing surfaces NOW (user override of D-04, 2026-05-25).
- No contractor TMX → ES strings are **Claude-generated machine translations**. Clinical/medical strings (dosing, sites, symptoms, safety copy) are FLAGGED in the clinical glossary for **clinical-advisor human signoff at Phase 70** (advisor unavailable in autonomous run — signoff DEFERRED, not skipped).
- Reuse the existing i18next infra verbatim (`src/lib/i18n/*`). No new i18n library. Follow existing ICU + plural (`_one`/`_other`) patterns from the populated `common.json`.

### Namespace organization
- Keep the existing 8 namespaces. Map surfaces: `onboarding` → OnboardingFlow + steps; `patient` → dashboard tabs/cards/charts/modals/AI/dose-log/body/share; `settings` → SettingsPage; `kb` → helpdesk KB UI; `clinic` → clinic/coach surfaces; reuse `common` for shared primitives/actions/toasts.
- Both `public/locales/en/<ns>.json` (source) AND `public/locales/es/<ns>.json` (translation) populated per namespace; `dist/` is build output (ignore).

### Scope boundaries
- IN: onboarding, dashboard (consumer), settings, KB, clinic user-facing strings; their ES translations; CI missing-key + ICU lint; `TRANSLATOR-WORKFLOW.md` runbook; clinical glossary file; ES Postgres `tsvector` dictionary for KB search; `es-smoke.spec.ts` full flow.
- OUT: admin module strings (already partially keyed — leave as-is), marketing landing, dev-only tooling, and the other ~320 non-patient components. Additional languages beyond ES.

### Verification
- `es-smoke.spec.ts` (Playwright): locale=es traverses signup → onboarding → first dose log → AI chat → cancellation → KB search, asserting ES strings render (not English fallthrough) at each step.
- CI lint: en↔es leaf-key parity per in-scope namespace + ICU/interpolation syntax validity + no missing-key fallbacks for in-scope namespaces.

### Claude's Discretion
- Exact key naming, string-extraction granularity, per-surface wave grouping (disjoint file sets to enable parallel worktrees), glossary term selection, machine-translation phrasing.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/i18n/init.ts` (i18next init + http-backend), `src/lib/i18n/useLocale.ts`, `src/components/i18n/LanguageSwitcher.tsx`, `src/components/i18n/I18nSuspenseFallback.tsx`, `src/lib/i18n/missing-key-handler.ts`, override-backend (admin locale overrides).
- Populated reference namespaces (key + ICU + plural patterns to mirror): `public/locales/en|es/{common,nav,admin}.json`.
- KB stored in DB (helpdesk) — ES KB search needs a Postgres ES `tsvector` dictionary/config (migration), not just JSON.

### Established Patterns
- `useTranslation('<ns>')` per component; plural keys `key_one`/`key_other`; interpolation `{{count}}`. Only 14 files currently use i18n (nav/admin/common).
- No router on consumer surface (Zustand TabId) — locale switch must not depend on routing.

### Integration Points
- `OnboardingFlow.tsx` + step components (inline English → onboarding ns); dashboard tabs/cards (`src/components/dashboard/**`, ~58 files → patient ns); `SettingsPage.tsx` (settings ns); KB UI (kb ns); clinic surfaces (clinic ns). Locale picker already exists (LanguageSwitcher) — verify it's reachable in the consumer shell.
</code_context>

<specifics>
## Specific Ideas
- es-smoke MUST assert real ES strings render along the critical flow (guard against English fallthrough silently "passing" — see silent-scope-reduction lesson).
- Clinical glossary is a real deliverable now (machine ES + EN term pairs); only the human ADVISOR SIGNOFF defers to Phase 70.
- Machine-translation quality: clinical safety copy is the highest risk — glossary-flag those terms.
</specifics>

<deferred>
## Deferred Ideas
- Clinical-advisor human signoff on medical-term ES translations → Phase 70 HUMAN-UAT (glossary + machine translations shipped now, flagged for review).
- i18n keying of admin/marketing/dev surfaces (~320 components) → future phase if desired.
- Languages beyond Spanish → out of scope (v1.5+).
</deferred>
