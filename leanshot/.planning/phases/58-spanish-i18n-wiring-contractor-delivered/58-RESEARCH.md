# Phase 58: Spanish i18n Wiring — Research

**Researched:** 2026-05-25
**Domain:** i18next string extraction + ES machine translation + Postgres ES text search + Playwright i18n smoke
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full i18n keying of patient-facing surfaces NOW (user override of D-04, 2026-05-25).
- No contractor TMX — ES strings are Claude-generated machine translations. Clinical/medical strings (dosing, sites, symptoms, safety copy) FLAGGED in clinical glossary for clinical-advisor human signoff at Phase 70.
- Reuse existing i18next infra verbatim (`src/lib/i18n/*`). No new i18n library.
- Follow existing ICU + plural (`_one`/`_other`) patterns from the populated `common.json`.
- Keep the existing 8 namespaces. Map: `onboarding` → OnboardingFlow + steps; `patient` → dashboard tabs/cards/charts/modals/AI/dose-log/body/share; `settings` → SettingsPage; `kb` → helpdesk KB UI; `clinic` → clinic/coach surfaces; reuse `common` for shared primitives/actions/toasts.
- Both `public/locales/en/<ns>.json` (source) AND `public/locales/es/<ns>.json` (translation) populated per namespace; `dist/` is build output (ignore).
- IN scope: onboarding, dashboard (consumer), settings, KB, clinic user-facing strings; their ES translations; CI missing-key + ICU lint; `TRANSLATOR-WORKFLOW.md` runbook; clinical glossary file; ES Postgres `tsvector` dictionary for KB search; `es-smoke.spec.ts` full flow.
- OUT scope: admin module strings, marketing landing, dev-only tooling, ~320 non-patient components. Additional languages beyond ES.

### Claude's Discretion
- Exact key naming, string-extraction granularity, per-surface wave grouping (disjoint file sets to enable parallel worktrees), glossary term selection, machine-translation phrasing.

### Deferred Ideas (OUT OF SCOPE)
- Clinical-advisor human signoff on medical-term ES translations → Phase 70 HUMAN-UAT.
- i18n keying of admin/marketing/dev surfaces (~320 components) → future phase.
- Languages beyond Spanish → out of scope (v1.5+).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| I18N-11 | Contractor-delivered TMX imported (re-framed: full keying + machine ES translation) | `i18next-parser` already configured; `npm run i18n:extract` populates en/*.json; machine translation fills es/*.json |
| I18N-12 | Clinical glossary (drug names, dosing, symptoms) integrated as ICU message constants; clinical-advisor signoff captured (deferred to Phase 70) | Glossary file ships as `docs/clinical-glossary.md` with EN/ES pairs + signoff-pending flag |
| I18N-13 | TRANSLATOR-WORKFLOW.md runbook: extract source → review → import → CI lint validates ICU + missing-key coverage | Existing `npm run i18n:extract` + `npm run i18n:check` + GitHub Actions `i18n-gate.yml` form the skeleton; runbook wraps it |
| I18N-14 | ES KB articles (title_es/body_es columns already exist on kb_articles); locale picker on KB surface; tsvector ES dictionary verified | Schema already has `title_es`, `body_es`, `search_vector_es` GIN index, `search_kb_articles` RPC with ES branch — NO new migration needed |
| I18N-15 | ES smoke test: signup → onboarding → first dose log → AI chat → cancellation → KB search; `tests/i18n/es-smoke.spec.ts` | Pattern established by existing Phase 32 i18n Playwright specs; opt-in via env var; consumer surface uses Zustand + `?lang=es`, not router paths |
</phase_requirements>

---

## Summary

The LeanShot i18n infrastructure (Phase 32) is mature and fully operational. `i18next` 26.2.0, `react-i18next` 17.0.8, `i18next-http-backend`, `i18next-browser-languagedetector`, `i18next-parser` 9.4.0, and `eslint-plugin-i18next` 6.1.4 are all installed and configured. The locale detection chain (`?lang=es` querystring → cookie → localStorage → navigator), the `LanguageSwitcher` component, `I18nSuspenseFallback`, `useLocale`, `missing-key-handler`, and the admin override-backend are all wired and tested.

The gap is exclusively data: five namespace JSON files (`onboarding`, `patient`, `settings`, `kb`, `clinic`) are empty `{}` in both en/ and es/, and the ~70-80 patient-facing components contain inline English strings rather than `t('ns:key')` calls. The work is mechanical: (1) convert inline strings to `t()` calls, (2) emit en/*.json source, (3) machine-translate to es/*.json, (4) verify with the existing CI gate.

The Postgres KB side is already complete: `kb_articles` has `title_es`, `body_es` columns, `search_vector_es` STORED GENERATED tsvector, a GIN index, and the `search_kb_articles(p_locale='es')` SECDEF RPC — all shipped in Phase 37. No new migration is required. The only KB deliverable is populating ES content in those columns and exposing a locale picker in the KB UI component.

**Primary recommendation:** Execute string extraction surface-by-surface in parallel worktrees (disjoint file sets, 4-5 waves), run `npm run i18n:extract` per wave, machine-translate the delta en→es, commit both sides, and let the existing CI gate (`i18n-gate.yml` + `check-locale-coverage.sh`) enforce parity. The es-smoke Playwright spec lives at `e2e/i18n/es-smoke.spec.ts` (matching the established e2e/ directory) as an opt-in project using `?lang=es` query-string locale injection — no router required.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| String keying (t() calls) | Browser / Client (React components) | — | i18next useTranslation is a React hook; strings are rendered in JSX |
| Locale catalog serving | CDN / Static | — | `/locales/{lng}/{ns}.json` are static files served by Vercel via `public/` dir; loaded by http-backend |
| Locale detection | Browser / Client | — | `i18next-browser-languagedetector` runs client-side; `?lang=es` querystring triggers on navigation |
| EN→ES parity CI gate | CI pipeline | — | GitHub Actions `i18n-gate.yml` runs `check-locale-coverage.sh` + parser-drift check on every push/PR |
| KB ES text search | Database / Storage | API / Backend | `search_vector_es` STORED GENERATED tsvector column + GIN index; `search_kb_articles` SECDEF RPC branches on `p_locale` |
| KB ES article content | Database / Storage | — | `kb_articles.title_es` + `body_es` already exist; need to be populated via admin or migration seed |
| ES smoke test | Browser / Client (Playwright) | — | Playwright drives real browser; `?lang=es` sets locale; assertions check rendered Spanish text |
| Clinical glossary | Docs artifact | — | Static markdown file; no runtime impact; flags terms for Phase 70 human signoff |

---

## Standard Stack

### Core (already installed — NO new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| i18next | 26.2.0 | Core translation engine | Already in use; fully configured in `src/lib/i18n/init.ts` |
| react-i18next | 17.0.8 | React hooks + Suspense integration | `useTranslation`, `<Trans>`, Suspense boundary already wired |
| i18next-http-backend | 3.0.2 | Lazy-loads /locales/{lng}/{ns}.json | HTTP backend already configured with `loadPath: '/locales/{{lng}}/{{ns}}.json'` |
| i18next-browser-languagedetector | 8.2.1 | Locale from querystring/cookie/localStorage/navigator | Detection chain already configured; `?lang=es` already works |
| i18next-parser | 9.4.0 | Extracts t() calls to en/*.json | Already configured in `i18next-parser.config.js`; `npm run i18n:extract` works |
| eslint-plugin-i18next | 6.1.4 | Lint rule: no inline English JSX text | `i18next/no-literal-string` with `mode: 'jsx-text-only'` already enabled |
| @playwright/test | ^1.59.1 | i18n smoke test | Already installed; pattern established in `e2e/i18n-language-switch.spec.ts` |

[VERIFIED: npm registry] for all packages above — confirmed via package.json and `npm view`.

### No New Packages Required

Phase 58 installs zero new packages. All required tooling is already present. The work is purely: authoring new t() calls in TSX files, populating locale JSON files, and writing a Playwright spec.

---

## Package Legitimacy Audit

No new packages are installed in this phase. All tooling was installed and verified in Phase 32. This section is intentionally empty.

| Package | Registry | Status |
|---------|----------|--------|
| (none new) | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Patient browser (locale=es)
      │
      │ 1. ?lang=es querystring
      ▼
i18next-browser-languagedetector
      │ detects 'es'
      ▼
i18next + react-i18next
      │
      ├─ 2. HTTP GET /locales/es/common.json  ──► Vercel CDN (static)
      ├─ 3. HTTP GET /locales/es/nav.json     ──► Vercel CDN (static)
      │    [on component mount, lazy-loaded by namespace:]
      ├─ 4. HTTP GET /locales/es/onboarding.json ──► (new: populated by Phase 58)
      ├─ 5. HTTP GET /locales/es/patient.json    ──► (new: populated by Phase 58)
      ├─ 6. HTTP GET /locales/es/settings.json   ──► (new: populated by Phase 58)
      ├─ 7. HTTP GET /locales/es/kb.json         ──► (new: populated by Phase 58)
      └─ 8. HTTP GET /locales/es/clinic.json     ──► (new: populated by Phase 58)
                │
                ▼
     React tree renders ES strings (no EN fallthrough)
                │
                ▼
     KB search: page.searchKb(query, locale='es')
                │
                ▼
     Supabase search_kb_articles(p_locale='es')
     → uses search_vector_es GIN index + spanish::regconfig
                │
                ▼
     Returns ES title from kb_articles.title_es
```

### Recommended Project Structure

```
public/locales/
├── en/
│   ├── common.json      # already populated (reference)
│   ├── nav.json         # already populated (reference)
│   ├── admin.json       # already populated (out of scope)
│   ├── onboarding.json  # FILL: Phase 58 Wave A
│   ├── patient.json     # FILL: Phase 58 Waves B+C
│   ├── settings.json    # FILL: Phase 58 Wave D
│   ├── kb.json          # FILL: Phase 58 Wave D
│   └── clinic.json      # FILL: Phase 58 Wave E
└── es/
    └── [mirrors en/ exactly — leaf-key parity enforced by CI]

docs/
└── clinical-glossary.md  # NEW: EN/ES medical term pairs + signoff-pending flags

e2e/
└── i18n/
    └── es-smoke.spec.ts  # NEW: opt-in via PLAYWRIGHT_RUN_ES_SMOKE=1

src/components/
├── onboarding/           # Wave A: ~9 files → onboarding ns
├── dashboard/
│   ├── tabs/             # Wave B: ~10 files → patient ns
│   ├── cards/            # Wave B: ~16 files → patient ns
│   ├── ai/               # Wave C: AIChatPanel → patient ns
│   ├── modals/           # Wave C: ~N files → patient ns
│   └── settings/         # Wave D: ~20 files → settings ns
├── kb/                   # Wave D: RelatedArticlesFooter → kb ns
└── clinic/               # Wave E: ~38 files → clinic ns
```

### Pattern 1: Standard Component Keying

**What:** Replace inline JSX English text with `useTranslation('ns')` + `t('ns:key')` calls. Keys follow the dotted `section.element` convention from `common.json`.

**When to use:** Every patient-facing component with user-visible text strings.

**Example:**
```typescript
// Source: existing populated common.json + admin.json patterns
// BEFORE
<CardHeader title="Injection site" />
<Legend label="Next" />

// AFTER
const { t } = useTranslation(['patient', 'common']);
<CardHeader title={t('patient:card.injection_site.title')} />
<Legend label={t('patient:card.injection_site.legend_next')} />
```

### Pattern 2: Namespace Assignment by Surface

**What:** One namespace per top-level surface. Components import only their namespace + `common` for shared primitives.

**When to use:** All components in this phase.

| Surface | Namespace | useTranslation call |
|---------|-----------|---------------------|
| OnboardingFlow + steps | `onboarding` | `useTranslation(['onboarding', 'common'])` |
| Dashboard tabs, cards, charts, AI, modals | `patient` | `useTranslation(['patient', 'common'])` |
| SettingsPage + all settings sub-components | `settings` | `useTranslation(['settings', 'common'])` |
| KB UI (RelatedArticlesFooter + future KB viewer) | `kb` | `useTranslation(['kb', 'common'])` |
| Clinic workspace + ClinicInvitePage | `clinic` | `useTranslation(['clinic', 'common'])` |

### Pattern 3: Key Naming Convention

**What:** Hierarchical dotted keys mirroring the component's visual hierarchy. Namespace prefix in `t()` call via separator `':'`.

**When to use:** Every new key in this phase.

```
// good: descriptive, greppable, stable
patient:card.dose_log.title          → "Log dose"
patient:card.dose_log.empty_title    → "No injections logged"
patient:card.dose_log.empty_body     → "Log your first dose to start your med-level curve."
onboarding:step.body.label_name      → "Your name"
onboarding:step.body.placeholder_name → "First name"
settings:section.language.title      → "Language"
settings:section.language.body       → "Choose the language used across the app and email reminders."

// ICU plural (match existing common.json pattern):
patient:injection_one                → "{{count}} injection logged"
patient:injection_other              → "{{count}} injections logged"
```

### Pattern 4: i18next-parser Extraction Workflow

**What:** Run `npm run i18n:extract` after keying a wave. The parser auto-discovers all `t('ns:key')` calls and upserts keys into `public/locales/en/{ns}.json`. Machine-translate the delta to `public/locales/es/{ns}.json`.

**When to use:** After completing each wave's component edits.

```bash
# 1. Key the components (edit TSX files)
# 2. Extract to en/ catalog
cd leanshot && npm run i18n:extract

# 3. Git diff shows new keys in public/locales/en/*.json
git diff public/locales/en/

# 4. Machine-translate delta keys to es/ (executor does this inline via Claude)
# 5. Verify parity
npm run i18n:check

# 6. Confirm CI gate passes
npx i18next-parser && git diff --quiet -- public/locales
```

### Pattern 5: Locale Injection in Playwright (Consumer Surface)

**What:** The consumer surface has no router. Locale is set via `?lang=es` querystring (detected by `i18next-browser-languagedetector`). No `addInitScript` or localStorage seed needed.

**When to use:** All i18n Playwright specs on the consumer surface.

```typescript
// Source: e2e/i18n-language-switch.spec.ts + e2e/i18n-lazy-load.spec.ts patterns
test('ES smoke — onboarding renders Spanish', async ({ page }) => {
  await page.goto('/?lang=es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
  // Now assert ES strings render, e.g.:
  // await expect(page.locator('[data-testid="onboarding-cta"]'))
  //   .toHaveText('Comenzar');  // NOT "Get started" (EN fallthrough)
});
```

### Anti-Patterns to Avoid

- **Keying `aria-label` attributes eagerly:** `eslint-plugin-i18next` with `mode: 'jsx-text-only'` does NOT require aria-label strings to be keyed — only JSX text nodes. Do not key aria-labels unless they're user-visible UI strings that change meaning across locales.
- **Dynamic key construction:** `t('patient:' + cardTitle)` is invisible to i18next-parser. Always use string literals. [VERIFIED: i18next-parser.config.js comment lines 27-34 explain the limitation explicitly]
- **Importing locales eagerly:** Never `import esJson from '/locales/es/patient.json'`. Always rely on `http-backend` lazy loading. The bundle ceiling (Phase 24) prohibits catalog eager imports.
- **Interpolation with HTML:** Use `<Trans>` component for strings containing `<strong>` or `<br>` tags. The init.ts config already sets `transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'p']`.
- **Asserting English-fallthrough in smoke tests:** es-smoke assertions MUST check ES text renders, not just that the page loads. A missing key silently falls back to the key string `[MISSING:ns:key]` in dev — the test must catch this.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Catalog parity check | Custom diff script | `scripts/check-locale-coverage.sh` | Already implemented; uses jq leaf-path diff; CI-wired |
| Catalog extraction | Manual key inventory | `npm run i18n:extract` (i18next-parser) | Already configured; walks all TSX + excludes tests |
| Missing key telemetry | Custom error boundary | `missing-key-handler.ts` | Already dedup-caches PostHog `i18n_missing_key` events |
| Locale detection | Custom URL parser | `i18next-browser-languagedetector` | Already configured: `querystring > cookie > localStorage > navigator` |
| Intl formatting | Custom date/number formatters | `useLocale()` hook | Already ships memoized `Intl.DateTimeFormat/NumberFormat/RelativeTimeFormat` |
| ES Postgres text search | New tsvector trigger | Existing `search_vector_es` GENERATED STORED column | Phase 37 already shipped the GIN index + `search_kb_articles(p_locale='es')` RPC |
| ES KB articles migration | New `ALTER TABLE` | kb_articles already has `title_es`, `body_es` columns | Zero DB migration needed |
| i18n smoke framework | Custom test runner | `@playwright/test` + `e2e/i18n/` pattern | Playwright + existing Phase 32 i18n spec patterns are the established approach |

**Key insight:** Phase 37 shipped the entire Postgres ES text search stack. The kb.json namespace and KB UI string-keying is the only new work on that surface. No SQL migration is needed for I18N-14.

---

## Common Pitfalls

### Pitfall 1: Parser Invisible Dynamic Keys

**What goes wrong:** Executor writes `t(\`patient:card.${name}.title\`)` to avoid repetition. i18next-parser extracts zero keys for this pattern. The en/*.json file is never populated. CI fails with parser drift.

**Why it happens:** The parser uses static AST analysis, not runtime evaluation. Interpolated template literals and dynamic object lookups are invisible.

**How to avoid:** All `t()` calls must use string literals. Use a lookup object if multiple similar keys exist: `const KEY_MAP = { foo: t('patient:card.foo.title'), bar: t('patient:card.bar.title') }`.

**Warning signs:** `git diff public/locales` after `npm run i18n:extract` shows no new keys for a wave that edited many components.

### Pitfall 2: EN Fallthrough Masking Missing ES Keys

**What goes wrong:** `es/patient.json` is missing a key. i18next silently falls back to the EN string. The component renders English. The smoke test passes because the visible text "looks fine."

**Why it happens:** i18next's fallback chain is: language → fallbackLng (`en`). In production, `parseMissingKeyHandler` is undefined (only set in DEV), so no `[MISSING:...]` marker appears.

**How to avoid:** The es-smoke Playwright spec MUST assert specific ES strings, not just absence-of-errors. Assert actual Spanish words. `scripts/check-locale-coverage.sh` must exit 0 before the smoke test is considered meaningful.

**Warning signs:** `npm run i18n:check` shows FAIL rows for any in-scope namespace.

### Pitfall 3: `keepRemoved: true` Parser Behavior

**What goes wrong:** `i18next-parser.config.js` has `keepRemoved: true` + `failOnUpdate: false`. After extraction, the git diff includes old keys that still appear in en/*.json (not actually removed). Executor treats this as "no changes" and skips ES translation for those keys.

**Why it happens:** `keepRemoved: true` preserves keys that have no source `t()` callsite — the rationale is preserving bootstrap keys. This is correct behavior but counterintuitive.

**How to avoid:** After extraction, focus the ES translation delta on NEWLY ADDED keys only (those in the `git diff` that are pure additions). Existing `{}` placeholders in the empty namespace files will be entirely replaced by the first extraction run.

**Warning signs:** `git diff public/locales/en/patient.json` shows pre-existing keys alongside new ones — that is correct.

### Pitfall 4: Clinic Scope Confusion — Patient-Facing vs. Clinician-Facing

**What goes wrong:** Executor keys clinician-admin strings (roster management, analytics, billing) under the `clinic` namespace. These are NOT patient-facing and are OUT OF SCOPE.

**Why it happens:** `src/components/clinic/` contains both patient-facing pages (ClinicInvitePage — patient consents to clinic access) and clinician-admin pages (ClinicWorkspace, ClinicDashboardOverview — clinician views).

**How to avoid:** The `clinic` namespace covers strings shown to PATIENTS in clinic-related flows: clinic invitation acceptance page (`ClinicInvitePage`, `ConsentDialog`, `InviteSignupForm`) and any patient-side copy about their clinic relationship. Strings shown only to clinician-operators (roster, alerts panel, billing) are admin-surface and OUT OF SCOPE.

**Warning signs:** Executor adds clinician-admin terms like "Patient roster", "Invite patient", "Org metrics" to `clinic.json`.

### Pitfall 5: Consumer Surface Has No Router — Smoke Test Must Use Zustand-Tab Pattern

**What goes wrong:** Smoke test navigates to `/dose-log`, `/settings`, `/kb` as if they are URL routes. The SPA has no router; these paths 404.

**Why it happens:** The consumer surface uses `setTab()` + Zustand `currentTab` state, not URL routing. The `testDir: './e2e'` in `playwright.config.ts` expects specs in `e2e/`, not `tests/`.

**How to avoid:** The smoke test seeds initial state via localStorage (`localStorage.setItem('leanshot_v4', JSON.stringify({...}))`) using `page.addInitScript`, then clicks UI elements to trigger tab transitions. Navigate only to `/?lang=es` as the entry point. `tests/i18n/` is wrong location — use `e2e/i18n/es-smoke.spec.ts` to match the existing testDir config.

**Warning signs:** Playwright test gets 404 on navigation to `/dashboard` or `/onboarding`.

### Pitfall 6: ICU Interpolation Breaking on Translation

**What goes wrong:** Machine translation converts `"{{count}} injections logged"` to `"{{recuento}} inyecciones registradas"` — translating the variable name inside `{{}}`. i18next does not find the `recuento` variable and renders `{{recuento}}` literally.

**Why it happens:** Machine translation tools sometimes translate content inside interpolation markers.

**How to avoid:** In all translation instructions to the executor: preserve `{{variableName}}` markers verbatim. Only translate surrounding text. The `check-locale-coverage.sh` only checks key parity, not ICU syntax — a separate ICU validation step is needed (see Validation Architecture).

**Warning signs:** Rendered strings show `{{...}}` literally in the UI when locale=es.

---

## Code Examples

### Keying a Dashboard Card

```typescript
// Source: pattern from existing src/components/layout/Sidebar.tsx + MobileNav.tsx
import { useTranslation } from 'react-i18next';

export function SiteRotationCard() {
  const { t } = useTranslation(['patient', 'common']);

  return (
    <Card span={6}>
      <CardHeader title={t('patient:card.site_rotation.title')} />
      <Legend color="var(--color-warning)" label={t('patient:card.site_rotation.legend_recent')} />
      <Legend color="var(--color-success)" label={t('patient:card.site_rotation.legend_next')} />
    </Card>
  );
}
```

### Keying a Plural String

```typescript
// Source: common.json pattern — injection_one / injection_other
// en/patient.json:
// { "dose_count_one": "{{count}} dose logged", "dose_count_other": "{{count}} doses logged" }

const { t } = useTranslation('patient');
const label = t('patient:dose_count', { count: injections.length });
```

### Keying an OnboardingFlow Step

```typescript
// Source: OnboardingFlow.tsx line 344-461 inline strings
// en/onboarding.json key convention:
// { "step": { "body": { "label_name": "Your name", "placeholder_name": "First name" } } }

const { t } = useTranslation('onboarding');
<Input label={t('onboarding:step.body.label_name')}
       placeholder={t('onboarding:step.body.placeholder_name')} />
```

### ES Smoke Test Pattern

```typescript
// Source: e2e/i18n-language-switch.spec.ts pattern + playwright.config.ts opt-in pattern
// File: e2e/i18n/es-smoke.spec.ts

import { expect, test } from '@playwright/test';

const ES_SMOKE_OPT_IN = process.env.PLAYWRIGHT_RUN_ES_SMOKE === '1';

// Seed a minimal onboarded user state for tab-navigation smoke
const SMOKE_STATE = {
  user: { name: 'Test', locale: 'es', /* ... minimal */ },
  injections: [],
  // ... minimal PersistedState
};

test.describe('Phase 58 — ES smoke: critical patient flow in Spanish', () => {
  test.skip(!ES_SMOKE_OPT_IN, 'opt-in via PLAYWRIGHT_RUN_ES_SMOKE=1');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((state) => {
      localStorage.setItem('leanshot_v4', JSON.stringify(state));
    }, SMOKE_STATE);
  });

  test('onboarding renders Spanish', async ({ page }) => {
    await page.goto('/?lang=es');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
    // Assert an ES string from onboarding.json (NOT EN fallthrough)
    await expect(page.getByText(/Tu nombre/i)).toBeVisible();  // "Your name" in ES
  });

  test('dashboard dose-log tab renders Spanish', async ({ page }) => {
    await page.goto('/?lang=es');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
    // Click through to medication tab via Zustand tab switcher
    // Assert ES clinical string renders
  });
});
```

### EN→ES Machine Translation Protocol for Executors

```
Rules for machine-translating en/*.json to es/*.json:

1. Preserve ALL interpolation markers VERBATIM: {{count}}, {{name}}, {{date}}, etc.
   BAD:  "{{conteo}} dosis registradas"
   GOOD: "{{count}} dosis registradas"

2. Plural suffix convention is ENGLISH: _one / _other (NOT _uno / _otro).
   The suffix is i18next's internal pluralSeparator, not translated.
   BAD:  "dose_count_uno", "dose_count_otro"
   GOOD: "dose_count_one", "dose_count_other"

3. JSON key structure MUST be byte-for-byte identical to en/*.json (same nesting, same key names).
   Only the string VALUES change (the translations).

4. Clinical flag — mark the following ES strings with a comment in the glossary file
   (NOT in the JSON — JSON must be pure key/value):
   - Any dosing amounts: e.g., "mg", "mL", "unidades"
   - Medication names: Ozempic, Wegovy, Mounjaro, Zepbound, semaglutida, tirzepatida
   - Side effect terms: náuseas, vómitos, diarrea, estreñimiento
   - Anatomical sites: abdomen, muslo, brazo

5. Latin-American neutral Spanish. Avoid Spain-specific vosotros/vos forms.
   Use "tú" address form for user-facing copy, "usted" for formal settings sections.
```

---

## Detailed Surface Scope + Wave Grouping

The following breakdown gives the planner disjoint file-set assignments per wave (enabling parallel worktrees with zero file overlap).

### Wave A — Onboarding Namespace (~9 files, `onboarding` ns)

**Files:**
- `src/components/onboarding/OnboardingFlow.tsx` (1,206 lines; ~32 inline string patterns — HIGHEST density)
- `src/components/onboarding/ConsumerOnboardingRenderer.tsx` (GOAL_OPTIONS labels: 8 strings)
- `src/components/onboarding/ProgressIndicator.tsx`
- `src/components/onboarding/UnitToggle.tsx`
- `src/components/onboarding/AnonymousPreviewView.tsx`
- `src/components/onboarding/FirstActionSurface.tsx`
- `src/components/onboarding/social-proof/LiveSignupCounter.tsx`
- `src/components/onboarding/social-proof/TestimonialRotator.tsx`

**Clinical strings to flag:** dosing unit labels (mg, mL, units), medication names, weight/height labels.

### Wave B — Dashboard Core (tabs + cards, `patient` ns)

**Files (tabs):**
- `src/components/dashboard/tabs/HomeTab.tsx`
- `src/components/dashboard/tabs/MedicationTab.tsx` (dense clinical: ~30 strings)
- `src/components/dashboard/tabs/BodyTab.tsx`
- `src/components/dashboard/tabs/ActivityTab.tsx`
- `src/components/dashboard/tabs/NutritionTab.tsx`
- `src/components/dashboard/tabs/MoodTab.tsx`
- `src/components/dashboard/tabs/SymptomsTab.tsx`
- `src/components/dashboard/tabs/SupplementsTab.tsx`
- `src/components/dashboard/tabs/InsightsTab.tsx`

**Files (cards):**
- All 15 files under `src/components/dashboard/cards/`

**Clinical strings to flag:** "Current dose", "Estimated medication levels", "Doses remaining", injection sites, side effect names, symptom names.

### Wave C — Dashboard Overlays (AI + modals + charts, `patient` ns)

**Files:**
- `src/components/dashboard/ai/AIChatPanel.tsx`
- All files under `src/components/dashboard/modals/`
- `src/components/dashboard/charts/` (any user-visible labels)
- `src/components/layout/GreetingStrip.tsx` (already uses `useLocale` but has inline strings)
- `src/components/layout/Topbar.tsx` (already uses i18n but has nav strings)
- `src/components/layout/Sidebar.tsx` (already uses i18n)
- `src/components/layout/MobileNav.tsx` (already uses i18n)

Note: Layout files already import `useTranslation('nav')` — audit for any inline patient strings.

### Wave D — Settings + KB (settings ns + kb ns)

**Files (settings):**
- `src/components/dashboard/settings/SettingsPage.tsx` (~25 inline strings: section titles, body copy)
- `src/components/dashboard/settings/cancellation/CancellationModal.tsx` + step components
- `src/components/dashboard/settings/cancellation/OfferCard.tsx`
- `src/components/dashboard/settings/cancellation/PauseControls.tsx`
- All other non-test files in `src/components/dashboard/settings/`

**Files (kb):**
- `src/components/kb/RelatedArticlesFooter.tsx` (has inline "Related articles" string)

### Wave E — Clinic User-Facing (clinic ns)

**In-scope (patient-side only):**
- `src/components/clinic-invite/ClinicInvitePage.tsx`
- `src/components/clinic-invite/ConsentDialog.tsx` (if exists)
- `src/components/clinic-invite/InviteSignupForm.tsx` (if exists)

**Out-of-scope (clinician-admin, leave as-is):**
- `src/components/clinic/ClinicWorkspace.tsx`
- `src/components/clinic/dashboard/ClinicDashboardOverview.tsx`
- All clinician-facing roster, alerts, billing, settings surfaces

---

## KB Surface Research: What Actually Needs Doing

Phase 37 shipped a complete ES KB stack. The I18N-14 requirement maps to these specific deliverables:

1. **Populate `kb_articles.title_es` + `body_es`** for existing global KB articles — this is a content task (machine-translate KB article body text), NOT a schema migration.
2. **Key the KB UI components** (`kb.json` namespace) — the `RelatedArticlesFooter` has one inline string "Related articles" that needs `t('kb:related_articles.title')`.
3. **Verify** the `search_kb_articles(p_locale='es')` RPC returns ES titles (the column and index already exist from Phase 37).
4. **locale_set column** — `kb_articles.locale_set text[] DEFAULT array['en']` exists. After populating ES content, UPDATE articles to set `locale_set = array['en','es']`. This enables the locale picker in the KB UI.

**No migration needed.** The FTS migration (`20270707000005_helpdesk_fts_index.sql`) that creates `search_vector_es` is already applied.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline English strings in JSX | `t('ns:key')` calls + JSON catalogs | Phase 32 (for nav/admin/common) | Phase 58 extends this to patient surfaces |
| No ES text search in KB | STORED GENERATED tsvector + GIN + SECDEF RPC | Phase 37 | No new migration; just populate content |
| No locale parity CI gate | `check-locale-coverage.sh` + `i18n-gate.yml` | Phase 32 | Gate already runs on every PR |
| `failOnUpdate: true` in i18next-parser | `failOnUpdate: false` + git-diff check | Phase 32 Plan 32-02 | v9.4.0 incompatibility with `keepRemoved:true`; git-diff check is equivalent |

**Deprecated/outdated:**
- REQUIREMENTS.md I18N-11 references a "TMX import script" — this never materialized. The actual deliverable is direct string keying + machine translation. No `scripts/import-tmx.ts` should be created.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `clinic` namespace covers ClinicInvitePage (patient-side) but NOT ClinicWorkspace (clinician-side) — based on CONTEXT "clinic user-facing strings" | Wave E scope | If clinician strings also need keying, Wave E scope doubles; unlikely given CONTEXT OUT rule |
| A2 | `kb_articles` global KB articles already have English content in `title`/`body` columns (populated by Phase 37 seeding) | KB surface | If no articles seeded, Wave D has nothing to machine-translate for body_es; a seed fixture would be needed |
| A3 | The SettingsPage `LanguageSwitcher` is already reachable in the consumer shell (CONTEXT says "verify it's reachable") | Architecture | Already confirmed: SettingsPage.tsx uses `useTranslation` and LanguageSwitcher is imported — it IS wired |

---

## Open Questions (RESOLVED)

> RESOLVED in planning: Q1 (clinic boundary) — plan 58-03 scopes ONLY clinic-invite/ patient-side components with a `git diff` scope-guard excluding clinic/ workspace. Q2 (KB seed) — plan 58-04 Task 3 handles both existing-articles (UPDATE) and no-articles (INSERT seed) cases.

1. **Clinic namespace exact boundary**
   - What we know: CONTEXT says "clinic user-facing strings" — ClinicInvitePage is clearly in-scope (patient accepts invite). ClinicWorkspace is likely out-of-scope (clinician-only).
   - What's unclear: ClinicBillingCard, ClinicContextBar, ClinicDrillInPage — are these ever patient-visible?
   - Recommendation: Treat ClinicInvitePage + its sub-components (ConsentDialog, InviteSignupForm) as the clinic namespace scope. Skip ClinicWorkspace and all clinician dashboard components.

2. **KB article content seed**
   - What we know: The schema has `title_es`/`body_es` but no seed data confirmed.
   - What's unclear: Do global KB articles exist with English content that can be machine-translated?
   - Recommendation: Wave D executor checks for existing articles via `supabase` CLI or direct count; if none, creates 2-3 seed articles with ES translations as part of Phase 58 deliverable.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm run i18n:extract, vitest | ✓ | v22.18.0 | — |
| jq | check-locale-coverage.sh | [ASSUMED] available on dev machine | — | `brew install jq` |
| i18next-parser | npm run i18n:extract | ✓ | 9.4.0 (in node_modules) | — |
| @playwright/test | es-smoke.spec.ts | ✓ | ^1.59.1 | — |
| Supabase CLI | Verify search_kb_articles RPC | [ASSUMED] available | — | Skip live RPC verify; unit-test RPC with mock |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** jq (use `brew install jq` if absent).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (unit) + @playwright/test (i18n smoke) |
| Config file | `vitest.config.ts` (unit); `playwright.config.ts` (smoke) |
| Quick run command | `npm run i18n:check` (parity gate) |
| Full suite command | `PLAYWRIGHT_RUN_ES_SMOKE=1 npx playwright test e2e/i18n/es-smoke.spec.ts --project=p58-es-smoke` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| I18N-11 | All in-scope namespaces have EN keys extracted from source | CI gate | `npm run i18n:extract && git diff --quiet -- public/locales` | ✅ `i18n-gate.yml` |
| I18N-12 | Clinical glossary file exists with EN/ES pairs + signoff-pending flag | file existence | `test -f docs/clinical-glossary.md` | ❌ Wave 0 |
| I18N-13 | TRANSLATOR-WORKFLOW.md exists | file existence | `test -f docs/TRANSLATOR-WORKFLOW.md` | ❌ Wave 0 |
| I18N-13 | EN↔ES parity passes per namespace | CI gate | `npm run i18n:check` | ✅ `scripts/check-locale-coverage.sh` |
| I18N-14 | KB search RPC returns ES results when p_locale='es' | integration smoke | `PLAYWRIGHT_RUN_ES_SMOKE=1 playwright test --grep "KB search"` | ❌ Wave 0 |
| I18N-15 | ES smoke: signup→onboarding→dose log→AI chat→cancel→KB search renders Spanish | e2e | `PLAYWRIGHT_RUN_ES_SMOKE=1 playwright test e2e/i18n/es-smoke.spec.ts` | ❌ Wave 0 |

### ICU Syntax Validation (NEW — no existing gate)

The existing `check-locale-coverage.sh` only checks key parity, not ICU syntax validity. A broken `{{` interpolation in es/*.json is not caught. The planner should include a Wave 0 task to add an ICU validation step:

```bash
# Validate no broken interpolation markers in es/ catalogs
# Simple approach: jq validates JSON; broken {{...}} won't be caught by jq.
# Use a grep-based check for untranslated interpolation vars:
grep -r "{{[a-záéíóúñ]" public/locales/es/ && echo "FAIL: translated interpolation variable name" && exit 1 || echo "OK: interpolation vars preserved"
```

Add this check to `i18n-gate.yml` as Gate 3.

### Sampling Rate

- **Per task commit:** `npm run i18n:check` (fast; ~2s)
- **Per wave merge:** `npm run i18n:extract && git diff --quiet -- public/locales`
- **Phase gate:** `PLAYWRIGHT_RUN_ES_SMOKE=1 npx playwright test e2e/i18n/es-smoke.spec.ts --project=p58-es-smoke` green before `/gsd:verify-work`

### Playwright Config Addition Required

Add to `playwright.config.ts` (Wave 0):

```typescript
const ES_SMOKE_OPT_IN = process.env.PLAYWRIGHT_RUN_ES_SMOKE === '1';
// ...in testIgnore array:
/e2e\/i18n\/es-smoke\.spec\.ts$/,  // exclude from default chromium run
// ...in projects array:
...(ES_SMOKE_OPT_IN ? [{
  name: 'p58-es-smoke',
  testMatch: [/e2e\/i18n\/es-smoke\.spec\.ts$/],
  use: { ...devices['Desktop Chrome'] },
}] : []),
```

### Wave 0 Gaps

- [ ] `e2e/i18n/es-smoke.spec.ts` — covers I18N-15 + I18N-14 KB branch
- [ ] `docs/clinical-glossary.md` — covers I18N-12 (EN/ES term pairs, signoff-pending)
- [ ] `docs/TRANSLATOR-WORKFLOW.md` — covers I18N-13
- [ ] `playwright.config.ts` — add `ES_SMOKE_OPT_IN` + `p58-es-smoke` project + testIgnore entry
- [ ] `public/locales/en/{onboarding,patient,settings,kb,clinic}.json` — all populated from source extraction (Waves A-E)
- [ ] `public/locales/es/{onboarding,patient,settings,kb,clinic}.json` — all populated from machine translation
- [ ] ICU interpolation validation gate in `.github/workflows/i18n-gate.yml`

---

## Security Domain

> `security_enforcement` absent from config → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Not relevant to i18n phase |
| V3 Session Management | no | Not relevant |
| V4 Access Control | no | Not relevant |
| V5 Input Validation | yes (partial) | KB search: `search_kb_articles` already validates p_locale against allowlist; ICU keys validated via CI gate |
| V6 Cryptography | no | Not relevant |

### Known Threat Patterns for i18n Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via translated strings containing `<script>` | Tampering | i18next `interpolation: { escapeValue: false }` is set — but React's JSX escaping catches this for JSX text nodes. Only `dangerouslySetInnerHTML` is a risk; none used in patient surfaces |
| Locale injection via `?lang=` param | Spoofing | `supportedLngs: ['en','es']` in init.ts + `load: 'languageOnly'` means unsupported locales fall back to EN; no XSS vector |
| Missing key fallback leaking key names | Information Disclosure | In production, `parseMissingKeyHandler` is undefined — key name not shown; PostHog event fires instead |

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — `src/lib/i18n/init.ts`, `i18next-parser.config.js`, `scripts/check-locale-coverage.sh`, `.github/workflows/i18n-gate.yml`, `playwright.config.ts`
- Direct codebase inspection — `supabase/migrations/20270707000005_helpdesk_fts_index.sql`, `20270707000006_helpdesk_search_kb_fn.sql`
- Direct codebase inspection — `public/locales/en/{common,nav,admin}.json` (reference for ICU/plural patterns)
- Direct codebase inspection — `e2e/i18n-language-switch.spec.ts`, `e2e/i18n-lazy-load.spec.ts` (Playwright locale pattern)

### Secondary (MEDIUM confidence)

- `package.json` version pins: i18next@26.2.0, react-i18next@17.0.8, i18next-parser@9.4.0 confirmed via `npm view`
- Component file survey: inline string density confirmed by grep across dashboard, onboarding, settings

### Tertiary (LOW confidence)

- Wave grouping file counts — estimated from `find` output; actual string density per file may vary
- "~70-80 files in scope" estimate — based on total non-test TSX files found in in-scope directories

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed and confirmed via package.json + npm view
- Architecture: HIGH — init.ts + detector config + parser config fully examined; no assumptions about infra
- KB/Postgres: HIGH — migrations directly read; search_vector_es, title_es/body_es columns confirmed present
- Playwright pattern: HIGH — existing i18n specs examined; opt-in pattern confirmed from playwright.config.ts
- Pitfalls: HIGH — based on direct i18next-parser.config.js inline comments + existing workaround explanations
- Wave scoping: MEDIUM — file counts from find; exact string density requires per-file examination by executor

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable i18n ecosystem; i18next v26 stable)
