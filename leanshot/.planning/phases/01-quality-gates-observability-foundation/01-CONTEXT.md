# Phase 1: Quality Gates & Observability Foundation - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers the engineering "rails" before any feature work — a "hello" PR runs Vitest unit tests + Playwright smoke + ESLint + Prettier + typecheck in GitHub Actions, surfaces an intentional thrown error in Sentry (with PII scrubbed), and lands a tracked event in PostHog cookieless mode. Once Phase 1 closes, every later phase ships with CI, error tracking, analytics, and lint/format/typecheck gates from day one.

**In scope:**
- Vitest 4 + React Testing Library + Playwright wired with `npm test`
- ESLint (full health-app ruleset including `jsx-a11y`) + Prettier configs
- GitHub Actions workflow that blocks merge on lint/format/typecheck/unit/smoke failures
- Sentry SDK init with `beforeSend` PII scrubbing and a dev-only error trigger
- PostHog cookieless SDK wired with a typed `track()` helper, dormant in production
- Cleanup of existing v2 lint debt: 5× `as never` casts, 3× native dialogs, BaseChart's orphan `eslint-disable`, the `YOURTAG-20` Amazon affiliate placeholder, and the bogus `claude-sonnet-4-6` model ID
- Foundational pure-function tests: `helpers.ts`, `useStreaks.calc`, `migrateFromV3`, plus a single RTL `OnboardingFlow` happy-path integration test

**Out of scope (deferred to later phases):**
- Public deploy / custom domain (Phase 2)
- Pharmacology + insights tests (Phase 3 — has its own cited test corpus)
- Sentry source-map upload tooling (Phase 2 alongside the deploy)
- PostHog real-event firing in production (Phase 7 legal counsel sign-off)
- Auth / Supabase / cloud sync (Phases 4–6)
- Compliance copy and legal-counsel-led work (Phase 7)

</domain>

<decisions>
## Implementation Decisions

### Lint Debt Cleanup Scope

- **D-01: Clean-house-now.** Phase 1 also fixes the existing v2 lint violations so ESLint can run at error-level from day one. Scope:
  - 5× `as never` casts replaced with proper types (Topbar `setTab` narrowed against `TAB_TITLES`; ActivityTab `Workout.type` typed; BodyTab `Measurement` typed; HomeTab `insight.cta.tab` tightened to `TabId`; BaseChart `ChartOptions<ChartType>` instead of `never`)
  - 3× native `alert()` / `confirm()` (SettingsPage reset, AIChatPanel clear-history, InsightsTab "Get the guide") replaced with the existing `Modal` / a small `useConfirm()` helper
  - Orphan `// eslint-disable-next-line react-hooks/exhaustive-deps` at `BaseChart.tsx:36` resolved (either fix the hook or document the genuine exception)
  - `YOURTAG-20` Amazon affiliate placeholder dropped (no `&tag=` query param at all — affiliate program isn't active)
- **D-02: Full health-app ESLint ruleset.** ESLint recommended + `@typescript-eslint` recommended + `eslint-plugin-react` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `eslint-plugin-jsx-a11y` + import-order rules. `jsx-a11y` is locked in because PROJECT.md constraints require keyboard nav, screen-reader labels, color contrast, and reduced-motion behavior end-to-end. Catches a11y regressions in PR review instead of manual audit.
- **D-03: CI-only gates, no pre-commit hooks.** GitHub Actions runs lint+format:check+typecheck+unit+smoke on every push and PR. No Husky, no `lint-staged`. Trade accepted: contributors can push lint-broken code and discover it at CI; in exchange, local commits stay friction-free.
- **D-04: Fix `claude-sonnet-4-6` model ID in this phase.** Patch `src/lib/ai.ts:22` `DEFAULT_MODEL` to `'claude-sonnet-4-5'` (a real, current Claude model ID). One-line change. The whole file gets rewritten in Phase 4 (Supabase Edge Function proxy), but until then the AI coach actually works in dev/QA.

### Test Writing Scope

- **D-05: Smoke + foundational pure functions + onboarding integration.** Phase 1 lands tests for code that has no other claiming phase:
  - `src/lib/helpers.ts` — every pure function (`todayStr`, `lastNDays`, `daysBetween`, `hoursSince`, `relTime`, `formatDuration`, `greeting`, `cn`, `clamp`, `pct`, `escapeHtml`). DST-fragile date math is the priority.
  - `src/hooks/useStreaks.ts` — extract a pure `calc()` helper and unit-test the four streak predicates across a fixture year. CONCERNS.md flagged DST + 365-day-walk as fragile.
  - `src/lib/storage.ts:migrateFromV3` — fixture-driven tests for the four-way matrix (v3 only / v4 only / both / corrupted v3). CONCERNS.md flagged this as silent-data-loss risk; v1 must not regress migration before Phase 6 (when full cloud sync ships).
  - `OnboardingFlow` happy-path integration test (RTL) that runs the seven-step flow and asserts the resulting `User` shape. CONCERNS.md priority "High."
- **D-06: Full onboarding happy path for Playwright smoke.** The single Playwright smoke test launches the dev server, navigates to `/`, clicks through marketing → all 7 onboarding steps → asserts the dashboard's `HomeTab` renders. Both Playwright and RTL cover onboarding (intentional redundancy — RTL catches component bugs, Playwright catches build/lazy-load/CSS regressions).
- **D-07: Co-located test files.** `src/lib/helpers.test.ts` lives next to `src/lib/helpers.ts`. Standard Vitest convention. Playwright tests live under a top-level `e2e/` directory (separate runner config).
- **D-08: NOT scoped to Phase 1.** `pharmacology.ts` and `insights.ts` test corpora — Phase 3 owns them with cited peer-reviewed sources. Zustand store action tests (CONCERNS.md flagged `addInjection` vial-decrement coupling and `bulkAddWeights` dedupe/sort) — defer; not silently lossy and store actions can be tested incrementally.

### Sentry Redaction Strategy

- **D-09: Scrub values, keep structure.** `beforeSend` walks the event payload (errors, breadcrumbs, request bodies) and replaces values matching the redaction key list with `[Redacted]`. Stack frames, error class, file/line/function names are preserved so error stacks stay debuggable. Implementation must handle nested objects, arrays, and JSON-serialized strings (e.g., a JSON string in a breadcrumb body).
- **D-10: Redact only the four named fields in PROD-02.** `symptom`, `mood`, `note`, `aiHistory`. Free-text fields outside this list (`meals[].name`, `supplements[].search`, `weights[].nsv`, `injections[].note`) stay unscrubbed in Phase 1. Trade explicitly accepted by the user — the spec calls these four out and we match it literally. **(Risk noted in Deferred Ideas — re-evaluate before Phase 7 legal counsel sign-off.)**
- **D-11: Errors only — no Replay, no Tracing, no Profiling.** Just `Sentry.captureException` + breadcrumbs. Lowest PII surface. Replay/Tracing can land in Phase 2 or later if needed; nothing's deployed in Phase 1 so cross-region tracing has no value yet.
- **D-12: Dev-only Settings panel for the demo trigger.** Add a `Dev Tools` subsection to `SettingsPage.tsx` rendered behind `import.meta.env.DEV`. Single button labeled "Throw test error → Sentry" that does `throw new Error("phase-1-sentry-smoke")` outside any error boundary. Survives in dev forever; never compiles into production builds. Future devs can reuse it for ad-hoc diagnostic throws.

### Analytics Consent Posture

- **D-13: Phase-7-gated production firing.** PostHog SDK loads in Phase 1. A `analyticsEnabled` config flag (read from a build-time env var, default `false` in production builds) gates whether `posthog.capture` actually fires. In dev/QA the flag is `true` so the founder can verify the pipeline (success criterion #2). Phase 7 (legal-counsel-led compliance) flips the production flag to `true` after WMHMDA / FTC HBNR review.
- **D-14: Onboarding funnel + tab views as the v1 starter taxonomy.** Phase 1 ships a typed `track()` helper (`src/lib/analytics.ts`) with a `EventName` union: `onboarding_started`, `onboarding_step_completed`, `onboarding_completed`, `onboarding_abandoned`, `tab_viewed`. Other phases extend the union as features land (`injection_logged`, `share_link_created`, `clinic_invite_accepted`, etc.). Lays down the pattern without locking in vocabulary that doesn't exist yet.
- **D-15: localStorage UUID for `distinct_id`.** Phase 1 generates a stable random UUID stored under `localStorage["leanshot_distinct_id"]` and passes it to `posthog.identify()` on load. Survives reloads on the same browser; clearing storage resets it. Persistent enough for funnel analysis without being a tracking cookie or PII. Phase 5 (auth) will call `posthog.alias()` to bind the anon UUID to `auth.uid()` once accounts ship.

### Claude's Discretion

- ESLint flat-config (`eslint.config.js`) vs legacy `.eslintrc.cjs` — flat is the React 19 / TS 5.6 recommended path, planner picks.
- Prettier config knobs (semicolons, quote style, print width, trailing comma) — pick a sensible default; current code reads as single-quote, semi true, ~100 col, trailing comma `all`.
- Vitest config — `jsdom` vs `happy-dom` test environment; planner picks based on RTL compatibility (jsdom is the safer default for React 19).
- GitHub Actions matrix shape — single Node version (LTS) is fine; concurrency cancellation on push to same PR is good practice.
- Sentry/PostHog DSN+key delivery — Vite env vars (`VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_ANALYTICS_ENABLED`) with `.env.example` committed and `.env.local` gitignored (gitignore already excludes both).
- The `useConfirm()` helper — wrap the existing `Modal` component, return a Promise. Planner decides whether to live in `src/hooks/useConfirm.ts` or `src/components/ui/Confirm.tsx`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Anchors

- `.planning/ROADMAP.md` §"Phase 1: Quality Gates & Observability Foundation" — phase goal, success criteria, requirement mapping
- `.planning/REQUIREMENTS.md` §"Production Readiness" (PROD-02, PROD-03, PROD-04, PROD-05) — the four locked requirements for this phase
- `.planning/PROJECT.md` §"Constraints" + §"Key Decisions" — Tech stack lock (React 19 + Vite + TS strict + Tailwind v4 + Zustand), local-first architecture constraint, performance/accessibility constraints

### Codebase Intel (existing analyses — do not re-derive)

- `.planning/codebase/CONCERNS.md` — Tech debt inventory (the lint debt this phase cleans up), test gaps (the foundational tests this phase lands), security considerations (the redaction list informing Sentry decisions). Lines on `as never` casts, native dialogs, `migrateFromV3` lossiness, `BaseChart` orphan `eslint-disable`.
- `.planning/codebase/TESTING.md` — Confirms zero existing tests; lists targets in priority order (pharmacology + insights + storage + helpers + streaks + onboarding). Phase 1 picks the non-Phase-3 subset.
- `.planning/codebase/INTEGRATIONS.md` — Confirms zero error tracking / analytics / CI today. Phase 1 introduces all three. AI client section documents the `claude-sonnet-4-6` bug.
- `.planning/codebase/STACK.md` — Stack details for Vite 6 + React 19 + TS 5.6 + Tailwind v4 (informs ESLint preset compatibility).
- `.planning/codebase/CONVENTIONS.md` — Existing naming/import/component conventions Prettier and ESLint configs must respect.
- `.planning/codebase/ARCHITECTURE.md` — Single Zustand store; lazy-loaded tabs in `App.tsx`; `useReducedMotion` accessibility hook (a11y rules must respect this pattern).

### Research Inputs

- `.planning/research/SUMMARY.md` §"Recommended Stack" — Vitest 4 + RTL 16 + Playwright 1.59 + Sentry 10 + PostHog as the validated tooling. **Note:** SUMMARY.md was written before the Supabase pivot — its Better Auth / Hono / Cloudflare references are obsolete; PROJECT.md "Key Decisions" supersedes. The Vitest/RTL/Playwright/Sentry/PostHog calls remain valid for Phase 1.
- `.planning/research/PITFALLS.md` — Pitfall #1 (regulatory drift / WMHMDA) informs the analytics consent decision; Pitfall #4 (lossy migration) informs the `migrateFromV3` test priority.

### External Specs

- WMHMDA (Washington My Health My Data Act) — referenced by PROJECT.md and PITFALLS.md as the primary US-state regulatory bar for consumer health data; consent-posture decision in this phase defers full compliance to Phase 7. No locally-stored copy.
- FTC Health Breach Notification Rule (HBNR) — referenced by PITFALLS.md; registration is Phase 7 scope.

### File Targets for Phase 1 Cleanup

- `src/components/layout/Topbar.tsx:36` — `setTab(tab as never)` → narrow against `TAB_TITLES`
- `src/components/dashboard/tabs/ActivityTab.tsx:118` — `setWo({ ...wo, type: e.target.value as never })` → typed `Workout.type`
- `src/components/dashboard/tabs/BodyTab.tsx:82` — `addMeasurement(entry as never)` → typed `Measurement`
- `src/components/dashboard/tabs/HomeTab.tsx:43` — `setTab(insight.cta!.tab as never)` → tighten `Insight.cta.tab` to `TabId` in `src/lib/insights.ts:18`
- `src/components/dashboard/charts/BaseChart.tsx:36` — orphan `eslint-disable-next-line react-hooks/exhaustive-deps`; `:44` — `c.options = (config.options ?? {}) as never` → `ChartOptions<ChartType>`
- `src/components/dashboard/settings/SettingsPage.tsx:78-79` — double `confirm()` for "Reset everything"
- `src/components/dashboard/ai/AIChatPanel.tsx:114` — `confirm('Clear conversation history?')`
- `src/components/dashboard/tabs/InsightsTab.tsx:159` — `alert('Connect your payment provider here.')`
- `src/components/dashboard/tabs/SupplementsTab.tsx:66` — `&tag=YOURTAG-20` Amazon affiliate placeholder
- `src/lib/ai.ts:22` — `DEFAULT_MODEL = 'claude-sonnet-4-6'` → `'claude-sonnet-4-5'`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/components/ui/Modal.tsx`** — Existing themed modal (`role="dialog"`, `aria-modal`, focus trap implicit via `framer-motion` overlay). The `useConfirm()` helper that replaces native `alert()` / `confirm()` should compose this, not introduce a second modal primitive.
- **`src/main.tsx`** — Sentry SDK init must run BEFORE `await hydrate()` so any error during hydration is captured. PostHog init can run after hydrate (analytics events don't need to capture pre-paint state).
- **`src/lib/storage.ts:apiKeyStorage`** — Existing localStorage wrapper with try/catch — pattern to follow for the new `leanshot_distinct_id` UUID storage.
- **`src/lib/helpers.ts:cn`** — Existing utility import pattern. New `lib/analytics.ts` and the (new) `lib/sentry.ts` follow the same shape: pure module, single named export, no React.
- **`src/components/dashboard/settings/SettingsPage.tsx`** — Where the dev-only Sentry trigger lives. Already has section structure (`Profile` / `Goals` / `AI` / `Data`); add a `Dev Tools` section gated by `import.meta.env.DEV`.

### Established Patterns

- **Lazy-loaded routes via `React.lazy` + `Suspense` in `src/App.tsx`** — Sentry must be initialized before the first lazy import resolves, otherwise errors during chunk-fetch are unhandled. PostHog can lazy-load.
- **`partialize` in `src/lib/store.ts:231-250`** — Persists only data, not ephemeral UI flags. The new `leanshot_distinct_id` UUID lives OUTSIDE the Zustand store (separate localStorage key) — same pattern as `leanshot_anthropic_key` and `leanshot_theme_v4`.
- **`try { ... } catch { /* noop */ }` around every `localStorage` read/write** — Required because private-mode browsers throw. The PostHog distinct_id helper must follow this pattern.
- **`useReducedMotion` hook (`src/hooks/useReducedMotion.ts`)** — `jsx-a11y` rules around motion should not flag the existing reduced-motion-aware components; ESLint config must understand this pattern is valid.
- **`tsconfig.app.json:14` strict mode** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`. ESLint TS rules must not duplicate type-system enforcement (avoid `@typescript-eslint/no-unused-vars` since `tsc` already catches it; or set it to `warn` for the few cases where TS doesn't fire).
- **`@/*` path alias** — `tsconfig.app.json` + `vite.config.ts`. ESLint `import/resolver` config must understand the alias so import-order rules work.

### Integration Points

- **`vite.config.ts`** — Will gain a Vitest `test` block (Vitest 4 reads from this same config). `@vitejs/plugin-react` already registered.
- **New top-level files:** `eslint.config.js`, `.prettierrc`, `vitest.config.ts` (or merged into `vite.config.ts`), `playwright.config.ts`, `.github/workflows/ci.yml`, `e2e/` directory, `.env.example`, `src/lib/sentry.ts`, `src/lib/analytics.ts`.
- **Existing `npm run build`** = `tsc -b && vite build`. CI `build` job reuses this. Add new scripts: `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:unit`, `test:e2e`.
- **Sentry init order in `src/main.tsx`** — `Sentry.init` BEFORE the saved-theme read, BEFORE `applyThemeToDOM`, BEFORE `hydrate()`. Capturing a hydration error is a primary use case.
- **PostHog init order in `src/main.tsx`** — After `hydrate()` so the persisted state (with `distinct_id` if migrated from prior session) is available; before the first `posthog.capture('tab_viewed')` from `App.tsx`.

</code_context>

<specifics>
## Specific Ideas

- **Lint preset is opinionated toward health-app constraints.** `jsx-a11y` is non-negotiable because the audience includes patients with chronic conditions and the constraint is documented in PROJECT.md. The user did not pick the "minimal" or "standard" recipes.
- **The redaction list literally matches PROD-02.** The user explicitly chose to redact only `symptom`, `mood`, `note`, `aiHistory` — not the broader set of free-text fields. This is a deliberate tight scope, not an oversight; revisit before Phase 7.
- **Both Playwright and RTL cover onboarding.** The redundancy is intentional, accepted by the user when picking "Full onboarding happy path" for Playwright. RTL catches component bugs, Playwright catches build/lazy-load/CSS regressions; together they cover the "new user" risk class CONCERNS.md flagged as High priority.
- **Production analytics stay dormant until Phase 7 flips the flag.** This means the founder's success-criterion #2 demo (`onboarding_started` + `tab_viewed` events visible in PostHog) happens on a dev/QA build, not a production build.
- **Vertical MVP slice for an infra phase = the engineering team's experience.** What "a real human can verify" looks like: the founder opens a PR, sees green CI gates, sees their own thrown error in Sentry within 60s, sees their own tab-views in PostHog (via the dev/QA build with the flag on).

</specifics>

<deferred>
## Deferred Ideas

- **Broaden Sentry redaction list before Phase 7.** Phase 1 redacts only the four named fields. Free-text fields outside this list (`meals[].name`, `supplements[].search`, `weights[].nsv`, `injections[].note`, `vials[].source`) may carry user-typed content. Re-evaluate during Phase 7 legal-counsel-led compliance review; if WMHMDA "consumer health data" interpretation pushes the bar, expand the list and add a regression test that asserts no redaction-list key escapes.
- **Husky + lint-staged pre-commit hooks.** Currently CI-only. If the team grows and broken-CI cycles become frequent, revisit. Captured as a v1.1 / post-launch consideration.
- **Sentry Session Replay + Performance Tracing.** Errors-only in Phase 1. Phase 2 (public deploy) is the natural place to add Replay (with `maskAllText: true`). Phase 4+ (Supabase Edge Functions) is when Tracing earns its bundle weight.
- **Coverage threshold enforcement.** No `vitest --coverage` requirement in Phase 1. Ratchet later if coverage drift becomes a problem.
- **Zustand store action tests** (`addInjection`, `bulkAddWeights`, `upsertWeight/Sleep/Mood`). CONCERNS.md flagged the vial-decrement coupling and the dedupe/sort logic. Not silently lossy; defer to incremental tests as later phases touch these actions.
- **Sentry source-map upload via `@sentry/vite-plugin`.** Pointless until there's a deploy. Phase 2 work.
- **A `/__debug` route for ad-hoc Sentry/PostHog diagnostics.** Considered alongside the Settings dev-tools panel; the panel won. The route can be added in a later phase if dev needs grow.
- **PostHog feature flags / experiments.** Out of Phase 1 scope. Available later if A/B testing becomes useful.
- **Settings model-id override** (let the user pick the Claude model ID). Considered alongside the `claude-sonnet-4-6` fix; user picked the simpler one-line fix. Phase 4 will revisit when the AI proxy lands.

</deferred>

---

*Phase: 1-quality-gates-observability-foundation*
*Context gathered: 2026-05-10*
