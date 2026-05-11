# Testing Patterns

**Analysis Date:** 2026-05-10

## Test Framework

**None.** This project has no test framework configured.

Verification:

- `package.json` has no `test` / `vitest` / `jest` script. The only scripts are `dev`, `build`, `preview`, `typecheck`.
- `package.json` has zero testing dependencies. No `vitest`, `jest`, `@testing-library/*`, `@vitest/*`, `jsdom`, `happy-dom`, `playwright`, `cypress`, `puppeteer`, `msw`, or any sibling.
- `package-lock.json` confirms — no testing packages exist as transitive dependencies either.
- No `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `cypress.config.*`, or any other test runner config file exists at the repo root or anywhere in `src/`.
- No `tests/`, `__tests__/`, `test/`, `e2e/`, `spec/`, or similar directory exists.
- No `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx` file exists anywhere in the repo (search performed with `find . -type f \( -name "*.test.*" -o -name "*.spec.*" \) -not -path "*/node_modules/*"` — zero hits).

The only quality gate is `npm run typecheck` (`tsc -b --noEmit`), which catches type errors but not runtime/logic bugs.

## Test File Locations

Not applicable — no tests exist.

## Test Structure

Not applicable — no tests exist.

## Mocking

Not applicable — no tests exist.

## Fixtures and Factories

Not applicable — no tests exist.

## Coverage

**Effective coverage: 0%.** No coverage tooling is configured.

## Test Types

**Unit tests:** None.
**Integration tests:** None.
**E2E tests:** None.
**Visual regression / snapshot tests:** None.
**Type tests:** Implicit only — TypeScript's `strict` mode acts as the sole automated quality gate (`npm run typecheck`).

## Run Commands

There is no test command. `package.json:6-11`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "typecheck": "tsc -b --noEmit"
}
```

## Test Gap for a SPA of This Complexity

This is a meaningful gap, not a small oversight. LeanShot is a roughly 9,000-line TypeScript SPA spanning **81 source files** across **18 directories** (`src/components/{ui,layout,dashboard/{tabs,settings,cards,charts,modals,ai,tour,share},marketing,onboarding}`, `src/lib/{share-card}`, `src/hooks`, `src/illustrations`, `src/types`). It contains:

- **A persistence layer with explicit version migration** (`src/lib/storage.ts` — `migrateFromV3()` parses arbitrary localStorage JSON from v1 and shapes it into the v4 schema). A regression here silently corrupts user data.
- **Pharmacology math** (`src/lib/pharmacology.ts` — half-life curves, titration timelines, `calcMedLevel`). Bad arithmetic here gives users incorrect medication-level readouts.
- **A rule engine** for daily focus and insight generation (`src/lib/insights.ts` — 7 conditional branches in `generateInsights`, 6 in `pickFocus`, all reading 18 different state slices). No automated check that the right rule fires for a given state shape.
- **Streak calculations** (`src/hooks/useStreaks.ts`) walking 365 days of history with 4 independent predicates. Off-by-one bugs in calendar math are easy to introduce.
- **Date/time formatting helpers** in `src/lib/helpers.ts` (`todayStr`, `lastNDays`, `daysBetween`, `hoursSince`, `relTime`, `formatDuration`, `greeting`) — eight pure functions, none verified.
- **An external HTTP client** (`src/lib/ai.ts` — Anthropic API call with custom error class). Untested error paths.
- **A Zustand store with 31 mutators** (`src/lib/store.ts`), several of them non-trivial (`addInjection` decrements the first non-empty vial in lockstep; `bulkAddWeights` deduplicates by date and re-sorts; `upsertWeight` and `upsertSleep` and `upsertMood` all do find-or-insert).
- **A 7-step onboarding flow** (`src/components/onboarding/OnboardingFlow.tsx`) that constructs a `User` object with computed defaults — silently miscomputed targets ship to all new users.
- **A guided tour, share-card renderer, and doctor-report generator** — each non-trivial.

**What "no tests" means concretely for this codebase:**

1. **No regression net for the v3 → v4 migration.** A typo in `migrateFromV3` (e.g. `(v3.weights as Injection[])`) would compile and ship — the assertions are unchecked. Users hitting the migration path on next deploy would lose data with no warning.
2. **Pharmacology drift is invisible.** If someone changes `HALF_LIVES` or the exponential decay in `calcMedLevel`, GLP-curve values shift on every user's home screen with no test to catch the regression.
3. **Insight rules are implicitly tested only by manual click-through.** The 13+ branches in `insights.ts` would each need a fixture state to verify. Currently a bug like comparing `>=` instead of `>` in a threshold survives until a user reports it.
4. **Date/calendar logic is untested.** Functions like `daysBetween`, `lastNDays`, and `relTime` use `Date` arithmetic that is notoriously DST-fragile. There is no test pinning the expected output for known inputs.
5. **Pure utility functions have zero confidence floor.** `cn`, `clamp`, `pct`, `escapeHtml`, `formatDuration` — all trivial-looking but trivially break-able.
6. **No accessibility tests.** Components carefully apply `aria-*` attributes and `role`s (see `CONVENTIONS.md`), but there is no automated check that they survive future edits — a missing `aria-label` on a new icon button would not be caught.
7. **No visual regression coverage.** The design system has 5 button variants, 3 sizes, 4 card variants, light/dark themes, mobile/tablet/desktop breakpoints, and reduced-motion vs animated states. None pinned by snapshot.

**What a minimum-viable test plan would look like for this SPA** (recommendation, not a current artifact):

1. **Vitest + jsdom** as the runner, co-located `*.test.ts` next to source files.
2. **Pure-function unit tests** for everything in `src/lib/helpers.ts`, `src/lib/insights.ts`, `src/lib/pharmacology.ts`, `src/hooks/useStreaks.ts` (extracted `calc()` helper). These are the highest-leverage targets — pure inputs, deterministic outputs, no React.
3. **Storage migration tests** for `migrateFromV3` — feed it a representative v3 blob, assert the resulting `PersistedState` shape and field-by-field correctness. Add a regression test for every shipped v1 quirk.
4. **Store action tests** — instantiate the Zustand store, invoke each action, assert state transitions. Especially `addInjection` (vial decrement coupling) and `bulkAddWeights` (dedupe + sort).
5. **`@testing-library/react`** for a small set of integration tests on `OnboardingFlow` (full happy-path flow → assert resulting `User` shape) and `App` (boot with hydrated user → renders dashboard, not marketing).
6. **Playwright** for one or two end-to-end smoke flows: onboarding → dashboard → log injection → see GLP curve update.

Until something like that exists, **every change to `src/lib/` should be treated as load-bearing and reviewed manually against expected outputs** — the type system alone is not enough to protect the math, the migration, or the insight rules.

---

*Testing analysis: 2026-05-10*
