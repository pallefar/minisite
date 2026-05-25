---
phase: 58-spanish-i18n-wiring-contractor-delivered
reviewed: 2026-05-26T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - leanshot/src/lib/i18n/onboarding-labels.ts
  - leanshot/src/lib/i18n/settings-labels.ts
  - leanshot/src/lib/i18n/tab-labels.ts
  - leanshot/src/test-setup.ts
  - leanshot/.github/workflows/i18n-gate.yml
  - leanshot/e2e/i18n/es-smoke.spec.ts
  - supabase/migrations/20270708000001_p58_kb_articles_es_seed.sql
  - leanshot/src/components/dashboard/tabs/MoodTab.tsx
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: resolved
resolved: 2026-05-26T00:00:00Z
resolution: >
  WR-01 fixed (KB seed migration → slug-targeted ON CONFLICT upsert on kb_articles_org_slug_idx;
  no silent no-op). WR-02 fixed (5 export-toast strings keyed under settings:section.data.*, en+es,
  153/153 parity). WR-03 fixed (Section type exported from settings-labels.ts, deduped). Verified:
  tsc 0, locale gate PASS, Gate-3 clean, es-smoke 5/5 GREEN. Commit ed9f2d10.
  IN-01 (tabHeading string typing) + IN-02 (es-smoke KB aria-label not anti-fallthrough; root cause
  untranslated aria-label in KBSearchTypeahead) → deferred to Phase 70 with KB live-RPC verification.
---

# Phase 58: Code Review Report

**Reviewed:** 2026-05-26
**Depth:** deep
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 58 delivers Spanish i18n wiring across the patient surface. The logic-bearing artifacts reviewed here are the switch-based label helpers, test setup, CI gate, ES smoke tests, and the KB content migration. The mechanical component keyings (~70 files) were excluded per scope.

The switch helpers in `onboarding-labels.ts`, `settings-labels.ts`, and `tab-labels.ts` are exhaustive and correctly mapped — all enum cases are covered, catalog keys are confirmed present in both EN and ES, and `never` defaults guard new union members. The Gate-3 ICU interpolation check is logically correct: `comm -13` correctly surfaces ES-only tokens, and all 8 namespaces pass with zero offenders. The test-setup isolation strategy (private `createInstance()` + `initReactI18next`) matches the documented react-i18next testing pattern and does not contaminate the global singleton that `plurals.test.ts` uses.

Three defects were found: one logic hole in the SQL migration that silently no-ops Case 2 when unrelated global articles already exist, two untranslated toast strings left in `SettingsPage.tsx` after the i18n refactor, and a maintainability coupling risk from the duplicated `Section` type.

---

## Warnings

### WR-01: SQL migration Case 2 INSERT silently no-ops when global articles exist with different slugs

**File:** `supabase/migrations/20270708000001_p58_kb_articles_es_seed.sql:130-138`

**Issue:** The Case 2 `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE org_id IS NULL LIMIT 1)` skips the entire multi-row insert if **any** global (`org_id IS NULL`) article already exists in `kb_articles`. The `ON CONFLICT` clause inside Case 2 never fires when this guard returns false.

If the live database contains global articles whose slugs are NOT `injection-site-rotation`, `reading-your-med-level-curve`, or `what-to-do-about-nausea` — for example, articles inserted manually or via an interim migration — then:
- Case 1 `UPDATE ... WHERE slug = '...'` finds no matching rows (different slug) and no-ops.
- Case 2 `INSERT` is guarded out (global article exists).
- The three ES-seeded articles are silently never inserted.

On a canonical deploy (Phase 37 left `kb_articles` empty), Case 2 works correctly. The risk is a staging or production database where an operator has added a different global article before this migration runs.

**Fix:** Replace the `WHERE NOT EXISTS` guard with three individual upserts using `ON CONFLICT ... DO UPDATE`, removing the "does any global article exist?" short-circuit:

```sql
insert into public.kb_articles (
  id, org_id, slug, title, body, title_es, body_es, locale_set,
  published_at, published_version, created_at, updated_at
)
values
  (
    '11111111-0000-0000-0000-000000000001'::uuid,
    null,
    'injection-site-rotation',
    'How injection-site rotation works',
    $$Rotating your injection sites...$$,
    'Cómo funciona la rotación del sitio de inyección',
    $$La rotación de los sitios...$$,
    array['en', 'es'], now(), 1, now(), now()
  ),
  ( '11111111-0000-0000-0000-000000000002'::uuid, null, 'reading-your-med-level-curve', ... ),
  ( '11111111-0000-0000-0000-000000000003'::uuid, null, 'what-to-do-about-nausea', ... )
on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
do update set
  title_es   = excluded.title_es,
  body_es    = excluded.body_es,
  locale_set = excluded.locale_set,
  updated_at = now();
```

This removes the need for both Case 1 (UPDATE) and the `WHERE NOT EXISTS` guard. The single upsert is idempotent: rows that already exist are updated; missing rows are inserted.

---

### WR-02: Untranslated toast strings in SettingsPage.tsx after i18n refactor

**File:** `leanshot/src/components/dashboard/settings/SettingsPage.tsx:337, 353, 358, 386, 389`

**Issue:** Five `toast()` calls in `handleExportJson` and `handleExportPdf` use hardcoded English strings that were not keyed during the Phase 58 refactor. The surrounding UI (section titles, button labels, confirmation dialogs) was fully keyed. A Spanish user receives English-only feedback during export operations:

- Line 337: `toast('Fetching cloud data...', 'info')`
- Line 353: `toast('JSON exported', 'success')`
- Line 358: `toast('Generating PDF...', 'info')`
- Line 386: `toast('PDF exported', 'success')`
- Line 389: `toast('PDF export failed', 'error')`

No corresponding keys exist in either `public/locales/en/settings.json` or `public/locales/es/settings.json` for the status/result toast messages (only the button labels `section.data.export_json` and `section.data.export_pdf` exist).

**Fix:** Add keys to the settings catalog and replace the hardcoded strings:

```ts
// In settings EN/ES catalogs, under section.data:
// "export_json_fetching": "Fetching cloud data…"  / "Obteniendo datos de la nube…"
// "export_json_success": "JSON exported"           / "JSON exportado"
// "export_pdf_generating": "Generating PDF…"       / "Generando PDF…"
// "export_pdf_success": "PDF exported"             / "PDF exportado"
// "export_pdf_error": "PDF export failed"          / "Error al exportar el PDF"

toast(t('settings:section.data.export_json_fetching'), 'info');
// ...
toast(t('settings:section.data.export_json_success'), 'success');
```

---

### WR-03: `Section` type duplicated between `settings-labels.ts` and `SettingsPage.tsx` with no shared source of truth

**File:** `leanshot/src/lib/i18n/settings-labels.ts:13-31` and `leanshot/src/components/dashboard/settings/SettingsPage.tsx:67-98`

**Issue:** The `Section` union type is defined independently in two files (18 members each). They are currently identical. TypeScript's structural typing provides limited protection: adding a new member to `SettingsPage.Section` without adding it to `settings-labels.Section` causes a compile error only at the `sectionLabel(t, id)` call site. However, adding a new member to `settings-labels.Section` without adding it to `SettingsPage.Section` (or forgetting the switch case) compiles silently — the `never` default in `sectionLabel` would be the only runtime guard.

The deeper risk is that a developer adding a new settings section must update both files, which is a documentation-only constraint with no import-enforced coupling. Past phases have missed this pattern (see `admin_module_manifest_vs_router_branch_drift` memory note).

**Fix:** Export the `Section` type from `settings-labels.ts` and import it in `SettingsPage.tsx`:

```ts
// settings-labels.ts
export type Section = /* ... all values ... */;
export function sectionLabel(t: TFunction, id: Section): string { ... }

// SettingsPage.tsx
import { sectionLabel, type Section } from '@/lib/i18n/settings-labels';
// Remove the local Section type definition.
```

This makes `settings-labels.ts` the single source of truth. Any new Section value added only to `SettingsPage.tsx` would fail to compile where `sectionLabel()` is called, and adding it to `settings-labels.ts` without a switch case is caught by the `never` default.

---

## Info

### IN-01: `tabHeading` parameter typed as `string` instead of `TabId`, losing exhaustiveness guarantee

**File:** `leanshot/src/lib/i18n/tab-labels.ts:19`

**Issue:** `tabHeading(t: TFunction, id: string): string` accepts any string and falls through to `return id` for unknown tab ids. This is intentional per the inline comment ("intentionally limited to the 9 main dashboard tabs"). However, the signature does not constrain callers to known tab ids, so a typo (`'Medication'` vs `'medication'`) or a new `TabId` value (`'community'`, `'classroom'`, `'events'`) silently returns the raw id string at runtime with no compile-time warning.

The three existing `TabId` values NOT covered (`community`, `classroom`, `events`) would return their raw id strings if `tabHeading` is ever called with them.

**Fix:** If `tabHeading` is intended to cover only the 9 core tabs, document that limit with a comment already present (it is). No code change required unless a caller is found passing a full `TabId` value. If callers start using it for all tabs, consider typing the parameter as `TabId` and expanding the switch, or renaming to `coreTabHeading` to signal the intentional narrowing.

---

### IN-02: `es-smoke.spec.ts` Flow 5 KB search anti-fallthrough assertion is locale-agnostic

**File:** `leanshot/e2e/i18n/es-smoke.spec.ts:334`

**Issue:** Flow 5 asserts `page.getByRole('textbox', { name: /search the knowledge base/i })` — an English string. `KBSearchTypeahead.tsx:73` hardcodes `aria-label="Search the knowledge base"` without i18n keying. This means the assertion passes in both `en` and `es` locales and does NOT prove the KB widget is running in Spanish. The anti-fallthrough design principle is therefore not met for this specific assertion.

The test comment acknowledges the deferred nature of the KB ES locale verification (deferred to Phase 70), but does not note that the `aria-label` itself is untranslated.

**Fix:** Two options:
1. Add an i18n key for the search input `aria-label` in `KBSearchTypeahead.tsx` (e.g., `kb:search.aria_label`) and assert the Spanish value in Flow 5. This provides real locale signal.
2. Keep the current assertion but add a comment noting that the `aria-label` is intentionally hardcoded English (not an anti-fallthrough assertion for locale, just a widget-mount assertion).

---

_Reviewed: 2026-05-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
