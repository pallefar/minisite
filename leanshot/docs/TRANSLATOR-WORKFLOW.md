# LeanShot i18n Translator Workflow

This runbook documents the **extract → translate → verify → CI** loop for adding or updating Spanish (ES) catalog strings in LeanShot. It covers both initial namespace keying (Phase 58) and ongoing maintenance.

> **Note on framing:** The original Phase 58 plan referenced a "contractor TMX import" flow (`scripts/import-tmx.ts`). That approach never materialized. This runbook documents the **direct-keying + machine-translation** loop that replaced it — no `scripts/import-tmx.ts` exists and none should be created.

---

## Prerequisites

- Node.js v22+ and npm installed
- `leanshot/` is your working directory for all commands below
- The CI `i18n-gate.yml` workflow runs automatically on every `push` and `pull_request`

---

## Step-by-Step Workflow

### Step 1 — Key components with `t('ns:key')` literals

Replace inline JSX English text with `useTranslation` hook calls and `t('ns:key')` string-literal keys.

**Rules:**
- Use `useTranslation(['namespace', 'common'])` in each component. Namespace assignment by surface:
  - `onboarding` → `OnboardingFlow` and all onboarding step components
  - `patient` → dashboard tabs, cards, charts, AI panel, modals
  - `settings` → `SettingsPage` and all settings sub-components
  - `kb` → KB UI components (e.g. `RelatedArticlesFooter`)
  - `clinic` → patient-facing clinic invite/consent pages only
- Keys must be **string literals** — never template literals or dynamic expressions. The i18next-parser uses static AST analysis; interpolated keys are invisible and produce zero extraction.
  - BAD: `` t(`patient:card.${name}.title`) ``
  - GOOD: `t('patient:card.site_rotation.title')`
- Key naming convention: `namespace:section.element` (dotted hierarchy, snake_case)
- ICU plurals: use `_one` / `_other` English suffixes (i18next internal — do NOT translate to `_uno` / `_otro`)

### Step 2 — Extract: populate `public/locales/en/*.json`

After keying a component or wave, run extraction to upsert new keys into the EN catalog:

```bash
cd leanshot
npm run i18n:extract
```

This runs `i18next-parser` against all `src/` TSX/TS files (excluding tests and node_modules) and upserts new keys into `public/locales/en/{namespace}.json`. Existing keys are preserved (`keepRemoved: true`).

Verify the extraction produced the expected keys:

```bash
git diff public/locales/en/
```

### Step 3 — Translate the delta into `public/locales/es/*.json`

Machine-translate (via Claude or other tool) each **newly added** EN key into the corresponding ES file.

**Translation rules — must be followed exactly:**

1. **Preserve ALL `{{variableNames}}` verbatim.** Only translate surrounding text.
   - BAD: `"{{conteo}} inyecciones registradas"` (translated variable name — FAILS Gate 3)
   - GOOD: `"{{count}} inyecciones registradas"` (variable name preserved — passes Gate 3)

2. **Keep `_one` / `_other` plural suffixes in English.** They are i18next internals, not part of the translation.
   - BAD key: `"dose_count_uno"`, `"dose_count_otro"`
   - GOOD key: `"dose_count_one"`, `"dose_count_other"`

3. **JSON structure must be byte-for-byte identical to the EN file.** Same nesting, same key names. Only string values change.

4. **Clinical terms: use `docs/clinical-glossary.md` verbatim.** Do not re-translate drug names, dose units, symptom terms, or anatomical sites independently. All clinical rows in the glossary are `signoff-pending` for Phase 70 human clinical-advisor review.

5. **Latin-American neutral Spanish.** Use `tú` for user-facing copy, `usted` for formal settings sections. Avoid vosotros/vos.

6. **Numbers and SI units are never translated.** `mg`, `mL`, `kg`, `cm`, `kcal` appear identically in EN and ES.

### Step 4 — Verify parity: EN vs ES leaf-key coverage

After translating, confirm every EN key has a matching ES key across all in-scope namespaces:

```bash
cd leanshot
npm run i18n:check
```

This runs `scripts/check-locale-coverage.sh`, which diffs EN vs ES leaf paths using `jq`. Every namespace must have identical key sets. The script exits non-zero and prints the missing keys if parity is broken.

**Fix:** Add the missing ES keys and re-run until the check passes.

### Step 5 — Verify ICU integrity: Gate 3 (no translated `{{var}}` names)

Gate 3 in `.github/workflows/i18n-gate.yml` fails CI if any ES catalog value contains an interpolation marker whose variable name starts with a lowercase or accented letter (the signature of a translated `{{var}}` name). Run it locally before pushing:

```bash
cd leanshot
grep -rEn '\{\{[a-záéíóúñüÁÉÍÓÚÑÜ]' public/locales/es/ && echo "FAIL — translated var name detected" || echo "Gate 3 OK"
```

If the grep finds a match, locate the ES string and restore the original ASCII variable name (e.g. `{{count}}` not `{{conteo}}`). Translated variable names silently render as literal `{{recuento}}` in the UI — this is a patient-harm vector for dose/unit/count strings (threat T-58-01).

### Step 6 — Commit both `en/` and `es/` sides; CI runs all three gates

```bash
git add public/locales/en/ public/locales/es/
git commit -m "feat(58-XX): key <surface> namespace + ES translations"
git push
```

On push, GitHub Actions runs `i18n-gate.yml` with three sequential gates:

| Gate | What it checks |
|------|---------------|
| Gate 1 (`i18n:check`) | EN vs ES leaf-key parity — every namespace must have identical key sets |
| Gate 2 (parser drift) | `i18next-parser` re-extraction produces no diff — no uncommitted catalog updates |
| Gate 3 (ICU guard) | No ES catalog value contains a translated `{{variableName}}` — prevents silent literal-render of dose/unit/count |

All three gates must be green before a PR can merge.

---

## Key i18n Commands

| Command | What it does |
|---------|-------------|
| `npm run i18n:extract` | Runs i18next-parser; upserts new `t()` call keys into `public/locales/en/*.json` |
| `npm run i18n:check` | Runs `scripts/check-locale-coverage.sh`; diffs EN vs ES leaf paths; exits non-zero on mismatch |
| `npm run lint` | Includes `eslint-plugin-i18next` `no-literal-string` rule (jsx-text-only mode) — catches un-keyed JSX text |

---

## Clinical Term Handling

All clinical terms (medication names, dose units, symptom terms, anatomical injection sites) are listed in `docs/clinical-glossary.md` with their canonical ES translations. Every entry is marked `signoff-pending` — machine translations ship now, but human clinical-advisor signoff is deferred to Phase 70 HUMAN-UAT.

**Do not modify clinical term translations without updating the glossary and scheduling a Phase 70 review.**

---

## Scope Reference

**In scope (Phase 58):**
- `onboarding`, `patient`, `settings`, `kb`, `clinic` namespaces
- Patient-facing components only (consumer and clinic-invite surfaces)
- ES Playwright smoke spec (`e2e/i18n/es-smoke.spec.ts`)

**Out of scope:**
- Admin module strings (`admin.json`) — clinician-operator surfaces
- Marketing landing page strings
- Dev-only tooling
- Languages beyond Spanish (v1.5+ roadmap)
- `scripts/import-tmx.ts` — this script does NOT exist and should NOT be created

---

## Troubleshooting

**`npm run i18n:check` fails with missing ES keys after adding a new component:**
The i18next-parser extraction in Step 2 did not run after the component was keyed, or the ES translation in Step 3 is incomplete. Run `npm run i18n:extract` → translate delta → `npm run i18n:check` again.

**Gate 3 fails on push:**
An ES string contains a translated `{{var}}` name (e.g. `{{conteo}}`). Locate the offending file from the `::error::` annotation in the CI log, restore the original ASCII variable name, and push again.

**Gate 2 (parser drift) fails on push:**
A developer added a `t()` call but did not run `npm run i18n:extract` before pushing. Run extraction locally, commit the updated `public/locales/en/*.json` files, and push again.

**ES smoke Playwright spec fails unexpectedly:**
The `e2e/i18n/es-smoke.spec.ts` spec is a RED scaffold until Wave-4 plan 58-08. It should only be invoked via `PLAYWRIGHT_RUN_ES_SMOKE=1 npx playwright test --project=p58-es-smoke` and is excluded from the default chromium run. If it appears in CI output without the env var, check that the `testIgnore` entry in `playwright.config.ts` is intact.
