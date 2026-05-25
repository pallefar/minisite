# Phase 58: Spanish i18n Wiring — Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 28 new/modified files across 5 waves + 4 infrastructure files
**Analogs found:** 10 / 10 file groups

---

## File Classification

| New/Modified File Group | Role | Data Flow | Closest Analog | Match Quality |
|------------------------|------|-----------|----------------|---------------|
| `public/locales/en/{onboarding,patient,settings,kb,clinic}.json` | config/data | transform | `public/locales/en/common.json` | exact |
| `public/locales/es/{onboarding,patient,settings,kb,clinic}.json` | config/data | transform | `public/locales/es/common.json` | exact |
| `src/components/onboarding/OnboardingFlow.tsx` (edit) | component | request-response | `src/components/dashboard/cards/SiteRotationCard.tsx` + `src/components/dashboard/cards/SymptomCard.tsx` | role-match (inline→t() pattern) |
| `src/components/dashboard/cards/*.tsx` (edits, Wave B) | component | request-response | `src/components/dashboard/cards/SymptomCard.tsx` | exact (inline string component with CardHeader) |
| `src/components/dashboard/tabs/*.tsx` (edits, Wave B) | component | request-response | `src/components/layout/GreetingStrip.tsx` | role-match (useTranslation 'common' ns, single-ns pattern) |
| `src/components/dashboard/ai/AIChatPanel.tsx` + modals (Wave C) | component | event-driven | `src/components/layout/Topbar.tsx` | role-match (multi-namespace useTranslation) |
| `src/components/dashboard/settings/SettingsPage.tsx` + sub (Wave D) | component | request-response | `src/components/layout/Sidebar.tsx` | role-match (multi-namespace + t() in NAV array) |
| `src/components/kb/RelatedArticlesFooter.tsx` (Wave D) | component | request-response | `src/components/dashboard/cards/SymptomCard.tsx` | role-match (CardHeader inline title → t()) |
| `src/components/clinic-invite/ClinicInvitePage.tsx` + sub (Wave E) | component | request-response | `src/components/dashboard/cards/SymptomCard.tsx` | role-match (inline string component) |
| `e2e/i18n/es-smoke.spec.ts` | test | request-response | `e2e/i18n-profile-locale-persistence.spec.ts` | exact (addInitScript + ?lang=es + opt-in pattern) |
| `.github/workflows/i18n-gate.yml` (edit) | config/CI | batch | self (existing two-gate workflow) | self-analog |
| `scripts/check-locale-coverage.sh` (no edit needed) | utility | batch | self | self-analog |
| `playwright.config.ts` (edit) | config | — | self (existing opt-in project pattern) | self-analog |
| `docs/clinical-glossary.md` | docs | — | none (new artifact) | no analog |
| `docs/TRANSLATOR-WORKFLOW.md` | docs | — | none (new artifact) | no analog |

---

## Pattern Assignments

### 1. Locale JSON Files — `public/locales/{en,es}/{onboarding,patient,settings,kb,clinic}.json`

**Analog:** `public/locales/en/common.json` (lines 1-47) + `public/locales/es/common.json` (lines 1-47)

**Key structure pattern** (`public/locales/en/common.json` lines 1-47):
```json
{
  "action": {
    "cancel": "Cancel",
    "close": "Close",
    "confirm": "Confirm",
    "continue": "Continue",
    "delete": "Delete",
    "save": "Save"
  },
  "day_remaining_one": "{{count}} day remaining",
  "day_remaining_other": "{{count}} days remaining",
  "error": {
    "network": "Network error. Please try again.",
    "unauthorized": "You don't have permission to do that.",
    "unknown": "Something went wrong."
  },
  "injection_zero": "No injections logged",
  "injection_one": "{{count}} injection logged",
  "injection_other": "{{count}} injections logged"
}
```

**ES translation pattern** (`public/locales/es/common.json` lines 1-47) — shows 3 rules:
1. `{{count}}` preserved verbatim, surrounding text translated.
2. `_one` / `_other` suffix stays in English (i18next internal pluralSeparator).
3. Nested object structure byte-for-byte identical to EN.

```json
{
  "action": {
    "cancel": "Cancelar",
    "close": "Cerrar"
  },
  "day_remaining_one": "Queda {{count}} día",
  "day_remaining_other": "Quedan {{count}} días",
  "injection_zero": "Sin inyecciones registradas",
  "injection_one": "{{count}} inyección registrada",
  "injection_other": "{{count}} inyecciones registradas"
}
```

**Nav flat-key pattern** (`public/locales/en/nav.json` lines 1-42) — flat keys, no nesting:
```json
{
  "activity": "Activity",
  "fab_log_dose": "Log dose",
  "lang_en": "English",
  "lang_es": "Spanish",
  "lang_label": "Language",
  "tab_short_medication": "Shot"
}
```

**Key naming rules for new namespaces:**
- Hierarchical dotted keys: `patient:card.site_rotation.title`, `onboarding:step.body.label_name`
- Plurals: `patient:dose_count_one` / `patient:dose_count_other`
- ICU interpolation: `"{{count}} dosis registradas"` (count preserved verbatim in ES)
- Flat keys for standalone labels (mirror `nav.json`); nested objects for grouped sections (mirror `common.json` `action.*`, `error.*`)

---

### 2. Wave A — Onboarding Components (onboarding namespace)

**Primary analog for before→after pattern:** `src/components/dashboard/cards/SiteRotationCard.tsx` (lines 1-67) — shows a component with ZERO i18n that has CardHeader inline title + legend labels.

**Current inline pattern in target** (`src/components/onboarding/OnboardingFlow.tsx` lines 344-408):
```tsx
// BEFORE — inline strings to extract
<Input
  label="Your name"
  placeholder="First name"
  autoComplete="given-name"
  value={draft.name}
  onChange={(e) => update({ name: e.target.value })}
/>
<p className="text-[11px] font-semibold ...">Units</p>
<h1 className="text-[26px] font-bold tracking-tight">Your medication</h1>
<p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
  We'll tailor everything to your med.
</p>
<option value="">Select…</option>
<option value="ozempic">Ozempic (semaglutide)</option>
```

**Import pattern to add** (copy from `src/components/layout/GreetingStrip.tsx` line 2):
```tsx
import { useTranslation } from 'react-i18next';
```

**useTranslation hook pattern** (copy from `src/components/layout/GreetingStrip.tsx` line 22):
```tsx
const { t } = useTranslation('onboarding');
```

**For multi-namespace** (copy from `src/components/layout/Sidebar.tsx` line 78):
```tsx
const { t } = useTranslation(['onboarding', 'common']);
```

**AFTER pattern target:**
```tsx
const { t } = useTranslation(['onboarding', 'common']);
<Input
  label={t('onboarding:step.body.label_name')}
  placeholder={t('onboarding:step.body.placeholder_name')}
/>
<p className="text-[11px] font-semibold ...">{t('onboarding:step.body.units_label')}</p>
<h1>{t('onboarding:step.medication.title')}</h1>
<option value="">{t('onboarding:step.medication.select_placeholder')}</option>
<option value="ozempic">{t('onboarding:step.medication.ozempic')}</option>
```

**en/onboarding.json key structure to emit:**
```json
{
  "step": {
    "body": {
      "label_name": "Your name",
      "placeholder_name": "First name",
      "units_label": "Units",
      "headline": "Let's get started",
      "subhead": "Two minutes. Your data stays on this device — always."
    },
    "medication": {
      "title": "Your medication",
      "subhead": "We'll tailor everything to your med.",
      "select_placeholder": "Select…",
      "label_glp1": "GLP-1 medication",
      "ozempic": "Ozempic (semaglutide)",
      "wegovy": "Wegovy (semaglutide)",
      "mounjaro": "Mounjaro (tirzepatide)",
      "label_current_dose": "Current dose",
      "label_unit": "Unit",
      "label_start_date": "Start date"
    }
  }
}
```

**Static key lookup for dynamic label arrays** (copy pattern from `src/lib/i18n/nav-labels.ts` lines 19-52):
```tsx
// When OnboardingFlow iterates over GOAL_OPTIONS or medication list,
// use exhaustive switch (NOT template literal) so i18next-parser sees static keys:
function medicationLabel(t: TFunction, id: MedicationId): string {
  switch (id) {
    case 'ozempic': return t('onboarding:step.medication.ozempic');
    case 'wegovy':  return t('onboarding:step.medication.wegovy');
    // ... all cases
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
```

---

### 3. Wave B — Dashboard Cards and Tabs (patient namespace)

**Primary analog:** `src/components/dashboard/cards/SymptomCard.tsx` (full file, 77 lines) — canonical example of a card with inline title, empty state, and action button that needs keying.

**Current inline pattern in `SiteRotationCard.tsx`** (lines 33-55 — target for Wave B):
```tsx
<CardHeader
  title="Injection site"
  icon={<Syringe className="size-4" />}
/>
<Legend color="var(--color-warning)" label="Recent · avoid" />
<Legend color="var(--color-amber)" label="2 weeks ago" />
<Legend color="var(--color-success)" label="Next" />
```

**AFTER pattern:**
```tsx
import { useTranslation } from 'react-i18next';

export function SiteRotationCard() {
  const { t } = useTranslation('patient');
  // ... store selectors unchanged ...

  return (
    <Card span={4} variant="default" data-tour="sites">
      <CardHeader
        title={t('patient:card.site_rotation.title')}
        icon={<Syringe className="size-4" />}
      />
      <Legend color="var(--color-warning)" label={t('patient:card.site_rotation.legend_recent')} />
      <Legend color="var(--color-amber)" label={t('patient:card.site_rotation.legend_older')} />
      <Legend color="var(--color-success)" label={t('patient:card.site_rotation.legend_next')} />
    </Card>
  );
}
```

**SymptomCard inline pattern** (`src/components/dashboard/cards/SymptomCard.tsx` lines 19-72):
```tsx
// BEFORE
title="Side effects"
<Button ...>Log</Button>
<EmptyState
  title="No symptoms this week"
  body="That's a good sign — track if anything new shows up."
/>
<span>Recurring pattern detected — bring this to your prescriber if it persists.</span>

// AFTER
const { t } = useTranslation('patient');
title={t('patient:card.symptoms.title')}
<Button ...>{t('patient:card.symptoms.action_log')}</Button>
<EmptyState
  title={t('patient:card.symptoms.empty_title')}
  body={t('patient:card.symptoms.empty_body')}
/>
<span>{t('patient:card.symptoms.pattern_warning')}</span>
```

**Plural count pattern** (mirror `public/locales/en/common.json` lines 24-25):
```tsx
// en/patient.json:
// { "dose_count_one": "{{count}} dose logged", "dose_count_other": "{{count}} doses logged" }
const { t } = useTranslation('patient');
const label = t('patient:dose_count', { count: injections.length });
```

**HeroCard inline strings** (`src/components/dashboard/cards/HeroCard.tsx` lines 48-59) — clinical strings requiring glossary flagging:
```tsx
// BEFORE (inline, clinical):
let phase = 'Maintenance';
let phaseTip = 'Lock in habits.';
if (weeks < 4) { phase = 'Tolerance'; phaseTip = 'Take it slow.'; }
else if (weeks < 16) { phase = 'Titration'; phaseTip = 'Stay protein-focused.'; }
const direction = lost >= 0 ? 'Lost' : 'Gained';

// AFTER (keyed):
const { t } = useTranslation('patient');
const phase = weeks < 4
  ? t('patient:hero.phase_tolerance')
  : weeks < 16
  ? t('patient:hero.phase_titration')
  : t('patient:hero.phase_maintenance');
// phase_tip_* and direction_* keys similarly keyed
```

---

### 4. Wave C — Dashboard Overlays (patient namespace, continued)

**Primary analog for Topbar (already i18n'd) layout pattern** (`src/components/layout/Topbar.tsx` lines 1-46):
```tsx
import { useTranslation } from 'react-i18next';

export function Topbar(...) {
  const { t } = useTranslation(['nav', 'common']);
  // ...
  {t('nav:export', 'Export')}   // note: fallback string as 2nd arg
  {t('nav:fab_log_dose')}
}
```

**GreetingStrip pattern** (`src/components/layout/GreetingStrip.tsx` lines 21-73) — single namespace + helper function pattern:
```tsx
import { useTranslation } from 'react-i18next';

export function GreetingStrip() {
  const { t } = useTranslation('common');
  const name = useStore((s) => s.user?.name ?? t('profile_friend'));
  // ...
  const moodLabel = mood
    ? i18nMoodLabel(t, mood.mood as MoodLevel)  // static-key helper
    : t('mood_label_not_yet');
  // ...
  {t('mood_label_word')}
  {t('energy_label_word')}
}
```

**Wave C add:** `src/components/layout/GreetingStrip.tsx` already uses `useTranslation('common')` but still has inline patient strings (energy/mood chips use `t()` via helpers already). AIChatPanel and modals follow the same pattern as Sidebar for multi-namespace.

---

### 5. Wave D — Settings + KB (settings and kb namespaces)

**SettingsPage inline NAV array pattern** (`src/components/dashboard/settings/SettingsPage.tsx` lines 117-162):
```tsx
// BEFORE — NAV array has hard-coded English label strings:
const NAV: { id: Section; label: string; Icon: typeof UserIcon }[] = [
  { id: 'account', label: 'Account', Icon: UserIcon },
  { id: 'language', label: 'Language', Icon: Globe },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'phi-access-log', label: 'Who has viewed my data', Icon: Eye },
  // ...
];
```

**AFTER — static-key helper pattern** (same approach as `src/lib/i18n/nav-labels.ts` lines 19-52):
```tsx
// Move NAV labels out of the array into a t() call at render time,
// OR use a static switch helper — array initialization prevents literal-key extraction:
const { t } = useTranslation(['settings', 'common']);

// Option A: inline t() at render (preferred — parser sees each literal):
const NAV_LABELS: Record<Section, string> = {
  account: t('settings:nav.account'),
  language: t('settings:nav.language'),
  notifications: t('settings:nav.notifications'),
  'phi-access-log': t('settings:nav.phi_access_log'),
  // ...
};
```

**en/settings.json key structure:**
```json
{
  "nav": {
    "account": "Account",
    "profile": "Profile",
    "goals": "Goals",
    "language": "Language",
    "notifications": "Notifications",
    "leaderboards": "Leaderboards",
    "privacy": "Privacy",
    "phi_access_log": "Who has viewed my data",
    "security": "Security (2FA)",
    "shares": "Active shares",
    "organizations": "Active organizations",
    "recovery": "Recovery",
    "subscription": "Subscription",
    "data": "Data"
  },
  "section": {
    "language": {
      "title": "Language",
      "body": "Choose the language used across the app and email reminders."
    }
  }
}
```

**RelatedArticlesFooter inline title** (`src/components/kb/RelatedArticlesFooter.tsx` line 122):
```tsx
// BEFORE:
<CardHeader title="Related articles" />

// AFTER:
import { useTranslation } from 'react-i18next';
const { t } = useTranslation('kb');
<CardHeader title={t('kb:related_articles.title')} />
```

**en/kb.json key structure:**
```json
{
  "related_articles": {
    "title": "Related articles"
  }
}
```

---

### 6. Wave E — Clinic Patient-Facing (clinic namespace)

**Primary analog:** `src/components/clinic-invite/ClinicInvitePage.tsx` (lines 105-160) — this IS the target file; it currently uses all inline strings. The import and hook pattern to add:

```tsx
import { useTranslation } from 'react-i18next';

export function ClinicInvitePage() {
  const { t } = useTranslation('clinic');
  // state machine unchanged
  // render switch:
  // State H (load_error) — was: "There was a problem opening your invitation."
  // becomes: t('clinic:invite.error.load')
}
```

**en/clinic.json key structure (patient-side only):**
```json
{
  "invite": {
    "loading": "Opening invitation…",
    "error": {
      "load": "There was a problem opening your invitation.",
      "expired_title": "This invitation has expired",
      "already_used": "This invitation has already been used.",
      "canceled": "This invitation has been canceled."
    },
    "consent": {
      "title": "Clinic access request",
      "body": "{{orgName}} is requesting access to your LeanShot data.",
      "accept": "Accept",
      "decline": "Decline"
    },
    "signup": {
      "title": "Create your account",
      "body": "You've been invited to join {{orgName}}."
    },
    "magic_link": {
      "title": "Check your email",
      "body": "We sent a sign-in link to {{email}}."
    }
  }
}
```

---

### 7. ES Smoke Test — `e2e/i18n/es-smoke.spec.ts`

**Primary analog:** `e2e/i18n-profile-locale-persistence.spec.ts` (full file, 158 lines) — exact pattern for addInitScript state seeding + `?lang=es` + locale assertion.

**Imports and opt-in guard** (copy from `e2e/i18n-profile-locale-persistence.spec.ts` lines 28-36 + lines 92-94):
```typescript
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'leanshot_v4';
const TOUR_KEY = 'leanshot_tour_seen_v4';
```

**addInitScript seeding pattern** (copy from `e2e/i18n-profile-locale-persistence.spec.ts` lines 99-113):
```typescript
await page.addInitScript(
  ([key, val, tourKey]) => {
    try {
      localStorage.setItem(key as string, val as string);
      localStorage.setItem(tourKey as string, '1');
    } catch { /* private-mode noop */ }
  },
  [STORAGE_KEY, JSON.stringify(SEEDED_PERSISTED_STATE), TOUR_KEY],
);
```

**Locale assertion** (copy from `e2e/i18n-language-switch.spec.ts` lines 22-23):
```typescript
await page.goto('/?lang=es');
await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 5000 });
```

**Opt-in pattern** (copy from `playwright.config.ts` lines 9-11 — `ASO_OPT_IN` block):
```typescript
const ES_SMOKE_OPT_IN = process.env.PLAYWRIGHT_RUN_ES_SMOKE === '1';

test.describe('Phase 58 — ES smoke', () => {
  test.skip(!ES_SMOKE_OPT_IN, 'opt-in via PLAYWRIGHT_RUN_ES_SMOKE=1');
  // ...
});
```

**playwright.config.ts project block to add** (copy pattern from `playwright.config.ts` lines 193-203 — `P32_I18N_OPT_IN` block):
```typescript
const ES_SMOKE_OPT_IN = process.env.PLAYWRIGHT_RUN_ES_SMOKE === '1';

// In testIgnore array (chromium project, line ~94):
/e2e\/i18n\/es-smoke\.spec\.ts$/,

// In projects array (after existing conditional blocks):
...(ES_SMOKE_OPT_IN
  ? [{
      name: 'p58-es-smoke',
      testMatch: [/e2e\/i18n\/es-smoke\.spec\.ts$/],
      use: { ...devices['Desktop Chrome'] },
    }]
  : []),
```

**Seeded state structure** (copy shape from `e2e/i18n-profile-locale-persistence.spec.ts` lines 38-90 — `SEEDED_USER` + `SEEDED_PERSISTED_STATE`):
```typescript
// Minimal onboarded user — version: 7, state has all required PersistedState keys.
// Set locale: 'es' in SEEDED_USER to use profilesLocale detector (not just ?lang=).
// Set user.injections: [oneInjection] to enable dose-log tab rendering.
```

**Tab navigation pattern (no router):** The consumer SPA has no URL routing. After seeding state, click UI elements to navigate between tabs (Zustand `setTab`). Locate tab buttons via `page.getByRole('button', { name: /Shot/i })` (nav label) — do NOT navigate to `/medication` or `/dashboard`.

---

### 8. CI Gate Extension — `.github/workflows/i18n-gate.yml` (add Gate 3)

**Self-analog:** `.github/workflows/i18n-gate.yml` (lines 1-67) — two-gate structure; Gate 3 appends a new step after Gate 2.

**Existing two-gate structure** (lines 48-66):
```yaml
- name: i18n coverage gate (D-05 / D-06 — 100% per namespace)
  run: bash scripts/check-locale-coverage.sh

- name: i18n parser drift check (D-06 — fail on uncommitted catalog updates)
  run: |
    npx i18next-parser
    if ! git diff --quiet -- public/locales; then
      echo "::error::i18n catalog drift detected"
      exit 1
    fi
```

**Gate 3 to add — ICU interpolation variable check:**
```yaml
- name: i18n ICU interpolation guard (Gate 3 — P58 no translated variable names)
  run: |
    # Fails if any ES catalog value contains {{[a-záéíóúñ...]} —
    # a translated variable name inside interpolation markers.
    if grep -rE '\{\{[a-záéíóúñüÁÉÍÓÚÑÜ]' leanshot/public/locales/es/ 2>/dev/null; then
      echo "::error::ES catalog contains translated interpolation variable name (e.g. {{conteo}} instead of {{count}}). Fix the translation." >&2
      exit 1
    fi
    echo "Gate 3 OK: no translated interpolation variable names in ES catalogs."
```

---

### 9. `scripts/check-locale-coverage.sh` — No Edit Needed

**Self-analog** (full file, 102 lines). The script already iterates over ALL `public/locales/en/*.json` files including the 5 new namespaces. Once the new EN JSON files are populated (non-empty `{}`), the script automatically covers them. No edits required.

**Key behavior to understand** (lines 56-94):
- Iterates `for en_file in "$EN_DIR"/*.json` — auto-picks up new namespace files.
- `en_count` / `es_count` from `jq -r 'paths(scalars) | join(".")' | sort -u`.
- FAIL if `missing_in_es > 0 OR extra_in_es > 0`.
- Empty `{}` files count as 0 EN keys → PASS (trivially). Gate only bites after extraction populates EN.

---

## Shared Patterns

### `useTranslation` Import
**Source:** `src/components/layout/Sidebar.tsx` line 35, `src/components/layout/GreetingStrip.tsx` line 2
**Apply to:** ALL new component edits in Waves A-E
```tsx
import { useTranslation } from 'react-i18next';
```

### Single Namespace Hook
**Source:** `src/components/layout/GreetingStrip.tsx` line 22, `src/components/layout/MobileNav.tsx` line 54
**Apply to:** Components that only use one surface namespace (most dashboard cards)
```tsx
const { t } = useTranslation('patient');  // or 'onboarding' / 'settings' / 'kb' / 'clinic'
```

### Multi-Namespace Hook
**Source:** `src/components/layout/Sidebar.tsx` line 78, `src/components/layout/Topbar.tsx` line 46
**Apply to:** Components that pull from both surface namespace AND `common` (for shared actions/errors)
```tsx
const { t } = useTranslation(['patient', 'common']);
// Access: t('patient:card.foo.title') or t('common:action.save')
```

### Static Key Helper for Dynamic Arrays
**Source:** `src/lib/i18n/nav-labels.ts` lines 19-52 (exhaustive switch pattern)
**Apply to:** Any component iterating over a typed array of IDs where template literals would be used
```tsx
// Per i18next-parser.config.js line 34: functions: ['t'] — parser reads STATIC calls only.
// Template literals `t(\`ns:${id}\`)` produce ZERO extracted keys.
// Use exhaustive switch instead:
function getLabel(t: TFunction, id: SomeId): string {
  switch (id) {
    case 'foo': return t('patient:foo.label');
    case 'bar': return t('patient:bar.label');
    default: { const _exhaustive: never = id; return _exhaustive; }
  }
}
```

### Plural Key Convention
**Source:** `public/locales/en/common.json` lines 10-11 + 23-25
**Apply to:** Any key where a count determines singular/plural form
```json
// EN catalog — _one / _other (English suffixes regardless of target language):
{ "dose_count_one": "{{count}} dose logged", "dose_count_other": "{{count}} doses logged" }
```
```tsx
// Usage: pass { count: n } — i18next picks _one or _other automatically
t('patient:dose_count', { count: injections.length })
```

### Namespace Prefix Separator
**Source:** `i18next-parser.config.js` line 22 (`namespaceSeparator: ':'`)
**Apply to:** All `t()` calls that access a non-defaultNS namespace
```tsx
// Correct: 'patient:card.foo.title'
// Wrong: 'card.foo.title' (resolves to defaultNS 'common' — silent miss)
t('patient:card.site_rotation.title')
t('onboarding:step.body.label_name')
```

### `<Trans>` for JSX-embedded HTML
**Source:** `src/lib/i18n/init.ts` line 36 (`transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'p']`)
**Apply to:** Any translation string that contains `<strong>`, `<br>`, or `<em>` inline
```tsx
import { Trans } from 'react-i18next';
// en/patient.json: { "welcome_html": "Welcome to <strong>LeanShot</strong>" }
<Trans i18nKey="patient:welcome_html" />
// Never: dangerouslySetInnerHTML with translated content
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `docs/clinical-glossary.md` | docs | — | No existing clinical glossary; new artifact. Planner should author as markdown table: EN term, ES term, clinical-flag, signoff-pending status. |
| `docs/TRANSLATOR-WORKFLOW.md` | docs | — | No existing runbook. Planner should structure as: 1) Extract (`npm run i18n:extract`), 2) Translate delta, 3) Verify parity (`npm run i18n:check`), 4) Push (CI gate auto-runs). |

---

## KB Surface: No New Migration — Content-Only Work

**Confirmed** (`58-RESEARCH.md` lines 39-44 + Phase 37 migrations):
- `kb_articles.title_es` and `kb_articles.body_es` columns ALREADY EXIST (Phase 37).
- `search_vector_es` STORED GENERATED tsvector column and GIN index ALREADY EXIST.
- `search_kb_articles(p_locale='es')` SECDEF RPC ALREADY EXISTS.

**Wave D KB executor task:**
1. Query for existing KB articles via Supabase CLI (`supabase db execute "SELECT id, title FROM kb_articles LIMIT 10;"`).
2. Machine-translate `title` → `title_es`, `body` → `body_es` for each article.
3. UPDATE rows: `UPDATE kb_articles SET title_es = '...', body_es = '...', locale_set = array['en','es'] WHERE id = '...'`.
4. Key `RelatedArticlesFooter.tsx` — single string `t('kb:related_articles.title')`.
5. No migration file required.

---

## Wave-to-Parallel-Worktree Disjoint File Assignment

The planner can dispatch Waves A-E in parallel because the file sets are fully disjoint:

| Wave | Files Modified | Namespace | Locale JSON Output |
|------|---------------|-----------|-------------------|
| A | `src/components/onboarding/*.tsx` (~8 files) | `onboarding` | `en/onboarding.json`, `es/onboarding.json` |
| B | `src/components/dashboard/tabs/*.tsx` (~9), `src/components/dashboard/cards/*.tsx` (~15) | `patient` | `en/patient.json`, `es/patient.json` |
| C | `src/components/dashboard/ai/AIChatPanel.tsx`, `src/components/dashboard/modals/*.tsx`, `src/components/dashboard/charts/*.tsx`, `src/components/layout/GreetingStrip.tsx` audit | `patient` (continued) | `en/patient.json`, `es/patient.json` |
| D | `src/components/dashboard/settings/*.tsx` (~20), `src/components/kb/RelatedArticlesFooter.tsx`, KB content seed | `settings`, `kb` | `en/settings.json`, `es/settings.json`, `en/kb.json`, `es/kb.json` |
| E | `src/components/clinic-invite/*.tsx` (~3 files) | `clinic` | `en/clinic.json`, `es/clinic.json` |

**Wave B and C share `patient.json`** — serialize B before C, OR split: B owns `card.*` + `tab.*` key prefixes; C owns `ai.*` + `modal.*` + `chart.*` prefixes. Planner should use `depends_on` to serialize B→C on the `patient.json` output to avoid merge conflicts.

**Wave 0 (infra):** `e2e/i18n/es-smoke.spec.ts` (scaffold only, RED), `playwright.config.ts` edit, `docs/clinical-glossary.md`, `docs/TRANSLATOR-WORKFLOW.md`, `.github/workflows/i18n-gate.yml` Gate 3 addition. All Wave 0 files are disjoint from Waves A-E.

---

## Metadata

**Analog search scope:** `src/components/layout/`, `src/components/dashboard/cards/`, `src/components/i18n/`, `src/lib/i18n/`, `public/locales/`, `e2e/`, `scripts/`, `.github/workflows/`
**Files read:** 22 source files
**Pattern extraction date:** 2026-05-25
