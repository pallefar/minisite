# Phase 32: Spanish i18n (Parallel with Clinic Track) - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Ships a lazy-loaded Spanish runtime across LeanShot — patient app + onboarding/landing + KB + helpdesk widget + admin shell + clinic-operator surfaces — plus 7 transactional emails (welcome series, password reset, payment receipt, clinic invite, dunning, DSAR confirmation, lifecycle behavior triggers) and a clinical glossary reviewed by a Spanish-native clinical advisor. Routing locked to `?lang=es` query; chunk ceiling 15 kB gz; CSS already uses logical properties for v1.5 RTL.

**Locked by ROADMAP / REQUIREMENTS (not re-decided here):**
- Routing: `?lang=es` query (NOT `/es/` path-prefix — avoids V13-9 Vercel rewrite doubling)
- Stack: react-i18next + i18next-http-backend, lazy-loaded `/locales/{lng}/{ns}.json`
- Persistence: explicit user pref → `profiles.locale`; first visit → `Accept-Language` detection + cookie
- Hot-patch surface: `locale_overrides` table editable per-org / per-deployment
- ICU pluralization correctness (singular/plural/zero/other test fixture)
- CSS logical properties (`margin-inline-start`, etc.) — RTL deferred to v1.5
- Bundle ceiling: i18n-runtime ≤15 kB gz (locked in Phase 24 CI guard)

</domain>

<decisions>
## Implementation Decisions

### Translator Pipeline & Glossary
- **D-01:** In-house git PR pipeline — translators (contractor) edit `/locales/{lng}/{ns}.json` via GitHub PR; emergency hot-patches go through `locale_overrides` admin UI (I18N-08). No Crowdin / Lokalise / Phrase SaaS in v1.3. Reasoning: zero recurring SaaS cost; reuses already-locked override infra; matches the trim-on-process / invest-on-end-user pattern.
- **D-02:** One bilingual clinical contractor handles UI strings + 7 emails + KB articles + clinical glossary in a single engagement; same contractor satisfies the I18N-09 Spanish-native clinical advisor gate (no review handoff). Estimated cost ~$3–5k for v1 corpus.
- **D-03:** Clinical glossary lives at `docs/i18n/clinical-glossary-es.md` — markdown, versioned in git, advisor PRs updates. i18next-parser config emits a warning if a string introduces a glossary term lacking a Spanish entry. No DB-backed glossary table in v1.3 (defer to v1.4 if runtime lookup ever needs it).

### Spanish Coverage Scope
- **D-04:** Full coverage in v1.3 — patient app + onboarding/marketing landing pages + KB articles + helpdesk widget + admin shell + clinic-operator surfaces all ship Spanish day-1. Nothing deferred to v1.5. Matches aggressive-foundations user preference for breadth on user-audience surfaces.
- **D-05:** Ship gate = 100% coverage per namespace. CI script counts EN keys vs ES keys per `/locales/en/<ns>.json` vs `/locales/es/<ns>.json`; any miss blocks merge. No "ship at 95%" tolerance; no English leaks at ship.
- **D-06:** Coverage gate enforced via **i18next-parser** + **eslint-plugin-i18next**. i18next-parser walks JSX for `t()` / `<Trans>` calls and emits canonical EN keys per namespace; CI script diffs ES against the canonical EN set. eslint-plugin-i18next bans raw string literals in JSX where i18n is expected. No TypeScript declaration-merging codegen in v1.3 (revisit if DX pain shows up).

### Email Rendering Pattern
- **D-07:** **i18next-server inside each Edge Function** + shared `/locales/emails/{lng}/<email-namespace>.json` files. Each of the 7 Edge Fns calls `i18next.t('email.subject', { ... })` against the same Deno-cached i18next instance; templates are single HTML strings with placeholders. Email strings live alongside UI locales so the same in-house translator pipeline (D-01) feeds them. Cold-start cost ~30 kB per Fn, mitigated by Deno module cache.
- **D-08:** Edge Fn resolves locale by reading `profiles.locale` at send time and defaulting to `'en'` if null. DSAR and other userless system emails default to `'en'`. No event-payload locale stamping; no per-org `clinic_orgs.default_locale` override in v1.3 (revisit when first Spanish-speaking clinic signs).
- **D-09:** When Phase 25 splits PHI emails to AWS SES (because Resend has no public BAA), the new SES Edge Fns reuse the SAME `/locales/emails/{lng}/*.json` + i18next-server pattern as the Resend Edge Fns. Translation strings are vendor-agnostic; whoever wires the SES path picks up Spanish for free. Zero coupling between the i18n decision and the email-vendor split.

### Locale Variants & Clinical Glossary Policy
- **D-10:** Single `es` namespace — Latin-American-neutral Spanish (es-419). Browser `Accept-Language: es-MX`, `es-ES`, `es-419` all map to `es`. `profiles.locale` stays 2-char. Region-specific edge cases (regionalisms) handled via `locale_overrides` per-org if a clinic complains. No two-track `es-419` + `es-ES` ship in v1.3.
- **D-11:** Brand names stay English (Ozempic, Wegovy, Mounjaro, Zepbound, etc.); generics translated where Spanish form differs (`semaglutide → semaglutida`, `tirzepatide → tirzepatida`); symptoms + dosing terms translated. Policy locked in `docs/i18n/clinical-glossary-es.md`.
- **D-12:** Metric units default when `profiles.locale='es'` — weight defaults to `kg`, drug doses already `mg`/`mcg` (no change). On signup, new `es` users get `profiles.weight_unit='kg'` automatically; user can flip to `lb` in settings. Existing users keep their current unit preference (no forced migration). No geo-aware override (geo + locale stays orthogonal in v1.3).

### Claude's Discretion
- Namespace splitting strategy inside `/locales/{lng}/` (per-route vs per-feature vs common+per-page) — let researcher/planner pick what hits the 15 kB chunk ceiling cleanly given the actual extracted key inventory.
- Missing-key fallback observability (silent EN fallback vs `[MISSING:key]` dev marker vs PostHog `i18n_missing_key` event) — secondary to the 100% CI gate. Recommend at minimum: silent EN fallback in prod + PostHog event for drift detection + dev-mode visible marker. Planner to confirm wiring.
- Date / time / number / currency formatting via `Intl.*` APIs (`Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`) — pick where to centralize (single `useLocale()` hook vs per-component) based on existing util patterns.
- ICU plural test fixture corpus — at minimum cover the I18N-07 singular/plural/zero/other matrix; researcher picks whether to use i18next's built-in jest fixtures or hand-rolled vitest cases.
- `locale_overrides` cache invalidation strategy (on-write Realtime broadcast vs short TTL fetch vs admin "publish" button) — planner to pick based on how often hot-patches are expected.

### Folded Todos
None — `todo.match-phase 32` returned zero matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements
- `.planning/ROADMAP.md` §"Phase 32: Spanish i18n" — goal + 5 success criteria + I18N-01..10 mapping
- `.planning/REQUIREMENTS.md` §"WS9 — B Depth: Spanish i18n" — I18N-01..10 full text
- `.planning/REQUIREMENTS.md` §"V13-9 Vercel rewrite doubling note" — why `/es/` path-prefix is rejected

### Locked architecture cross-references
- `.planning/phases/24-foundation-modular-admin-shell-event-taxonomy-server-side-posthog/` (Phase 24 SUMMARY) — `i18n-runtime ≤15 kB gz` chunk ceiling + CI guard wired
- `.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-CONTEXT.md` — Resend-vs-SES PHI email split (drives D-09)
- `.planning/phases/28-clinic-organizations-schema-rls-hardening/` (Phase 28 SUMMARY) — `org_id` + clinic invite flows (D-08 deferred per-org locale)
- `.planning/phases/31-white-label-path-based-org-roles-clinic-onboarding-builder/` (Phase 31 SUMMARY) — `org_branding` + onboarding builder pattern (precedent for org-level config; not used for locale in v1.3)

### Project memory worth flagging to planner
- `reference_resend_phase9_wiring.md` — Resend wiring pattern: `RESEND_API_KEY` + `RESEND_FROM` as Supabase Function secrets; HTML-string template inside Edge Fn
- `reference_hipaa_baa_vendor_matrix.md` — Resend has NO public BAA → AWS SES fallback for PHI emails (drives D-09)
- `feedback_aggressive_foundations.md` + `feedback_regulator_vs_user_audience_pattern.md` — drives D-04 full-coverage scope choice

### Codebase maps
- `.planning/codebase/STACK.md` — confirms React 19 + Vite + Tailwind v4 SPA, no SSR
- `.planning/codebase/INTEGRATIONS.md` — Resend Edge Fn entrypoints

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Zustand store at `src/lib/store.ts`** — `profiles.locale` will read/write through the existing persisted store; piggybacks on the `persist` middleware already wired for user settings.
- **Phase 24 chunk-ceiling CI script** (per memory `project_phase24_shipped.md` — `bundle-budget` script) — already gates `i18n-runtime` to 15 kB gz; reuse, don't reinvent.
- **Phase 31 path-based white-label** (just shipped) — establishes the precedent for runtime-resolved per-org config; the `locale_overrides` lookup can mirror the same per-org fetch pattern.
- **Existing Resend Edge Functions** (per memory + e2e tests `e2e/lifecycle-welcome-series.spec.ts`) — entry pattern for the 7 transactional emails; planner extends each to call `i18next.t()`.

### Established Patterns
- **No `useTranslation` anywhere yet** — confirmed by grep. Phase 32 introduces i18next as a net-new dependency; no migration of existing strings to worry about beyond extracting them via i18next-parser.
- **HTML strings inside Edge Fns** for emails (no react-email / mjml) — Spanish rendering must work without a JSX runtime; i18next-server + plain string templates is the natural fit (D-07).
- **CI guard already enforced for chunk budgets** — i18n-runtime 15 kB gz ceiling is a hard merge gate.

### Integration Points
- `profiles.locale` column (LOCKED in I18N-02) — read in: app boot (UI), every Edge Fn that sends an email (D-08).
- `locale_overrides` table (LOCKED in I18N-08) — read in: i18next backend layer at app boot AND inside each email Edge Fn.
- Bundle-budget CI guard — adds `i18n-runtime` chunk assertion (already wired by P24).
- eslint-plugin-i18next + i18next-parser — new dev dependencies; CI step diffs ES vs EN keys per namespace.

</code_context>

<specifics>
## Specific Ideas

- Translator workflow: one bilingual clinical contractor, paid per engagement (~$3–5k for v1 corpus); same person reviews glossary terms (no separate clinical advisor handoff).
- Glossary lives in `docs/i18n/clinical-glossary-es.md` as the source of truth — not a DB table, not Crowdin TM.
- Brand-name rule: Ozempic / Wegovy / Mounjaro / Zepbound stay English; semaglutide → semaglutida etc.
- Unit default for `es` users: `kg` (new signups only; existing users keep their pref).

</specifics>

<deferred>
## Deferred Ideas

### To v1.5 (RTL + variant expansion)
- Arabic / Hebrew (RTL) — CSS logical properties already in place (I18N-10), but actual RTL stylesheets, mirrored layouts, font selection deferred.
- es-ES (Spain) variant track — single `es` namespace covers v1.3; revisit when Spain-market acquisition pipeline materializes.
- Per-org `clinic_orgs.default_locale` override — defer until first Spanish-speaking clinic actually requests it (D-08).
- Geo-aware unit defaults (kg in MX/AR/CO/PE/ES; lb in US-Spanish) — single locale=es ⇒ kg is good enough for v1.3.

### To v1.4 (translator-tooling polish if pain emerges)
- DB-backed clinical glossary with admin CRUD UI — only if runtime glossary lookup proves necessary.
- TypeScript declaration-merging typed keys — only if missing-key DX pain at the call site shows up.
- Crowdin / Lokalise / Tolgee migration — only if in-house git PR pipeline becomes a bottleneck (e.g., translator hates GitHub).

### Out of scope (other phases)
- AI-translation auto-suggest in admin shell — touches Phase 25 Anthropic credential split + Phase 50 RAG corpus.
- Localized push notifications — Phase 42 Polish + Smart Notifications.
- Stripe receipt PDF localization — Stripe-controlled; outside our render path.

</deferred>

---

*Phase: 32-Spanish-i18n-Parallel-with-Clinic-Track*
*Context gathered: 2026-05-18*
