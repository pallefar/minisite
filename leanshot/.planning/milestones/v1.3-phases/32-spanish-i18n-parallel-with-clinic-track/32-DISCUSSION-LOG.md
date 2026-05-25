# Phase 32: Spanish i18n (Parallel with Clinic Track) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 32-Spanish-i18n-Parallel-with-Clinic-Track
**Areas discussed:** Translator pipeline tooling, Initial Spanish coverage scope, Email rendering pattern, Locale variants + glossary policy

---

## Translator pipeline tooling

### Q1: I18N-06 leaves the translator pipeline open (Crowdin OR in-house). Which approach for v1.3?

| Option | Description | Selected |
|--------|-------------|----------|
| In-house git PRs + locale_overrides hot-patch | Translators (contractor) edit /locales/{lng}/{ns}.json via GitHub PR; admin uses locale_overrides for emergency hot-patches. Zero SaaS cost; reuses I18N-08 infra. | ✓ |
| Crowdin SaaS | $60-200/mo + per-string cost; sync via Crowdin GitHub Action; clinical glossary + translation memory baked in. | |
| You decide | Defer to research — compare Crowdin/Lokalise/Phrase/in-house with current pricing. | |
| Other (describe) | Lokalise / Tolgee / admin-only / clinic-partner translator team. | |

**User's choice:** In-house git PRs + locale_overrides hot-patch
**Notes:** Matches trim-process / invest-end-user pattern. Recurring SaaS cost rejected.

### Q2: Who does the translation work?

| Option | Description | Selected |
|--------|-------------|----------|
| One bilingual clinical contractor | Single contractor does UI + emails + KB + glossary; satisfies I18N-09 advisor gate. ~$3-5k. | ✓ |
| Two-person split | Pro translator + separate clinical advisor for medical terms only. | |
| ChatGPT/Claude first pass + advisor review only | AI auto-translate + clinical sign-off; rely on observability for drift. | |
| Other (describe) | — | |

**User's choice:** One bilingual clinical contractor
**Notes:** Continuity favored; single review handoff.

### Q3: Where does the clinical glossary live + how is it maintained?

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown in repo: docs/i18n/clinical-glossary-es.md | Git-versioned; advisor PRs updates; ESLint/i18next-parser warn on missing entries. | ✓ |
| Database table: clinical_glossary_es with admin UI | Operationally editable post-deploy; CRUD + RLS effort. | |
| Both — markdown source of truth, sync to DB | Markdown wins on PR review; cron syncs to DB for runtime lookup. | |
| Glossary only in translator's head + tool | Trust the contractor; don't formalize in v1.3. | |

**User's choice:** Markdown in repo
**Notes:** Cheapest, fits in-house workflow.

---

## Initial Spanish coverage scope

### Q1: Which UI surfaces ship Spanish in v1.3?

| Option | Description | Selected |
|--------|-------------|----------|
| Patient app (logging, dashboard, history, settings) | End-user core. Highest reach. | ✓ |
| Onboarding + marketing landing pages | Acquisition + SEO. | ✓ |
| KB articles + helpdesk widget | I18N-05 / HELP-08 locked. | ✓ |
| Admin shell + clinic operator surfaces | Internal/operator surface; otherwise defer. | ✓ |

**User's choice:** ALL FOUR (full coverage)
**Notes:** Aligns with aggressive-foundations preference; nothing deferred to v1.5.

### Q2: Ship-gate threshold for Spanish coverage?

| Option | Description | Selected |
|--------|-------------|----------|
| 100% coverage gate — missing-key = ship blocker | CI lint counts EN vs ES per namespace; merge blocked on miss. | ✓ |
| 95% threshold + observability backfill | Ship ≥95%; PostHog `i18n_missing_key` drives weekly backlog. | |
| Tiered: 100% patient/onboarding/landing/KB; 80% admin/clinic-operator | Stricter on end-user; tolerate operator gaps. | |
| Other (describe) | — | |

**User's choice:** 100% coverage gate
**Notes:** No English leaks at ship; aggressive-foundations rule applied.

### Q3: How is the 100%-coverage CI gate enforced?

| Option | Description | Selected |
|--------|-------------|----------|
| i18next-parser extracts EN → CI diff vs ES | Standard tooling; pairs with eslint-plugin-i18next to forbid raw literals. | ✓ |
| Typed keys via TypeScript declaration merging | Generate Resources type from EN; missing ES = type error. Codegen + tsconfig wiring. | |
| Runtime + offline coverage report (no compile-time) | PostHog event + nightly coverage report. | |
| Both i18next-parser + typed keys | Belt-and-suspenders. | |

**User's choice:** i18next-parser + eslint-plugin-i18next
**Notes:** Defer typed-keys to v1.4 if DX pain emerges.

---

## Email rendering pattern

### Q1: Per memory, Resend emails currently render as HTML strings inside Edge Functions. How do the 7 transactional emails go bilingual?

| Option | Description | Selected |
|--------|-------------|----------|
| i18next-server inside each Edge Fn + shared /locales/emails/{lng}/*.json | Single template per email; strings live alongside UI locales; same translator pipeline. | ✓ |
| Duplicated per-locale templates (invoice.en.html + invoice.es.html) | Cleanest separation; doubles template surface; drift risk. | |
| Resend dynamic templates + merge variables | Templates in Resend dashboard; locks into Resend vendor. | |
| Other (describe) | — | |

**User's choice:** i18next-server inside each Edge Fn
**Notes:** Vendor-agnostic; ~30 kB cold-start mitigated by Deno cache.

### Q2: How does the Edge Fn know which locale to render?

| Option | Description | Selected |
|--------|-------------|----------|
| Read profiles.locale at send time — default 'en' if null | Single source of truth (I18N-02). DSAR/system emails default 'en'. | ✓ |
| Stamp locale into the queue/event payload | Capture locale at trigger time; immune to mid-flight profile changes. | |
| Per-org override: clinic_orgs.default_locale wins for clinic-invite/dunning | Layer on top of profiles.locale; affects ORG schema. | |
| Both per-event payload AND per-org override | Most robust; most surface area. | |

**User's choice:** Read profiles.locale at send time
**Notes:** Per-org override deferred until a Spanish-speaking clinic signs.

### Q3: P25 HIPAA splits PHI emails to AWS SES (Resend has no public BAA). How does Spanish flow through that split?

| Option | Description | Selected |
|--------|-------------|----------|
| Same i18next + /locales/emails JSON in both Resend AND SES Edge Fns | Vendor-agnostic; SES Edge Fn picks up Spanish for free. | ✓ |
| Only Resend (consumer) emails go bilingual in v1.3 — PHI/SES emails English-only | Trim PHI email scope; revisit when first Spanish clinic signs. | |
| Other (describe) | — | |

**User's choice:** Same i18next + /locales/emails JSON in both
**Notes:** Translation strings stay decoupled from email-vendor split.

---

## Locale variants + glossary policy

### Q1: Collapse all Spanish variants (es-MX / es-ES / es-419) to a single 'es', or maintain variants?

| Option | Description | Selected |
|--------|-------------|----------|
| Single 'es' namespace — Latin-American neutral Spanish | es-419 covers MX/AR/CO/PE/CL/Spanish-US; one translator pass; one glossary. | ✓ |
| Two-track: es-419 (LatAm) + es-ES (Spain) | Honor browser locale; doubles translator cost. | |
| Single 'es' but ship per-region overrides via locale_overrides | Admin/clinic adds region-specific overrides post-deploy. | |
| Other (describe) | — | |

**User's choice:** Single 'es' namespace (es-419 neutral)
**Notes:** Region-specific edge cases handled via locale_overrides per-org if needed.

### Q2: Brand/drug name policy — what stays untranslated?

| Option | Description | Selected |
|--------|-------------|----------|
| Brand names untranslated; generics translated | Ozempic/Wegovy/Mounjaro/Zepbound stay English; semaglutide → semaglutida. | ✓ |
| Everything translated where Spanish term exists | Even brand names use Spanish-market form; legal exposure risk. | |
| Nothing translated except UI chrome — clinical terms English | Conservative; risks activation. | |
| Other (describe) | — | |

**User's choice:** Brand names untranslated; generics translated
**Notes:** Locked in docs/i18n/clinical-glossary-es.md.

### Q3: Unit defaults for Spanish-locale users (weight + dose)?

| Option | Description | Selected |
|--------|-------------|----------|
| Metric default (kg + mg) when locale='es' | New es signups default to kg; user can flip. Drug doses already mg/mcg. | ✓ |
| Inherit user's existing unit preference — don't auto-change | Locale and units orthogonal; user picks. | |
| Geo-aware default: kg in MX/AR/CO/PE/ES; lb in US-Spanish | Use Vercel geo + Accept-Language. | |
| Other (describe) | — | |

**User's choice:** Metric default (kg + mg)
**Notes:** New signups only; existing users keep their pref. No forced migration.

---

## Claude's Discretion

- Namespace splitting strategy inside `/locales/{lng}/` (per-route vs per-feature vs common+per-page) — researcher/planner picks based on extracted key inventory + 15 kB chunk ceiling.
- Missing-key fallback observability (silent EN fallback + PostHog event + dev-mode visible marker) — planner to confirm wiring.
- Centralization of `Intl.*` formatters (single `useLocale()` hook vs per-component) — planner picks based on existing util patterns.
- ICU plural test fixture corpus — researcher picks i18next built-ins vs hand-rolled vitest cases.
- `locale_overrides` cache invalidation strategy — planner picks based on hot-patch frequency expectations.

## Deferred Ideas

### To v1.5
- Arabic / Hebrew (RTL) — CSS logical properties already in (I18N-10); RTL stylesheets + mirrored layouts + font selection deferred.
- es-ES (Spain) variant track.
- Per-org `clinic_orgs.default_locale` override.
- Geo-aware unit defaults.

### To v1.4
- DB-backed clinical glossary with admin CRUD UI.
- TypeScript declaration-merging typed keys.
- Crowdin / Lokalise / Tolgee migration if in-house pipeline becomes a bottleneck.

### Out of scope (other phases)
- AI-translation auto-suggest in admin shell — Phase 25 + Phase 50.
- Localized push notifications — Phase 42.
- Stripe receipt PDF localization — Stripe-controlled.
