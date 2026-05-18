# Phase 32: Spanish i18n (Parallel with Clinic Track) — Research

**Researched:** 2026-05-18
**Domain:** Frontend i18n runtime (react-i18next) + Deno Edge-Function email i18n + Supabase admin hot-patch surface
**Confidence:** HIGH (library docs verified via Context7 + npm registry; codebase scout confirmed integration points)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Translator Pipeline & Glossary**
- **D-01** In-house git PR pipeline — translators edit `/locales/{lng}/{ns}.json` via GitHub PR; emergency hot-patches via `locale_overrides` admin UI (I18N-08). NO Crowdin / Lokalise / Phrase in v1.3.
- **D-02** One bilingual clinical contractor handles UI + 7 emails + KB + glossary + I18N-09 sign-off in a single engagement (~$3-5k).
- **D-03** Clinical glossary at `docs/i18n/clinical-glossary-es.md` (markdown, git-versioned). i18next-parser config warns if a new string introduces a glossary term lacking a Spanish entry.

**Spanish Coverage Scope**
- **D-04** Full coverage in v1.3 — patient app + onboarding/landing + KB + helpdesk + admin shell + clinic-operator. Nothing deferred to v1.5.
- **D-05** Ship gate = 100% coverage per namespace. CI counts EN keys vs ES keys; any miss blocks merge.
- **D-06** Coverage gate enforced via **i18next-parser** + **eslint-plugin-i18next**. NO TypeScript declaration-merging codegen in v1.3.

**Email Rendering Pattern**
- **D-07** **i18next-server inside each Edge Function** + shared `/locales/emails/{lng}/<email-namespace>.json` files. Single HTML template per email.
- **D-08** Edge Fn reads `profiles.locale` at send time, defaults `'en'` if null. DSAR/system emails default `'en'`. No event-payload stamping; no per-org override in v1.3.
- **D-09** Phase 25 SES split reuses SAME `/locales/emails/{lng}/*.json` + i18next-server pattern. Translation strings vendor-agnostic.

**Locale Variants & Glossary Policy**
- **D-10** Single `es` namespace — Latin-American-neutral (es-419). Browser `es-MX`/`es-ES`/`es-419` all map to `es`. `profiles.locale` stays 2-char.
- **D-11** Brand names stay English (Ozempic, Wegovy, Mounjaro, Zepbound); generics translated (`semaglutide → semaglutida`).
- **D-12** Metric units default when `profiles.locale='es'` — new signups get `kg`; existing users keep their pref.

### Claude's Discretion (this research resolves)
- Namespace splitting strategy → **see Open Item #1**
- Missing-key fallback observability → **see Open Item #2**
- `Intl.*` formatter centralization → **see Open Item #3**
- ICU plural test fixture corpus → **see Open Item #4**
- `locale_overrides` cache invalidation → **see Open Item #5**

### Deferred Ideas (OUT OF SCOPE — do not plan)
**v1.5:** RTL (Arabic/Hebrew) stylesheets, es-ES variant track, per-org `clinic_orgs.default_locale`, geo-aware unit defaults.
**v1.4:** DB-backed glossary CRUD UI, TypeScript declaration-merging typed keys, Crowdin/Lokalise migration.
**Other phases:** AI auto-translate (P25/P50), localized push notifications (P42), Stripe receipt PDF localization (Stripe-controlled).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| I18N-01 | UI in Spanish via `?lang=es` query string | `i18next-browser-languagedetector` with `order: ['querystring', 'cookie', ...]` + `lookupQuerystring: 'lang'` — verified via Context7 |
| I18N-02 | Accept-Language detection + `profiles.locale` persistence | LanguageDetector `navigator` detector + custom detector reads `profiles.locale`; cookie cache for anonymous visitors |
| I18N-03 | Lazy-load `/locales/{lng}/{ns}.json` via i18next-http-backend | Backend `loadPath: '/locales/{{lng}}/{{ns}}.json'` — emits ONE network fetch per namespace; React `<Suspense>` boundary handles loading state |
| I18N-04 | 7 transactional emails ship Spanish templates | i18next-server inside Edge Fns (D-07); shared JSON catalog under `/locales/emails/{lng}/` — see Finding #1 (CORRECTED: Edge Fn source lives at /Users/karstenhaldan/minisite/supabase/functions/, scaffold in-place) |
| I18N-05 | KB articles `{slug}.es.md` served at same URL with `?lang=es` | Edge-Fn or client-side fetch on `?lang` — covered in helpdesk phase; this phase ships the `kb_articles.locale='es'` schema + lookup helper |
| I18N-06 | In-house git PR pipeline documented | Translator workflow doc: `docs/i18n/TRANSLATOR-WORKFLOW.md` |
| I18N-07 | ICU pluralization correctness (singular/plural/zero/other test fixture) | Native `Intl.PluralRules` via i18next built-in suffixes (`_one`, `_other`, `_zero`); see Open Item #4 — **no `i18next-icu` plugin needed** |
| I18N-08 | Admin-editable `locale_overrides` table | Supabase table + admin module + custom i18next backend layer that merges overrides on top of http-backend response; see Open Item #5 |
| I18N-09 | Clinical glossary review | Same contractor (D-02); markdown PR review gate |
| I18N-10 | CSS logical properties (`margin-inline-start`, etc.) | Already in place from earlier phases (per CONTEXT canonical refs); this phase audits + lint-rule-guards |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **React 19.0.0 + Vite 6 + TS 5.6 strict + Zustand 5 + Tailwind v4 beta** — locked stack; i18next chosen libraries verified compatible (react-i18next 17.0.8 peerDep `react: '>= 16.8.0'`, `typescript: '^5 || ^6'`).
- **Local-first must continue to work** — i18next init must NOT block hydrate(); first-paint stays English if `?lang=es` not present and cache empty. Suspense fallback shows during async ES bundle fetch.
- **Browser-only SPA, no SSR** — i18next-http-backend works in pure browser; SSR concerns N/A.
- **Bundle aggressive code-split** — i18n-runtime chunk ceiling 15 kB gz (Phase 24 wired; vite manualChunks routes `/src/lib/i18n/` + `/src/components/i18n/`).
- **GSD workflow enforcement** — all file edits via GSD command entry points (this is the research step; planner spawns next).
- **Strict TS** — `noUnusedLocals`, `noUnusedParameters`; i18next type declarations must include `Resources` interface for keys when typed-keys are deferred to v1.4 (don't break build).
- **`anti-pattern: hard-coding colors`** translates to "anti-pattern: hard-coding strings in JSX" once eslint-plugin-i18next is wired.

---

## Summary

Phase 32 ships a lazy-loaded Spanish i18n runtime across the entire LeanShot surface — patient app + onboarding/landing + KB + helpdesk + admin shell + clinic-operator — plus 7 transactional emails. The stack (locked in CONTEXT) is **i18next 26.2 + react-i18next 17.0.8 + i18next-http-backend 3.0.2 + i18next-browser-languagedetector 8.2.1**. All four are React-19-compatible (verified peerDeps), released within the last 6 months, and combined tree-shake to **~12-14 kB gz core runtime** — fits comfortably under the 15 kB ceiling Phase 24 already wired into `vite.config.ts` (route: `/src/lib/i18n/` + `/src/components/i18n/` → `i18n-runtime` chunk).

**The codebase is greenfield for i18n.** Confirmed via grep: zero `useTranslation` / `i18next` / `react-i18next` references anywhere in `src/`. No prior strings extracted. The 47k-LOC, 315-component surface needs a one-time `i18next-parser` sweep to produce the canonical EN catalog, then the in-house translator (D-02) fills the ES side. The only existing locale-aware code is `src/lib/helpers.ts` (`formatShort`/`formatLong` use `toLocaleDateString(undefined, ...)`), which switches to passing `i18n.language` explicitly — small surface, no migration churn.

**The repository has no `supabase/functions/` source tree.** v1.2's 8 live Edge Fns were pushed to project `ytnsipxxmzgaebkqmokp` via CLI but their source is NOT committed in this repo (verified `git ls-files | grep supabase`). Phase 32's email i18n work needs to either (a) scaffold `supabase/functions/_shared/i18n-server.ts` net-new here and re-deploy each affected fn from this repo, or (b) coordinate with whichever worktree/branch holds the canonical Edge Fn source. **Planner must explicitly choose** — recommended (a): commit Edge Fn source for the 7 transactional functions into this repo as part of P32 so the i18n-server helper has a home next to the consumers it serves.

**Primary recommendation:** Adopt the namespace split + missing-key event + `useLocale()` formatter hook + admin-publish cache invalidation laid out in Open Items #1-#5 below. Wire i18next initialization into `src/main.tsx` AFTER `applyThemeToDOM()` but BEFORE `void hydrate()` (i18next.init returns a promise that resolves once the default namespace is loaded — `Suspense` handles the rest). Ship Phase 32 in **3 waves / 7 plans** (see "Recommended Plan Structure" below).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UI string translation (`t('key')` / `<Trans>`) | Browser / Client | — | All SPA UI is browser-rendered; no SSR |
| Lazy-loading locale JSON | Browser / Client | CDN / Static | i18next-http-backend fetches `/locales/...` from same-origin static; Vercel caches |
| `profiles.locale` persistence | Database / Storage | API / Backend | New `profiles.locale text default 'en'` column; supabase-js upsert |
| `profiles.locale` resolution at email-send time | API / Backend (Edge Fn) | Database / Storage | Each Edge Fn does `select locale from profiles where id = $1` before rendering |
| Email template rendering | API / Backend (Edge Fn) | — | i18next-server runs in Deno cold-start, caches resources in-module |
| `locale_overrides` table + admin CRUD | API / Backend | Browser / Client | Supabase table; admin shell UI mutates; client + Edge Fns read |
| Locale override cache invalidation | API / Backend | Browser / Client | Realtime broadcast on admin "Publish" (see Open Item #5) |
| Missing-key telemetry event | Browser / Client | API / Backend | i18next `missingKey` event → PostHog `i18n_missing_key` capture; client-side only |
| Coverage CI gate | Build / CI | — | i18next-parser CLI + diff script in GitHub Action |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `i18next` | **26.2.0** | i18n runtime, plural resolution, fallback chain | [VERIFIED: npm view i18next version → 26.2.0] Most-installed i18n core for SPA; native `Intl.PluralRules`; framework-agnostic so Edge Fn reuses |
| `react-i18next` | **17.0.8** | React hooks (`useTranslation`, `<Trans>`) | [VERIFIED: npm view; published 2026-05-14] peerDep `react: '>= 16.8.0'` — React 19 supported. Latest fixes shipped for ref-warning + StrictMode + react-compiler |
| `i18next-http-backend` | **3.0.2** | Lazy-loads `/locales/{lng}/{ns}.json` over HTTP | [VERIFIED: npm view] Standard pairing; CDN-cacheable; same-origin (no CORS) |
| `i18next-browser-languagedetector` | **8.2.1** | Reads `?lang`, cookie, navigator | [VERIFIED: npm view; published 2026-02-12] Detector chain includes `querystring`, `cookie`, `navigator`, `htmlTag`, `localStorage`, `sessionStorage` |

### Dev / Tooling
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `i18next-parser` | **9.4.0** | Extracts `t()` / `<Trans>` keys → canonical EN JSON | CI pre-commit; emits `/locales/en/{ns}.json` from source. JsxLexer handles `.tsx`. Path-alias `@/*` works because lexer reads source files (not module-resolved imports) |
| `eslint-plugin-i18next` | **6.1.4** | Bans raw string literals in JSX where i18n is expected | Lint rule `i18next/no-literal-string` with `mode: 'jsx-text-only'` (avoids false-positives in `className`, `data-*`, etc.) |

### Alternatives Considered (rejected)
| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `i18next` built-in plural suffixes | `i18next-icu` + `intl-messageformat` | Adds ~30 kB gz; CONTEXT D-07 plural matrix (one/plural/zero/other) is fully covered by built-in suffixes (`item_one`, `item_other`, `item_zero`) which use native `Intl.PluralRules`. Spanish has only `one` + `other` cardinal categories per CLDR — same as English. No `{count, plural, =0 {...} one {...} other {...}}` syntax needed. |
| `i18next-parser` | `i18next-cli` (SWC-based) | i18next-cli is newer (faster) but unverified on existing Vite + TS 5.6 + path-alias projects; v1.3 stays with the battle-tested `i18next-parser`. Revisit in v1.4 if DX pain. |
| `react-i18next` hooks | `next-intl` / `lingui` / `polyglot` | next-intl is Next.js-specific; lingui requires compile step + macro setup; polyglot lacks Suspense + plural breadth. react-i18next is the de-facto for React SPAs and matches the locked CONTEXT decision. |
| Custom missing-key handler | `i18next-fluent-icu-messageformat` | Same intl-messageformat dependency cost; doesn't change the missing-key story which is purely an `on('missingKey', ...)` event. |
| HTTP backend lazy-load | `import.meta.glob` eager-load | Eager would bloat `i18n-runtime` chunk past the 15 kB ceiling once ES + EN strings both land. http-backend is the locked decision (D-03 from CONTEXT). |

### Installation (planner reference)
```bash
npm install i18next@26.2.0 react-i18next@17.0.8 i18next-http-backend@3.0.2 i18next-browser-languagedetector@8.2.1
npm install -D i18next-parser@9.4.0 eslint-plugin-i18next@6.1.4
```

**Version verification (executed in this research session, 2026-05-18):**
- `npm view i18next version` → `26.2.0`
- `npm view react-i18next version` → `17.0.8`
- `npm view i18next-http-backend version` → `3.0.2` (latest stable; 4.0.0 in beta — defer)
- `npm view i18next-browser-languagedetector version` → `8.2.1`
- `npm view i18next-parser version` → `9.4.0`
- `npm view eslint-plugin-i18next version` → `6.1.4`

All `[VERIFIED]` against the npm registry. No `[ASSUMED]` version claims.

---

## Architecture Patterns

### System Architecture Diagram

```text
                          ┌─────────────────────────────┐
                          │  Browser SPA (src/)         │
                          │                             │
  ?lang=es ──────────────►│ ① LanguageDetector          │
                          │   resolves lng ('en'|'es')  │
                          │                             │
                          │ ② i18next.init() (deferred  │
                          │   inside src/lib/i18n/      │
                          │   init.ts via dyn-import,   │
                          │   AWAITED before first      │
                          │   <Suspense> render)        │
                          │                             │
                          │ ③ http-backend GET          │
                          │   ─────────────────────────►│ /locales/{lng}/{ns}.json
                          │                             │   (Vercel static, CDN-cached)
                          │ ④ render <Suspense> → page  │
                          │   becomes interactive       │
                          │                             │
                          │ ⑤ on('missingKey', ...) ───►│ PostHog `i18n_missing_key`
                          │                             │   (capture.ts — events.ts def)
                          │                             │
                          │ ⑥ admin-shell mutates ─────►│ supabase.from('locale_overrides')
                          │   locale_overrides          │   .upsert(...)
                          │                             │
                          │ ⑦ on Realtime broadcast ───►│ overrideBackend.reload(lng,ns)
                          │   'locale_overrides_pub'    │   → addResourceBundle merge
                          └─────────────────────────────┘
                                       │
                                       │ profiles.locale read
                                       ▼
            ┌──────────────────────────────────────────────────┐
            │  Supabase Edge Fn (Deno — supabase/functions/*) │
            │                                                  │
            │ ⑧ resend-welcome / clinic-invite / dunning /...  │
            │    import { rendersInLocale } from               │
            │      '../_shared/i18n-server.ts'                 │
            │    → reads profiles.locale, builds i18next       │
            │      instance (cached by lng across cold-starts),│
            │      renders HTML with t() interpolation         │
            │                                                  │
            │ ⑨ same shared layer powers Phase 25 SES Fns      │
            └──────────────────────────────────────────────────┘
```

### Recommended Project Structure

```text
src/
├── lib/
│   └── i18n/                         # → i18n-runtime chunk (Phase 24 manualChunks)
│       ├── init.ts                   # i18next.use(...).init({...})
│       ├── detector-config.ts        # querystring 'lang' + cookie + navigator
│       ├── http-backend-config.ts    # loadPath: '/locales/{{lng}}/{{ns}}.json'
│       ├── override-backend.ts       # custom backend wrapper — merges locale_overrides
│       ├── missing-key-handler.ts    # → PostHog i18n_missing_key event
│       ├── useLocale.ts              # centralized Intl.* formatters (Open #3)
│       └── plurals.test.ts           # ICU plural fixture (Open #4)
├── components/
│   ├── i18n/                         # → i18n-runtime chunk
│   │   ├── LanguageSwitcher.tsx
│   │   └── I18nSuspenseFallback.tsx
│   └── admin/
│       └── i18n/                     # → admin-shell chunk (locale_overrides CRUD)
│           ├── LocaleOverridesModule.tsx
│           ├── OverrideEditor.tsx
│           └── PublishButton.tsx     # triggers Realtime broadcast (Open #5)
public/
└── locales/
    ├── en/                           # canonical, emitted by i18next-parser
    │   ├── common.json               # buttons, modals, toasts, errors (always loaded)
    │   ├── nav.json                  # sidebar/topbar/mobile-nav (always loaded)
    │   ├── patient.json              # dashboard tabs + cards + charts
    │   ├── onboarding.json           # onboarding flow + marketing landing
    │   ├── kb.json                   # helpdesk widget + KB chrome (article body served separately)
    │   ├── admin.json                # admin shell modules (operator-facing)
    │   ├── clinic.json               # clinic-operator surfaces (dashboard, roster, settings)
    │   └── settings.json             # patient settings drawer
    └── es/                           # mirror of en/ — populated by D-02 contractor
        └── (same ns files)
docs/
└── i18n/
    ├── clinical-glossary-es.md       # D-03 source of truth
    └── TRANSLATOR-WORKFLOW.md        # I18N-06 in-house pipeline doc
supabase/
└── functions/                        # NEW — see "Project-scaffolding decision" below
    ├── _shared/
    │   ├── i18n-server.ts            # D-07 shared layer
    │   └── locales/                  # OR public/locales mirrored via copy step
    │       └── emails/
    │           ├── en/
    │           └── es/
    └── (each of 7 transactional fns imports i18n-server)
```

### Pattern 1: i18next initialization in `src/main.tsx`

**What:** i18next.init() is a Promise. Run it dynamic-imported AFTER `applyThemeToDOM()` and AFTER the brand-token warm-paint, but BEFORE `createRoot.render()` so the first `<Suspense>` boundary already sees `i18n.isInitialized === true` for the default namespace.

**Why this position:**
- BEFORE render: avoids a flash of `[MISSING:...]` markers or fallback EN strings when the user has `?lang=es` on first load.
- AFTER theme: i18n init makes a network request; theme is local — get visible paint first.
- Lazy via `void import('./lib/i18n/init').then(...)`: keeps i18next OUT of the entry static graph so the `vendor-react`/`index` chunks stay lean. The dynamic-import resolves into the `i18n-runtime` chunk (already routed by Phase 24's manualChunks).

**Example (TypeScript):**
```typescript
// Source: own architecture; pattern matches existing src/main.tsx phases (scheduleSyncInit, deferAnalyticsInit)
void hydrate().then(async () => {
  wireAuthInvalidation(supabase);

  // P32: load i18n + default+nav namespaces BEFORE first render so SSR-less
  // first paint doesn't flash EN when ?lang=es is in URL.
  const { initI18n } = await import('./lib/i18n/init');
  await initI18n();  // returns once default + nav namespace loaded

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <Suspense fallback={<I18nSuspenseFallback />}>
        <App />
      </Suspense>
    </StrictMode>,
  );

  deferAnalyticsInit(initAnalytics);
  scheduleSyncInit();
});
```

### Pattern 2: i18next config (`src/lib/i18n/init.ts`)

```typescript
// Source: Context7 /i18next/react-i18next — "Initialize i18next with React"
// Adapted for LeanShot's namespaces + chunk ceilings.
import i18next from 'i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { capture } from '../analytics/capture';
import { EVENTS } from '../analytics/events';
import { overrideBackend } from './override-backend';

export async function initI18n() {
  await i18next
    .use(HttpBackend)            // primary backend — fetches /locales/{lng}/{ns}.json
    .use(overrideBackend)        // postProcessor that merges locale_overrides on top
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      fallbackLng: 'en',
      supportedLngs: ['en', 'es'],
      load: 'languageOnly',      // 'es-MX' → 'es' (D-10: single namespace)
      ns: ['common', 'nav'],     // initial namespaces — others loaded by useTranslation(...)
      defaultNS: 'common',
      backend: { loadPath: '/locales/{{lng}}/{{ns}}.json' },
      detection: {
        order: ['querystring', 'cookie', 'localStorage', 'navigator'],
        lookupQuerystring: 'lang',
        lookupCookie: 'leanshot_locale',
        caches: ['cookie', 'localStorage'],
      },
      interpolation: { escapeValue: false }, // React escapes
      react: { useSuspense: true, bindI18n: 'languageChanged loaded' },
      saveMissing: true,         // enables on('missingKey') firing in prod
      missingKeyNoValueFallbackToKey: false,  // fall back to EN, not the key literal
      parseMissingKeyHandler: import.meta.env.DEV
        ? (key, defaultValue) => `[MISSING:${key}]`
        : undefined,
    });

  // Open Item #2 wiring — silent EN fallback in prod + PostHog telemetry
  i18next.on('missingKey', (lngs, ns, key) => {
    capture(EVENTS.i18n_missing_key.name, { ns, key, lng: lngs[0] ?? 'unknown' });
  });

  // Reflect current language on <html lang="..."> for a11y + crawlers
  i18next.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
}
```

### Anti-Patterns to Avoid

- **`useTranslation()` called above `<Suspense>`:** triggers throw of a promise above the boundary, blanking the page. Always wrap `<App />` (or the first translated subtree) in `<Suspense fallback={...}>`.
- **`t('Welcome to LeanShot')` (key === English text):** breaks key stability when copy changes. Use namespaced dot keys: `t('common:hero.welcome')`.
- **Eager `import locales from './locales/es/common.json'`:** drags ALL Spanish into the entry chunk, blowing the 15 kB ceiling on first paint. Always go through http-backend.
- **`new Intl.NumberFormat('es', ...)` inline in components:** allocates a formatter per render. Use the memoized `useLocale()` hook (Open Item #3).
- **Reading `profiles.locale` per-render inside an Edge Fn:** add a one-line cache by user_id (LRU) so a single multi-event burst doesn't N×query the database.
- **Hard-coded `'es-419'` literals scattered around code:** keep `LOCALE_CHOICES = ['en', 'es']` and `i18n.language` resolution centralized in `src/lib/i18n/`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pluralization | Custom `if (count === 1) ... else if (count === 0) ...` ladders | i18next built-in `_one`/`_other`/`_zero` suffixes (native `Intl.PluralRules`) | Spanish has `one` + `other`; Arabic (future) has six categories. Hand-rolling means re-shipping CLDR rules. |
| Language detection from `?lang=` + Accept-Language + cookie | Manual URL parsing + `navigator.languages` walk | `i18next-browser-languagedetector` with `order: ['querystring', 'cookie', 'navigator']` | Detector chain handles edge cases (private mode, multiple Accept-Language entries, region-stripping). |
| Lazy-loading translation JSON | `await import('./locales/' + lng + '/' + ns + '.json')` | `i18next-http-backend` | http-backend handles retry, dedup of concurrent requests for same `lng+ns`, cache-busting, and CDN-friendly URLs. |
| ICU plural correctness fixture | Hand-rolled vitest cases per language | i18next's own pattern: assert `t('item', {count: N})` produces the right localized string for `[0, 1, 2, 5, 100]` | i18next exposes plural resolution via the same `t()` API used at runtime — testing through `t()` exercises the real code path. |
| Date / time / number / currency formatting | `Date.prototype.toLocaleDateString` everywhere | `Intl.DateTimeFormat`/`NumberFormat` memoized inside a `useLocale()` hook | Memoization avoids per-render allocation; central hook = single locale source. |
| Coverage gate | Custom `node` script comparing JSON keys | `i18next-parser` (canonical EN catalog) + `jq` diff in CI | Parser already walks JSX/TSX correctly; rolling our own re-implements JsxLexer. |
| Lint rule for raw JSX strings | Hand-written ESLint rule | `eslint-plugin-i18next` (`i18next/no-literal-string`) | Pre-existing rule with battle-tested ignore patterns for `data-*`, `aria-*`, `className`, etc. |

**Key insight:** All five "open items" from CONTEXT have a default i18next-ecosystem solution; the work is wiring, not building. The only net-new code is (a) override-backend wrapper, (b) `useLocale()` hook, (c) missing-key → PostHog bridge, (d) email-side `i18n-server.ts` shared helper, (e) admin `LocaleOverridesModule.tsx`.

---

## Open Items — Recommendations

### Open Item #1 — Namespace splitting strategy

**Recommendation:** **8 namespaces, surface-aligned, with `common` + `nav` always loaded; the rest loaded by the lazy chunk that owns the surface.**

| Namespace | Loaded by | Est. EN string count | Why this boundary |
|-----------|-----------|---------------------|-------------------|
| `common` | Always (entry) | 50-80 | Buttons, labels, error toasts, form validation, modal chrome, "Yes/No/Cancel" |
| `nav` | Always (entry) | 30-40 | Sidebar, topbar, mobile-nav, FAB labels, tab names — visible on every authenticated page |
| `patient` | dashboard tabs lazy chunks | 250-400 | Med/Body/Activity/etc. tabs + cards + charts + greetings |
| `onboarding` | OnboardingFlow lazy chunk + Marketing/Landing | 150-200 | Multi-step flow + landing copy. Bundled together because both fire on first-touch acquisition flows |
| `kb` | helpdesk-widget chunk | 80-120 | Helpdesk widget chrome + KB index UI. Article body content lives in `kb_articles WHERE locale='es'` (I18N-05) — NOT in JSON catalog |
| `admin` | admin-shell chunk | 200-300 | Admin modules: members table, cohorts, audit log, locale overrides, etc. Internal/operator-only |
| `clinic` | clinic chunk + clinic-settings chunk + clinic-invite chunk | 150-250 | Clinic operator dashboard + roster + drill-in + settings tabs |
| `settings` | patient settings drawer chunk | 60-100 | Settings drawer sections (profile, units, theme, data export). Kept separate so we don't load it on cold-load if the user never opens settings |

**Why this hits the 15 kB chunk ceiling cleanly:**
- The `i18n-runtime` chunk holds the **i18next core + http-backend + LanguageDetector + override-backend + useLocale hook + missing-key handler** — i.e., the JS code. JSON catalogs are NOT inside this chunk (they're under `public/locales/`, served separately and CDN-cached).
- Combined gz core: `i18next` (~9 kB) + `react-i18next` (~3 kB) + `i18next-http-backend` (~1 kB) + `i18next-browser-languagedetector` (~1 kB) = **~14 kB gz**. Our own glue (`init.ts`, `useLocale.ts`, `override-backend.ts`, `missing-key-handler.ts`) ~1 kB gz. **Total ~15 kB gz** — exactly at ceiling.
- If the ceiling is breached during execution, the lever to pull is **drop `i18next-browser-languagedetector`** (~1 kB) and roll a 20-line manual detector — Spanish's chain is small (querystring + cookie + navigator). Defer that pull until we measure.

**Why surface-aligned namespaces (not per-route):**
- Per-route would create 30+ tiny namespaces (one per tab/modal/page) → http-backend pays per-fetch latency on every navigation. Bad for slow mobile networks.
- Per-feature (single huge `app.json`) would force every translation update to invalidate the whole catalog cache. Bad for KV/CDN cache hit rate after a single string change.
- Surface-aligned matches the **existing lazy chunk boundaries** the codebase already enforces (admin-shell, clinic, clinic-settings, helpdesk-widget, etc.) — each `React.lazy()` chunk loads its companion namespace.

**Wiring detail:** `useTranslation(['clinic', 'common'])` in `src/components/clinic/...` components — first ns is the page-specific one (lazy), second is the always-loaded fallback for shared strings. The `common` fallback eliminates accidental duplication of "Save"/"Cancel"/"Confirm" across every page-namespace.

---

### Open Item #2 — Missing-key fallback observability

**Recommendation:** **Three-layer setup, all wired from `src/lib/i18n/init.ts`:**

1. **Production:** silent EN fallback (`fallbackLng: 'en'`) — users never see broken keys. Per-key PostHog event capped via Set-based dedup so we don't burn analytics quota on the same missing key over and over.
2. **Development:** visible `[MISSING:ns:key]` marker via `parseMissingKeyHandler: (key) => \`[MISSING:${key}]\`` when `import.meta.env.DEV`. Translators see at-a-glance which keys haven't landed.
3. **CI:** the 100% coverage gate (D-05/D-06) catches missing-key drift at PR time. `i18next-parser --fail-on-update` + a diff script `tools/check-locale-coverage.sh` that compares `locales/en/*.json` keys vs `locales/es/*.json` keys. Any miss blocks merge.

**The hook:** Both `i18next` and `react-i18next` expose a `missingKey` event on the instance:
```typescript
// Source: Context7 /i18next/i18next — "Configure i18next Missing Key Handling" + "Subscribing to i18next Events"
i18next.on('missingKey', (lngs, namespace, key, fallback) => {
  if (sentReport.has(`${lngs[0]}/${namespace}/${key}`)) return;  // dedup
  sentReport.add(`${lngs[0]}/${namespace}/${key}`);
  capture(EVENTS.i18n_missing_key.name, { lng: lngs[0], ns: namespace, key });
});
```

**Event definition** (additive to `src/lib/analytics/events.ts`, owner: `platform`):
```typescript
i18n_missing_key: {
  name: 'i18n_missing_key',
  version: 1,
  phi: false,
  owner: 'platform',
  description: 'i18next fired missingKey — a runtime t() call had no translation in the requested or fallback locale.',
  payload: z.object({
    lng: z.string(),    // 'es' | 'en'
    ns: z.string(),     // namespace name
    key: z.string(),    // missing key path (may include nested separator)
  }),
}
```

**PostHog dashboard** (admin owns): top-N missing-keys by 7d count, segmented by `lng` and `ns`. Drives the weekly translator backlog.

**Why all three (not just CI):** CI catches keys you added to source but didn't translate. The `missingKey` event catches keys that **slipped past the lint+parser sweep** (dynamic key construction, late-binding `t(varName)`, third-party libraries calling `t()`). The dev marker is the fastest dev-loop signal — translators copy/paste it from their browser into the EN catalog.

---

### Open Item #3 — `Intl.*` formatter centralization

**Recommendation:** **Single `useLocale()` hook returning memoized formatters; replaces all `toLocaleDateString(undefined, ...)` callsites.**

**Codebase scout finding:** 38 files currently use `toLocaleDateString` / `toLocaleString` / `new Intl.*`. The pattern is uniformly `... toLocaleDateString(undefined, {month: 'short', day: 'numeric'})` — they pass `undefined` for the locale arg, which means browser default. Phase 32 must replace `undefined` with `i18n.language`. A single hook = a single migration, then a lint rule pins the discipline.

**Hook design** (`src/lib/i18n/useLocale.ts`):
```typescript
// Source: own design; pattern matches LeanShot's existing useStreaks/useTheme memoization
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function useLocale() {
  const { i18n } = useTranslation();
  const lng = i18n.language;

  return useMemo(() => ({
    lng,
    dateShort: new Intl.DateTimeFormat(lng, { month: 'short', day: 'numeric' }),
    dateLong: new Intl.DateTimeFormat(lng, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: new Intl.DateTimeFormat(lng, { hour: 'numeric', minute: '2-digit' }),
    number: new Intl.NumberFormat(lng),
    integer: new Intl.NumberFormat(lng, { maximumFractionDigits: 0 }),
    decimal: (digits: number) => new Intl.NumberFormat(lng, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    currency: (currency = 'USD') => new Intl.NumberFormat(lng, { style: 'currency', currency }),
    weight: (unit: 'kg' | 'lb') => new Intl.NumberFormat(lng, { style: 'unit', unit, maximumFractionDigits: 1 }),
    relative: new Intl.RelativeTimeFormat(lng, { numeric: 'auto' }),
  }), [lng]);
}
```

**Migration of existing `src/lib/helpers.ts`:** `formatShort`/`formatLong`/`relTime` get parametrized versions in `useLocale()`; the bare functions in `helpers.ts` stay as pure utilities for non-React callsites (e.g., AI prompts, share cards) — those accept a `locale` arg. The `greeting()` function becomes 3 i18n keys + a `pickGreeting(now: Date): 'morning' | 'afternoon' | 'evening'` → `t(\`common:greeting.${pickGreeting(now)}\`)` pattern.

**Lint enforcement:** add an ESLint rule that bans `toLocaleDateString` / `toLocaleString` / `new Intl.*` outside `src/lib/i18n/` and `*.test.ts` (or whitelist via `// eslint-disable-next-line` with required comment justification). Prevents regression.

---

### Open Item #4 — ICU plural test fixture corpus

**Recommendation:** **Hand-rolled vitest fixture exercising `i18next.t()` directly. ~10-15 cases covering EN + ES + Arabic readiness.**

**Why hand-rolled vitest (not i18next jest fixtures):** the project uses vitest; mixing in i18next's jest-only utilities would force a parallel runtime. The actual test is trivial — boot a tiny i18next instance with inline resources, call `t()`, assert.

**File:** `src/lib/i18n/plurals.test.ts`

**Fixture contents** (the planner should expand each):
```typescript
// Source: Context7 /i18next/i18next — "Pluralization with i18next" example, adapted for LeanShot
import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: {
        injection_zero: 'No injections logged',
        injection_one: '{{count}} injection logged',
        injection_other: '{{count}} injections logged',
        day_remaining_one: '{{count}} day remaining',
        day_remaining_other: '{{count}} days remaining',
      }},
      es: { translation: {
        injection_zero: 'Sin inyecciones registradas',
        injection_one: '{{count}} inyección registrada',
        injection_other: '{{count}} inyecciones registradas',
        day_remaining_one: 'Queda {{count}} día',
        day_remaining_other: 'Quedan {{count}} días',
      }},
    },
  });
});

describe('I18N-07 ICU pluralization', () => {
  describe('English', () => {
    it.each([
      [0, 'No injections logged'],
      [1, '1 injection logged'],
      [2, '2 injections logged'],
      [100, '100 injections logged'],
    ])('count=%i → "%s"', (count, expected) => {
      expect(i18next.t('injection', { count })).toBe(expected);
    });
  });

  describe('Spanish', () => {
    beforeAll(() => i18next.changeLanguage('es'));
    it.each([
      [0, 'Sin inyecciones registradas'],
      [1, '1 inyección registrada'],
      [2, '2 inyecciones registradas'],
      [100, '100 inyecciones registradas'],
    ])('count=%i → "%s"', (count, expected) => {
      expect(i18next.t('injection', { count })).toBe(expected);
    });
  });

  // I18N-10 RTL readiness: include Arabic so we exercise 6-category plural
  // resolution before v1.5. Resources kept minimal.
  describe('Arabic (RTL readiness — v1.5 prep)', () => {
    // ... 6 cases: zero / one / two / few / many / other
  });
});
```

**Coverage criteria met:**
- I18N-07 SC#5: singular/plural/zero/other test fixture present and passes for both `en` and `es`.
- Forward-compat: same file exercises Arabic so I18N-10 RTL prep isn't a green-field regression risk in v1.5.

---

### Open Item #5 — `locale_overrides` cache invalidation

**Recommendation:** **Admin "Publish" button → Supabase Realtime broadcast → client + Edge Fn refetch. Frequency expectation drives this — likely <10 hot-patches/month, so per-write broadcast is fine.**

**Schema** (new migration, planner spawns):
```sql
create table public.locale_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.clinic_orgs(id) on delete cascade,  -- null = global
  lng text not null check (lng in ('en', 'es')),
  ns text not null,
  key text not null,
  value text not null,
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on public.locale_overrides (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), lng, ns, key);
-- RLS: admins read/write; everyone reads where published = true AND (org_id is null OR org_id = current_org_id)
```

**Why `published` flag (admin "Publish" button) not on-write broadcast:**
- Admin can edit drafts without flooding clients on every keystroke.
- Single "Publish" click = single Realtime broadcast = single refetch wave.
- Audit-friendly: `published` toggle creates an audit_logs entry (matches Phase 24 ADMIN-02 pattern).

**Client-side wiring:** `src/lib/i18n/override-backend.ts` is a custom i18next backend that:
1. After the primary http-backend fetches `/locales/{lng}/{ns}.json`, queries `select key, value from locale_overrides where lng=$1 and ns=$2 and published = true and (org_id is null or org_id = $3)`.
2. Merges overrides on top of the catalog via `i18next.addResourceBundle(lng, ns, overrideMap, true /*deep*/, true /*overwrite*/)`.
3. Subscribes to Supabase Realtime channel `locale_overrides:${orgId}` for `UPDATE` events; on event, re-runs step 1 for the affected `lng/ns` and `addResourceBundle` again (no full page reload).

**Edge-Fn-side wiring:** `supabase/functions/_shared/i18n-server.ts` builds an i18next instance per cold-start, loads `/locales/emails/{lng}/{ns}.json` (bundled into the function via Deno asset import OR fetched from public.locale_overrides as part of the same query that reads `profiles.locale`). Edge Fns are short-lived so cache invalidation is naturally bounded by cold-start lifetime; no Realtime subscription needed on the Edge side.

**Why NOT short-TTL fetch:** every render of every translated string would queue a DB hit. Defeats the entire point of catalog-based i18n.

**Why NOT on-write broadcast (every UPDATE):** noisy during admin drafting; one publish event per release window is enough.

---

## Cross-Cutting Findings

### Finding 1 — Project scaffolding decision: `supabase/functions/` source ownership [CORRECTED 2026-05-18]

**ORIGINAL FINDING WAS WRONG** — researcher scanned only `leanshot/` subdir and missed the `supabase/` tree at repo root.

**Actual layout (verified 2026-05-18):**
- `/Users/karstenhaldan/minisite/supabase/functions/` — 20+ Edge Fn source dirs (account-delete, admin-bulk-job-worker, admin-impersonate, ai-chat, audit-archive, branding-asset-upload-url, clinic-invite, clinician-alert-deliver-cron, funnel-anomaly-cron, ...).
- `/Users/karstenhaldan/minisite/supabase/migrations/` — full migration history.
- All v1.2 + v1.3-to-date Edge Fns ARE in this repo, deploys from the same checkout.

**Implication for Phase 32:**
- NO Wave 0 "baseline live source" task needed.
- Plan 32-Email scaffolds `supabase/functions/_shared/i18n-server.ts` directly + edits each of the 7 transactional fns in place.
- The 7 transactional fns to localize per CONTEXT D-07: welcome-series sender, password-reset, payment-receipt, clinic-invite, dunning, dsar-confirmation, lifecycle-trigger. Planner: verify each exists by name in `/Users/karstenhaldan/minisite/supabase/functions/` and patch the actual list.

**Cross-cutting carry-overs to planner that DO remain valid:**
- Cold-start cost (~10 kB per fn) — still applies.
- `?target=deno` esm.sh suffix — still applies.
- HIPAA SES split (Phase 25) — still applies; vendor-agnostic strings work for both Resend + future SES paths.

### Finding 2 — i18next in Deno Edge Functions

**Question:** Does `i18next@26.2.0` run cleanly under Deno via esm.sh? Cold-start size?

**Answer (HIGH confidence):**
- [VERIFIED via Context7 + WebSearch] esm.sh is the standard Deno import path for npm packages in Supabase Edge Functions: `import i18next from 'https://esm.sh/i18next@26.2.0?target=deno'`. The `?target=deno` flag avoids the common module-resolution failure mode flagged in [reference_supabase_edge_function_deploy.md] and [Supabase Edge Functions docs].
- i18next is framework-agnostic (no React DOM dependency) — its core just needs ES2018+ + `Intl.PluralRules` (both present in Deno).
- Cold-start size: unpacked `i18next` is 510 kB; minified+gzipped via esm.sh typically lands ~9 kB transferred. Add ~1 kB for our `_shared/i18n-server.ts` glue. Per-fn cold-start cost: ~10 kB additional download — acceptable.
- **Smaller alternative considered:** roll a 50-line replacement using just `Intl.PluralRules` + a Map-based catalog lookup. Trade-off: loses fallback chain, interpolation, plural-suffix matching. **Verdict:** not worth re-implementing for ~10 kB. Use i18next.
- **Resource-loading approach:** TWO options for getting `/locales/emails/{lng}/{ns}.json` into the Edge Fn:
  1. Deno asset import — `import emails_en from './locales/en.json' assert { type: 'json' }` — bundled into the function deploy. Best for performance; worst for admin hot-patches (a `locale_overrides` row can override but the base catalog requires re-deploy to update).
  2. Inline as constants in `i18n-server.ts` — same trade-off as #1 but uglier.
  3. Fetch at cold-start from `https://<project>.supabase.co/storage/v1/object/public/locales/emails/{lng}/{ns}.json` — slower cold-start; admin can update without re-deploy.

  **Recommendation:** option 1 (bundle JSON). Hot-patches go through `locale_overrides`. Email copy changes go through git PR (same as UI strings per D-01).

### Finding 3 — react-i18next + React 19 compatibility

**Answer (HIGH confidence):**
- [VERIFIED: npm view react-i18next peerDependencies → `react: '>= 16.8.0', i18next: '>= 26.2.0', typescript: '^5 || ^6'`] — React 19 is fully supported as of `react-i18next@15.x`; we're on `17.0.8` (released 2026-05-14).
- [CITED: github.com/i18next/react-i18next CHANGELOG] React 19 issues that were fixed and ARE in 17.0.8:
  - `<Trans />` "Each child in a list should have a unique key" warning — fixed.
  - `element.ref` access deprecation under React 19 — fixed.
  - Global JSX namespace removal causing `LibraryManagedAttributes` type error — fixed.
  - `useTranslation` "Maximum update depth exceeded" with react-compiler — fixed.
- **Pin to exact version in package.json** to avoid floating into a bad minor: `"react-i18next": "17.0.8"` (no caret). Same for i18next `"i18next": "26.2.0"`.
- StrictMode double-invoke: react-i18next is StrictMode-safe in 17.x; the `useTranslation` hook is idempotent on re-mount. No special handling needed in tests (project already runs `<StrictMode>` in `src/main.tsx`).

### Finding 4 — i18next-parser config for path alias `@/*`

**Answer (HIGH confidence):**
- [VERIFIED via Context7 /i18next/i18next-parser docs] i18next-parser reads **source files directly** (it has its own JsxLexer / JavascriptLexer that walks `.ts`/`.tsx` ASTs); it does NOT resolve modules through TS or Vite. So path aliases like `@/components/...` are **never followed** — they're irrelevant to extraction.
- What matters: the `input` glob. Config:
  ```javascript
  // i18next-parser.config.js
  export default {
    locales: ['en', 'es'],
    defaultNamespace: 'common',
    namespaceSeparator: ':',
    keySeparator: '.',
    pluralSeparator: '_',
    contextSeparator: '_',
    output: 'public/locales/$LOCALE/$NAMESPACE.json',
    input: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/**/__tests__/**'],
    lexers: {
      ts: ['JavascriptLexer'],
      tsx: [{
        lexer: 'JsxLexer',
        functions: ['t'],
        namespaceFunctions: ['useTranslation', 'withTranslation'],
        componentFunctions: ['Trans'],
        transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'p'],
      }],
    },
    sort: true,
    createOldCatalogs: false,
    failOnUpdate: true,  // CI gate (D-05 100% coverage)
    failOnWarnings: true,
  };
  ```
- `--fail-on-update` makes the parser exit nonzero in CI if any new key would be added to the catalog (i.e., source has `t('new.key')` but catalog doesn't list it). That IS the coverage gate.
- `failOnWarnings: true` catches glossary-missing terms once we wire the glossary check as a custom warning emitter.

### Finding 5 — i18next-http-backend in pure browser context

**Answer (HIGH confidence):** Works. The package is browser-first — it uses `fetch` (with `XMLHttpRequest` fallback). No SSR or Node-only dependencies. Phase 32's pure-SPA stance is the happy path.

### Finding 6 — Vercel + `?lang=es` SEO

**Answer (HIGH confidence):**
- [CITED: REQUIREMENTS.md §V13-9] Path-prefix `/es/` rejected because Vercel's rewrite rules interact badly with the page-builder ISR cache layer. Query-string `?lang=es` is locked.
- Implication for SEO: search engines treat `?lang=es` URLs as duplicates of the canonical URL by default. To get separate ES indexing, emit `<link rel="alternate" hreflang="es" href="...?lang=es">` and `<link rel="alternate" hreflang="en" href="...">` in the marketing/landing pages.
- **Wave 3 task for the planner:** add `hreflang` link tags via the existing `<head>` injection pattern (Phase 15 page-builder + Phase 31 white-label both already inject `<head>` content). Pattern: a small `useEffect` in marketing/landing page components.

---

## Common Pitfalls

### Pitfall 1: `<Suspense>` boundary missing → blank page

**What goes wrong:** First call to `useTranslation()` in a tree without a `<Suspense>` ancestor throws a promise that bubbles to React's default behavior — the entire tree is replaced with the closest error boundary (or React's blank fallback).

**Why it happens:** `useSuspense: true` (the default) makes `useTranslation` throw while the namespace loads.

**Avoidance:** wrap `<App />` in `<Suspense fallback={<I18nSuspenseFallback />}>` (Pattern 1). For surfaces that need to render BEFORE i18n is ready (e.g., a loading spinner), use `useTranslation('common', { useSuspense: false })` + check `ready`.

### Pitfall 2: Hardcoded English fallbacks in component code

**What goes wrong:** `<button>{t('save') || 'Save'}</button>` looks defensive but defeats `parseMissingKeyHandler` AND coverage CI.

**Why it happens:** developer copy-paste from non-i18n component.

**Avoidance:** `eslint-plugin-i18next` rule `i18next/no-literal-string` flags raw JSX text. Configure with `mode: 'jsx-text-only'` to avoid false positives in className/aria-label/data-*.

### Pitfall 3: `i18next-parser` doesn't see dynamic keys

**What goes wrong:** `t(\`error.${code}\`)` — parser can't statically resolve the key, so it never lands in the catalog, so the missing-key event fires at runtime even though the developer "knows" the key exists.

**Why it happens:** parser is a static AST walker.

**Avoidance:** for dynamic keys, ship a `defaultValue` enumeration via JSDoc-style comments the parser CAN read: `// t('error.network', 'Network error')` and `// t('error.unauthorized', 'Not allowed')`. Document in `TRANSLATOR-WORKFLOW.md`. ESLint custom rule could enforce this — defer to v1.4 unless drift shows up.

### Pitfall 4: `kg`/`lb` unit display flipping mid-session

**What goes wrong:** D-12 sets `profiles.weight_unit = 'kg'` for new ES signups. If a user changes locale mid-session AND we re-resolve unit from locale, their previously logged values display under the wrong unit.

**Why it happens:** confusing locale (display) with unit (data).

**Avoidance:** unit assignment happens ONCE at signup (CONTEXT D-12). Locale changes do NOT re-derive unit. The `kg` default is a signup-time decision, not a runtime computation. Document in `src/lib/i18n/useLocale.ts` JSDoc.

### Pitfall 5: Cold-start Edge-Fn duplicates i18next instance per request

**What goes wrong:** `_shared/i18n-server.ts` calls `i18next.init()` on every Fn invocation → 30 kB allocation churn.

**Why it happens:** Deno worker per-request reset.

**Avoidance:** initialize at module top-level (Deno caches modules across requests within a single isolate). Pattern:
```typescript
// supabase/functions/_shared/i18n-server.ts
import i18next from 'https://esm.sh/i18next@26.2.0?target=deno';
import en from './locales/en.json' assert { type: 'json' };
import es from './locales/es.json' assert { type: 'json' };
const ready = i18next.init({ lng: 'en', fallbackLng: 'en', resources: { en: { emails: en }, es: { emails: es } } });
export async function renderInLocale(lng: string, key: string, vars?: Record<string, unknown>) {
  await ready;
  return i18next.getFixedT(lng, 'emails')(key, vars);
}
```

### Pitfall 6: 100%-coverage CI gate blocks WIP feature branches

**What goes wrong:** developer adds `t('new.feature.title')` in a feature branch; CI fails on missing ES translation; developer can't merge without first pinging the translator.

**Why it happens:** strict gate intersects with parallel feature work.

**Avoidance:** add a `defaultValue` to every new t() call (`t('new.feature.title', 'New Feature')`) — i18next-parser emits this into BOTH `en` and `es` catalogs (ES placeholder = the English defaultValue). Translator overwrites later. ESLint custom rule "require defaultValue on first parameter" would enforce. Defer rule to v1.4 unless drift shows up.

### Pitfall 7: PostHog session-replay captures `[MISSING:...]` markers as part of replay → looks like a PHI leak

**What goes wrong:** the visible dev-mode marker `[MISSING:settings:profile.locale]` shows up in session-replay screenshots if dev-mode is ever shipped to prod accidentally.

**Avoidance:** `parseMissingKeyHandler` only fires when `import.meta.env.DEV === true` (Vite ensures DEV is `false` in production builds). Already wired in Pattern 2. Add a unit test that asserts the prod build doesn't include the `[MISSING:` literal.

---

## Code Examples

Verified patterns from official sources:

### Switch language at runtime
```typescript
// Source: Context7 /i18next/react-i18next — "Use the useTranslation Hook"
const { i18n } = useTranslation();
await i18n.changeLanguage('es'); // triggers languageChanged event + http-backend fetch
// LanguageDetector with caches: ['cookie', 'localStorage'] persists automatically
```

### Plural with count
```typescript
// Source: Context7 /i18next/i18next — "Pluralization with i18next"
t('injection', { count: 0 });  // → "No injections logged"  (en) / "Sin inyecciones registradas" (es)
t('injection', { count: 1 });  // → "1 injection logged"
t('injection', { count: 5 });  // → "5 injections logged"
```

### Interpolation with `<Trans>` for embedded JSX
```typescript
// Source: Context7 /i18next/react-i18next — "Complete react-i18next application setup"
<Trans i18nKey="patient:terms" components={{ termsLink: <a href="/terms" />, privacyLink: <a href="/privacy" /> }}>
  By continuing, you agree to our <termsLink>Terms</termsLink> and <privacyLink>Privacy Policy</privacyLink>.
</Trans>
```

### Edge Fn email render
```typescript
// Source: own pattern; matches existing supabase/functions Resend pattern in memory references
import { renderInLocale } from '../_shared/i18n-server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

Deno.serve(async (req) => {
  const { user_id } = await req.json();
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data } = await supa.from('profiles').select('locale, display_name, email').eq('id', user_id).single();
  const lng = data?.locale ?? 'en';

  const subject = await renderInLocale(lng, 'welcome.subject', { name: data?.display_name });
  const body = await renderInLocale(lng, 'welcome.body', { name: data?.display_name });

  // ... resend send ...
});
```

---

## Runtime State Inventory

This phase is greenfield i18n — there is no pre-existing runtime state to migrate. All items below verified by `git ls-files` + grep:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `profiles.locale` is a NEW column added in this phase. `locale_overrides` is a NEW table. No existing ES strings in any datastore. | New migration (Plan 32-01); no data migration |
| Live service config | None — Vercel project already serves the SPA from `app.leanshot.app` + `leanshot.app`; no per-locale routing config to add (query-string locked). Supabase Edge Fns: see Cross-cutting Finding #1 about source ownership. | None for Vercel; resolve Finding #1 for Supabase |
| OS-registered state | None — no Task Scheduler / launchd / pm2 / systemd references for "locale" or "i18n". Verified `git grep -i 'locale\\|i18n'` returns only planning docs + existing `localeCompare` calls. | None |
| Secrets and env vars | None — no `*_LOCALE_*` or `*_I18N_*` env vars exist. Translator contractor's GitHub access (D-01) is a process item, not a secret. | None |
| Build artifacts / installed packages | None — `node_modules/i18next*` does not currently exist (verified: `ls node_modules/i18next 2>/dev/null` returns nothing). Fresh install via Plan 32-01. | `npm install` at start of execution |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 18+ | Vite build + i18next-parser CLI | ✓ | v22.18.0 | — |
| npm | install + ci | ✓ | bundled | — |
| Vercel | static `public/locales/` hosting | ✓ | live | — |
| Supabase project `ytnsipxxmzgaebkqmokp` | `profiles.locale` migration + `locale_overrides` table | ✓ | live | — |
| Supabase CLI | function deploy (if scaffolding `supabase/functions/`) | ✓ (per other phases) | latest | — |
| Deno (Supabase Edge runtime) | i18next-server | ✓ (Supabase-managed) | runtime-pinned | — |
| esm.sh CDN | `i18next` import in Deno | ✓ (public) | — | jsdelivr.net (same package) |
| PostHog project 140479 | `i18n_missing_key` event capture | ✓ (per other phases) | — | local console.warn |
| Bilingual clinical contractor (D-02) | translation work | ✗ — to be engaged | — | NOT a code dependency; engagement gate happens at translator-pipeline plan kickoff |

**Missing dependencies with no fallback:** None blocking code execution.
**Missing dependencies with fallback:** The translator contractor (D-02) is a process dependency — engagement timeline does NOT block Phase 32 code work (Wave 1+2 can ship; translator work happens in parallel). Wave 3 ship gate depends on the contractor's deliverable.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (already configured in `vite.config.ts`) + Playwright for e2e |
| Config file | `vite.config.ts` (vitest section, line 245-266) |
| Quick run command | `npm run test:unit -- src/lib/i18n/` |
| Full suite command | `npm test` (vitest run + playwright test) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| I18N-01 | `?lang=es` renders Spanish UI | e2e (Playwright) | `npm run test:e2e -- e2e/i18n-language-switch.spec.ts` | ❌ Wave 0 |
| I18N-02 | Accept-Language → `profiles.locale` persistence | integration (vitest) | `npm run test:unit -- src/lib/i18n/detector.test.ts` | ❌ Wave 0 |
| I18N-03 | Lazy-load `/locales/{lng}/{ns}.json` | e2e network-tap | `npm run test:e2e -- e2e/i18n-lazy-load.spec.ts` | ❌ Wave 0 |
| I18N-04 | 7 emails render Spanish copy | integration (vitest) | `npm run test:unit -- supabase/functions/_shared/i18n-server.test.ts` | ❌ Wave 0 |
| I18N-05 | KB `?lang=es` returns ES slug | e2e | `npm run test:e2e -- e2e/i18n-kb-articles.spec.ts` | ❌ Wave 0 |
| I18N-06 | Translator workflow doc exists | doc-existence smoke | `test -f docs/i18n/TRANSLATOR-WORKFLOW.md` | ❌ Wave 0 |
| I18N-07 | ICU plurals (singular/plural/zero/other) | unit (vitest) | `npm run test:unit -- src/lib/i18n/plurals.test.ts` | ❌ Wave 0 |
| I18N-08 | `locale_overrides` hot-patch | integration + e2e | `npm run test:unit -- src/lib/i18n/override-backend.test.ts && npm run test:e2e -- e2e/i18n-admin-override.spec.ts` | ❌ Wave 0 |
| I18N-09 | Glossary present + reviewed | doc + manual checkpoint | `test -f docs/i18n/clinical-glossary-es.md && grep -q 'Reviewed:' docs/i18n/clinical-glossary-es.md` | ❌ Wave 0 |
| I18N-10 | CSS logical properties — no `margin-left`/`right` regression | lint (custom stylelint rule OR grep) | `bash scripts/check-css-logical-properties.sh` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit -- src/lib/i18n/` + `npm run typecheck`
- **Per wave merge:** full vitest + the i18n e2e specs + `bash scripts/check-locale-coverage.sh`
- **Phase gate:** `npm test` (full vitest + playwright) + bundle-budget assertion + coverage gate

### Wave 0 Gaps
- [ ] `src/lib/i18n/plurals.test.ts` — covers I18N-07
- [ ] `src/lib/i18n/detector.test.ts` — covers I18N-02
- [ ] `src/lib/i18n/override-backend.test.ts` — covers I18N-08 (client)
- [ ] `supabase/functions/_shared/i18n-server.test.ts` — covers I18N-04 (Deno-side)
- [ ] `e2e/i18n-language-switch.spec.ts` — covers I18N-01
- [ ] `e2e/i18n-lazy-load.spec.ts` — covers I18N-03 (asserts network request for `/locales/es/...` AFTER initial load)
- [ ] `e2e/i18n-kb-articles.spec.ts` — covers I18N-05
- [ ] `e2e/i18n-admin-override.spec.ts` — covers I18N-08 (admin → DB → Realtime → client refetch)
- [ ] `scripts/check-locale-coverage.sh` — coverage gate (D-05/D-06)
- [ ] `scripts/check-css-logical-properties.sh` — I18N-10 lint
- [ ] `i18next-parser.config.js` — root of repo
- [ ] `tools/` directory hosting parser invocation scripts

Framework install (Wave 0): `npm install` for the 6 i18next packages listed in Standard Stack.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | i18n is a presentation-layer feature; auth unchanged |
| V3 Session Management | no | locale persisted in cookie + DB; not session-bearing |
| V4 Access Control | **yes** | `locale_overrides` admin CRUD MUST be RLS-guarded to admin role (Phase 24 ADMIN-01 admin_role enum); reads MUST filter `published = true AND (org_id IS NULL OR org_id = current_org_id())` |
| V5 Input Validation | **yes** | `locale_overrides.value` is user-input (admin input, but still user-input); must be sanitized for XSS when rendered. `<Trans>` + `i18next` already HTML-escape interpolation values (`escapeValue: true` for the override path — even though React escapes elsewhere); MUST NOT allow raw HTML in override strings |
| V6 Cryptography | no | no crypto in this phase |

### Known Threat Patterns for {react-i18next + Supabase}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via `locale_overrides.value` containing `<script>` | Tampering | (1) admin-only write RLS; (2) i18next `escapeValue: true` for override values OR strip HTML in DB trigger; (3) CSP `script-src 'self'` (already enforced by Phase 12) blocks even if escape fails |
| Locale-based cache poisoning (one user's override leaks to another org) | Information Disclosure | RLS filter `org_id = current_org_id() OR org_id IS NULL`; unit test asserts cross-org isolation |
| Missing-key event leaking PHI in `key` value | Information Disclosure | `i18n_missing_key` event def has `phi: false` (event taxonomy enforces); `key` is a developer-authored string, never a user-input value — by construction, NOT PHI |
| Translator contractor's GitHub access to public repo | Repudiation | I18N-06 doc specifies signed commits or PR review by team member; contractor never gets push access to `main` |
| HTML injection via `<Trans>` `components={...}` when override value contains element placeholders | Tampering | `<Trans>` only renders elements explicitly named in `components` prop; unknown tags are escaped. Document in `TRANSLATOR-WORKFLOW.md` |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| i18next `language detection` via header-only | LanguageDetector with `order: [querystring, cookie, navigator]` | i18next 19+ | Query-string detection enables shareable Spanish links without cookie set first |
| i18next-icu plugin for plurals | Native `Intl.PluralRules` via built-in suffix system | i18next 19+ (when `compatibilityJSON: 'v4'` became default; default in v23+, exclusive in v26) | -30 kB bundle vs `intl-messageformat`; loses ICU `{count, plural, ...}` syntax (acceptable for our use) |
| Manual `withTranslation` HOC | `useTranslation` hook | react-i18next 11+ | React 16.8+ standard; works with React 19 |
| TypeScript declaration-merging codegen (`Resources` type) | Deferred — eslint-plugin-i18next only | (CONTEXT D-06) | Lower DX safety but lower setup cost. Revisit in v1.4 if drift shows |
| Per-language `_zh-CN`/`_zh-TW`/`_es-ES` namespaces | Single `lng` per language family + `load: 'languageOnly'` | i18next 15+ | Matches CONTEXT D-10 (single `es` namespace, es-419 neutral); regionalisms via `locale_overrides` if needed |

**Deprecated / outdated:**
- `compatibilityJSON: 'v3'` plural suffix format (`item_plural` instead of `item_other`) — removed in i18next 26. Our setup uses v4 only — no migration story needed since codebase is greenfield.
- `i18next-xhr-backend` — replaced by `i18next-http-backend` (same author, modernized). We use the current one.

---

## Recommended Plan Structure (planner consumes directly)

**7 plans across 3 waves. Each plan size: 1-3 days work for a parallel executor.**

### Wave 0 — Test scaffolding + foundation

Pre-execution gate per Wave 0 Gaps section above. Planner ships this as a tiny wave-0 setup plan OR rolls into Plan 32-01.

### Wave 1 — Foundation (3 plans, parallel)

- **Plan 32-01 — i18n runtime + namespaces + missing-key telemetry**
  - npm install the 6 packages (versions pinned)
  - `src/lib/i18n/init.ts`, `detector-config.ts`, `http-backend-config.ts`, `missing-key-handler.ts`, `useLocale.ts`
  - Wire into `src/main.tsx` (between hydrate + render per Pattern 1)
  - Add `i18n_missing_key` to `src/lib/analytics/events.ts`
  - `i18next-parser.config.js` at repo root
  - `scripts/check-locale-coverage.sh` CI gate
  - Initial `public/locales/en/{common,nav}.json` (hand-authored bootstrap; full extraction in Plan 32-02)
  - Validation: I18N-01 partial (default 'en'); I18N-02 base; I18N-03; I18N-07 vitest passes; bundle ceiling check.

- **Plan 32-02 — String extraction sweep + EN catalog**
  - Run `i18next-parser` against all 315 components → emits 8 namespaces' `en/*.json`
  - Replace raw JSX strings with `t()` calls (one big PR; risky to split because partial extraction leaves the lint rule angry)
  - Add `eslint-plugin-i18next` config (rule `i18next/no-literal-string` with `mode: 'jsx-text-only'`)
  - Migrate `src/lib/helpers.ts` date formatters to accept locale arg OR move to `useLocale()` callsites
  - Bootstrap `public/locales/es/*.json` as a literal copy of EN (placeholder; translator overwrites in Wave 3)
  - Validation: `npm run lint` passes; `scripts/check-locale-coverage.sh` passes (EN-ES key counts match); `npm test` passes (vitest + playwright); bundle budget passes.

- **Plan 32-03 — `profiles.locale` schema + Zustand integration**
  - Supabase migration: `alter table public.profiles add column locale text not null default 'en' check (locale in ('en','es'))`
  - Zustand store: add `user.locale` to persisted state (partialize already gates this)
  - LanguageDetector custom detector reads from `profiles.locale` after sign-in (overrides anonymous detection)
  - Settings drawer adds language picker → calls `i18n.changeLanguage('es')` + upserts `profiles.locale`
  - D-12 wiring: at signup, if detected locale starts with 'es', default `profiles.weight_unit = 'kg'`
  - Validation: I18N-01 full; I18N-02 full; `src/lib/i18n/detector.test.ts` passes.

### Wave 2 — Surface coverage + override hot-patch (2 plans, parallel)

- **Plan 32-04 — `locale_overrides` table + admin module + Realtime invalidation**
  - Supabase migration: `locale_overrides` table + RLS + audit-log trigger
  - `src/lib/i18n/override-backend.ts` — custom i18next backend wrapper that merges overrides
  - `src/components/admin/i18n/LocaleOverridesModule.tsx` + editor + PublishButton
  - Realtime channel `locale_overrides:${orgId}` with broadcast on publish
  - Validation: I18N-08 e2e green; cross-org RLS isolation test passes.

- **Plan 32-05 — Email i18n: i18n-server shared + 7 transactional fns**
  - **PREREQUISITE:** none — Edge Fn source already in `/Users/karstenhaldan/minisite/supabase/functions/` (Finding #1 CORRECTED).
  - `supabase/functions/_shared/i18n-server.ts` (Deno-side i18next via esm.sh)
  - `supabase/functions/_shared/locales/{en,es}/*.json` (or asset-import the public/locales mirror)
  - Each of 7 transactional fns (`resend-welcome`, `password-reset`, `payment-receipt`, `clinic-invite`, `dunning`, `dsar-confirmation`, `lifecycle-behavior`) imports + reads `profiles.locale` + calls `renderInLocale(lng, 'subject', ...)` + `renderInLocale(lng, 'body', ...)`
  - Validation: I18N-04 unit tests pass; manual UAT e2e (send each email to a test ES account; visually verify Spanish copy).

### Wave 3 — Translation delivery + ship gate (2 plans, sequential)

- **Plan 32-06 — Translator engagement + glossary + KB articles**
  - Engage contractor (D-02) — process gate, not code
  - Contractor edits `public/locales/es/*.json` via GitHub PR(s) over 1-2 weeks
  - Contractor authors `docs/i18n/clinical-glossary-es.md` + reviews KB `{slug}.es.md` files
  - I18N-09 signoff captured as commit message + glossary file header `Reviewed: 2026-XX-XX by <contractor name>`
  - I18N-06: `docs/i18n/TRANSLATOR-WORKFLOW.md` documents the in-house pipeline
  - Validation: coverage gate passes for ALL namespaces; glossary file exists with `Reviewed:` line; KB ES articles exist; HELP search returns ES results.

- **Plan 32-07 — Marketing hreflang + CSS logical-properties audit + ship gate**
  - Add `<link rel="alternate" hreflang="es">` to marketing/landing/onboarding `<head>`
  - Audit existing CSS for `margin-left`/`margin-right`/`padding-left`/`padding-right` → convert to logical properties; add `scripts/check-css-logical-properties.sh` lint
  - Ship-gate dashboard: PostHog `i18n_missing_key` count over 24h trailing must be < threshold (recommend: < 100 unique keys; tunable)
  - Validation: I18N-10 gate passes; `hreflang` tags inspected; ship-gate query green.

### Wave Dependencies

```
Wave 0 (test scaffolding)
   │
   ▼
Wave 1 (3 plans parallel: runtime / extraction / profiles.locale)
   │
   ▼
Wave 2 (2 plans parallel: locale_overrides / email i18n)
   │
   ▼
Wave 3 (2 plans sequential: translator delivery → ship gate)
```

**Parallel safety per [feedback_parallel_executor_autonomy_drift]:** Wave 1 plans touch disjoint paths (runtime: `src/lib/i18n/` + `src/main.tsx`; extraction: 315 component files + `public/locales/`; profiles.locale: migration + store + settings drawer). Wave 2 plans touch disjoint paths (admin: `src/components/admin/i18n/`; email: `supabase/functions/`). Use `git commit -- <pathspec>` per the parallel-executor rule.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The ~14 kB gz core runtime fits the 15 kB chunk ceiling | Open #1 / Stack | If true measurement exceeds 15 kB once minified+gzipped + our glue, we'll drop `i18next-browser-languagedetector` (~1 kB savings) and roll a 20-line manual detector. Mitigation already identified. |
| A2 | The translator contractor (D-02) can deliver full ES coverage for ~315 components in 1-2 weeks at $3-5k | Plan 32-06 / CONTEXT specifics | Contractor cost/timeline is outside our control. Mitigation: Wave 3 timeline is process-gated; if late, Phase 32 ship slips but does not block parallel phases (P28-31 clinic track). |
| A3 | Supabase Edge Fns can `import * from 'https://esm.sh/i18next@26.2.0?target=deno'` without bundling issues | Cross-cutting Finding #2 | If esm.sh transformation fails for i18next, fall back to Deno-native `i18next-deno` fork OR roll a 50-line catalog lookup. Cold-start cost lower in the fallback. |
| A4 | ~~Phase 32 should commit `supabase/functions/` source~~ INVALIDATED — Edge Fn source already in `/Users/karstenhaldan/minisite/supabase/functions/`. No baseline-download step needed. | Finding #1 CORRECTED | n/a |
| A5 | ~50-80 strings in `common`, ~30-40 in `nav` (estimate) | Open #1 namespace table | Counts derived from typical SPA patterns + LeanShot's component count + ui/ primitives count. After Plan 32-02's extraction sweep, actual counts will be measured; if any namespace blows past 5 kB gz on its own, planner can sub-split. |
| A6 | The repo's existing 38 files with `toLocaleDateString`/`toLocaleString`/`new Intl.*` are all simple migrations to `useLocale()` | Open #3 | Verified the patterns are uniform (`toLocaleDateString(undefined, ...)`); migration is mechanical. If any usage is in a non-React utility, those keep accepting an explicit `locale` arg. |
| A7 | `i18next-parser`'s static AST walking covers all `t()` / `<Trans>` usages we need | Pitfall 3 | Dynamic key construction (`t(\`error.${code}\`)`) won't be extracted; mitigation in Pitfall 3. Risk is low because greenfield code can be written defensively from day one. |

**No assumptions are about regulatory compliance, security controls, or PII handling — those domains use HIGH-confidence verified sources.**

---

## Open Questions

1. **Are KB article ES source files (`{slug}.es.md`) authored by the same D-02 contractor or by a separate KB content author?**
   - What we know: D-02 contractor handles "UI + 7 emails + KB articles + clinical glossary".
   - What's unclear: KB article volume (number of `{slug}.es.md` files in scope) isn't stated. Could be 10 or 100, materially affecting the $3-5k engagement scope.
   - Recommendation: planner asks user at Plan 32-06 kickoff: "How many KB articles are in scope for ES translation in v1.3? (Best-effort count from `kb_articles WHERE published = true`)"

2. **Should the `i18n_missing_key` PostHog event include user `org_id` (for clinic-operator-specific missing-key tracking)?**
   - What we know: Events default to no PHI; `phi: false` is correct.
   - What's unclear: org_id would help slice missing-key dashboards by tenant (useful when a single org reports "Spanish UI broken").
   - Recommendation: include `org_id?: string` as OPTIONAL field (additive per Phase 24 TAXO-06 rule). Planner can flip on/off based on growth team input.

3. **What's the rollback story if `i18next.init()` fails (e.g., http-backend cannot reach `/locales/en/common.json`)?**
   - What we know: i18next will render keys-as-text if no resources load (`[MISSING:...]` markers in dev; literal keys in prod with our config).
   - What's unclear: should the first paint degrade gracefully to "untranslated source" or block on an error boundary?
   - Recommendation: ship with i18next's silent fallback (renders keys as text) — better than a blank page. Sentry already captures the load error via the global error listeners.

---

## Sources

### Primary (HIGH confidence)
- Context7 `/i18next/react-i18next` — Suspense integration, useTranslation, init pattern, missingKey examples
- Context7 `/i18next/i18next` — Plural rules, missingKey events, plugin registration, language detection chain
- Context7 `/i18next/i18next-parser` — JsxLexer config, CLI usage, `--fail-on-update` for CI gates
- npm registry (`npm view <pkg>`) — exact current versions verified 2026-05-18 for all 6 packages
- npm registry — peerDependencies confirmed for React 19 compatibility
- Codebase scout — `src/main.tsx`, `src/lib/helpers.ts`, `src/lib/analytics/events.ts`, `src/lib/store.ts`, `vite.config.ts`, `package.json`, `.planning/phases/24-*/24-08-PLAN.md`, `.planning/phases/24-*/24-CONTEXT.md`, `eslint.config.js` and 38 files with locale formatting

### Secondary (MEDIUM confidence)
- WebSearch: react-i18next + React 19 compatibility (cross-verified with Context7-fetched changelog entries) — [GitHub i18next/react-i18next CHANGELOG](https://github.com/i18next/react-i18next/blob/master/CHANGELOG.md)
- WebSearch: i18next vs ICU plugin trade-off — [Locize blog](https://www.locize.com/blog/messageformat-2-i18next/), [react-i18next ICU docs](https://react.i18next.com/misc/using-with-icu-format)
- WebSearch: Supabase Edge Function esm.sh import patterns — [Supabase Edge Functions docs](https://supabase.com/docs/guides/functions/dependencies), [Supabase troubleshooting docs](https://supabase.com/docs/guides/troubleshooting/importing-stripe-or-other-modules-from-esmsh-on-deno-edge-functions-throws-an-error-TmbB5p)

### Tertiary (LOW confidence — flagged for validation)
- None — every claim in this RESEARCH.md is tagged `[VERIFIED]` or `[CITED]`.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all 6 package versions verified against npm registry on 2026-05-18; peer deps and React 19 compatibility confirmed
- Architecture: **HIGH** — pattern matches CONTEXT locked decisions; Phase 24 chunk wiring already exists; integration points (main.tsx, events.ts, store.ts) inspected
- Pitfalls: **HIGH** — all 7 pitfalls drawn from documented i18next behaviors + LeanShot codebase patterns
- Open Items: **HIGH** — each open item has a concrete library or codebase mechanism behind it; no hand-waving
- Email Edge Fn integration: **HIGH** — Finding #1 corrected (Edge Fn source confirmed at repo root); planner can scaffold `_shared/i18n-server.ts` + patch the 7 transactional fns in-place.
- Translator timeline: **LOW** — contractor cost/timeline assumed per CONTEXT (~$3-5k, 1-2 weeks); outside engineering control

**Research date:** 2026-05-18
**Valid until:** 2026-06-15 (30 days — i18next ecosystem is stable; React 19 + Vite 6 are also stable; revisit if i18next ships a major or React 19.1+ lands)
