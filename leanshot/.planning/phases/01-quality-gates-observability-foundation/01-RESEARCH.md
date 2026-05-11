# Phase 1: Quality Gates & Observability Foundation - Research

**Researched:** 2026-05-10
**Domain:** Testing infrastructure (Vitest + RTL + Playwright), ESLint flat-config, GitHub Actions CI, Sentry error tracking (PII redaction), PostHog cookieless analytics
**Confidence:** HIGH for tooling versions and config patterns (npm-verified + Context7); MEDIUM for PostHog cookieless distinct_id lifecycle (documented but nuanced)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: Clean-house-now.** Fix existing lint violations so ESLint runs at error-level from day one. Scope: 5x `as never`, 3x native dialogs, orphan `eslint-disable`, `YOURTAG-20` affiliate placeholder, `claude-sonnet-4-6` model ID.
- **D-02: Full health-app ESLint ruleset.** ESLint recommended + `@typescript-eslint/recommended` + `eslint-plugin-react` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `eslint-plugin-jsx-a11y` + import-order rules.
- **D-03: CI-only gates, no pre-commit hooks.** GitHub Actions runs lint+format:check+typecheck+unit+smoke on every push and PR. No Husky, no `lint-staged`.
- **D-04: Fix `claude-sonnet-4-6` model ID.** Patch `src/lib/ai.ts:22` `DEFAULT_MODEL` to `'claude-sonnet-4-5'`.
- **D-05: Smoke + foundational pure functions + onboarding integration.** Tests for `src/lib/helpers.ts` (all pure fns), `src/hooks/useStreaks.ts` (extract `calc()` helper, unit-test four streak predicates), `src/lib/storage.ts:migrateFromV3` (four-way fixture matrix), `OnboardingFlow` RTL happy-path.
- **D-06: Full onboarding happy path for Playwright smoke.** Single Playwright test: marketing → 7 onboarding steps → dashboard HomeTab renders.
- **D-07: Co-located test files.** `src/lib/helpers.test.ts` next to `src/lib/helpers.ts`. Playwright tests under `e2e/`.
- **D-08: NOT scoped to Phase 1.** pharmacology.ts / insights.ts corpus (Phase 3). Zustand store action tests (defer).
- **D-09: Scrub values, keep structure.** `beforeSend` walks event payload and replaces matching key values with `[Redacted]`. Stack frames preserved.
- **D-10: Redact only four named fields.** `symptom`, `mood`, `note`, `aiHistory`.
- **D-11: Errors only.** No Replay, no Tracing, no Profiling in Phase 1.
- **D-12: Dev-only Settings panel for Sentry test trigger.** `Dev Tools` section in `SettingsPage.tsx` behind `import.meta.env.DEV`.
- **D-13: Phase-7-gated production firing.** `VITE_ANALYTICS_ENABLED` env var gates `posthog.capture`; default `false` in production, `true` in dev/QA.
- **D-14: Onboarding funnel + tab views as v1 starter taxonomy.** `EventName` union: `onboarding_started`, `onboarding_step_completed`, `onboarding_completed`, `onboarding_abandoned`, `tab_viewed`.
- **D-15: localStorage UUID for `distinct_id`.** Generate stable UUID under `localStorage["leanshot_distinct_id"]`, pass to `posthog.identify()`. Phase 5 calls `posthog.alias()` to bind anon UUID to `auth.uid()`.

### Claude's Discretion

- ESLint flat-config (`eslint.config.js`) vs legacy `.eslintrc.cjs` — flat is the React 19 / TS 5.6 recommended path, planner picks.
- Prettier config knobs (semicolons, quote style, print width, trailing comma) — current code reads as single-quote, semi true, ~100 col, trailing comma `all`.
- Vitest config — `jsdom` vs `happy-dom` test environment; planner picks based on RTL compatibility.
- GitHub Actions matrix shape — single Node version (LTS) is fine; concurrency cancellation on push to same PR is good practice.
- Sentry/PostHog DSN+key delivery — Vite env vars (`VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_ANALYTICS_ENABLED`) with `.env.example` committed.
- The `useConfirm()` helper — wrap existing `Modal`, return a Promise.

### Deferred Ideas (OUT OF SCOPE)

- Broaden Sentry redaction list before Phase 7.
- Husky + lint-staged pre-commit hooks.
- Sentry Session Replay + Performance Tracing.
- Coverage threshold enforcement.
- Zustand store action tests.
- Sentry source-map upload via `@sentry/vite-plugin`.
- A `/__debug` route for diagnostics.
- PostHog feature flags / experiments.
- Settings model-id override.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROD-02 | Real-user JS errors captured by Sentry with PII redaction for symptom/mood/AI fields | Sentry SDK 10 init pattern, `beforeSend` recursive scrubber, dev-only trigger in SettingsPage |
| PROD-03 | Privacy-respectful analytics (PostHog cookieless mode) measure feature usage without leaking health content | PostHog `persistence: 'localStorage'` + `disable_surveys: true`, typed `track()` helper, Phase-7-gated production flag |
| PROD-04 | Vitest 4 + RTL + Playwright configured with `npm test` running in CI on every PR | Vitest 4 in vite.config.ts, jsdom env, RTL 16, Playwright 1.59 chromium-only, CI workflow |
| PROD-05 | ESLint + Prettier + typecheck in CI; existing `tsc -b --noEmit` wired to PR checks | ESLint 10 flat-config with full health-app ruleset, Prettier 3, 5-job CI pipeline |
</phase_requirements>

---

## Summary

Phase 1 wires the engineering rails before any feature work: GitHub Actions runs five gates on every PR (lint, format:check, typecheck, test:unit, test:e2e), a thrown error surfaces in Sentry within 60 seconds with PII scrubbing, and a `tab_viewed` event appears in PostHog cookieless mode.

The codebase starts with zero tests, no linter, no CI, and several lint violations that must be fixed before ESLint can run at error-level. The research confirms that all tooling versions from the prior research synthesis remain current as of 2026-05-10 (Vitest 4.1.5, RTL 16.3.2, Playwright 1.59.1, Sentry @sentry/react 10.52.0, PostHog 1.372.10). The `@sentry/vite-plugin` (5.2.1) is available but explicitly deferred to Phase 2 alongside the deploy — Phase 1 doesn't need it.

The five most implementation-critical findings: (1) Sentry's `beforeSend` needs a recursive key-value scrubber that also handles JSON-serialized strings in breadcrumb bodies; (2) PostHog's correct cookieless approach for this app is `persistence: 'localStorage'` with a self-managed UUID — NOT PostHog's `cookieless_mode: 'always'` which would prevent the funnel analysis D-15 needs; (3) ESLint flat-config with React 19 requires `eslint-plugin-react-hooks@7.1.1` which has shipped flat-config support; (4) Vitest 4 co-locates with `vite.config.ts` via an added `test` block (no separate config file needed); (5) the `BaseChart.tsx` ESLint disable comment is a genuine exception and should be documented rather than removed — the two-effect pattern is correct for Chart.js StrictMode safety.

**Primary recommendation:** Ship all five CI gates in one wave before touching any feature code. Fix the lint debt (D-01) as the first implementation step so `npm run lint` passes on the existing codebase before any new code lands.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Error capture & PII scrubbing | Browser / Client | — | Sentry SDK runs in the browser SPA; no backend exists in Phase 1 |
| Analytics event emission | Browser / Client | — | PostHog browser SDK; events gate on build-time env var |
| Test execution (unit) | Build / CI | Local dev | Vitest runs via Node in CI and locally |
| Test execution (e2e) | Build / CI | Local dev | Playwright launches Chromium against Vite dev server |
| Lint + typecheck | Build / CI | Local dev | ESLint flat-config + `tsc -b --noEmit` |
| Sentry DSN / PostHog key delivery | Build / CI | Local dev | `VITE_*` env vars injected at build time; never in source |

---

## Standard Stack

### Core

| Library | Version (verified npm) | Purpose | Why Standard |
|---------|------------------------|---------|--------------|
| vitest | 4.1.5 | Unit + integration test runner | Co-locates with Vite config; identical env to prod build |
| @testing-library/react | 16.3.2 | Component test utilities for React | Industry standard for React; queries DOM by accessibility role |
| @testing-library/user-event | 14.6.1 | Realistic user interaction simulation | Replaces `fireEvent`; handles pointer/keyboard sequences |
| @testing-library/jest-dom | 6.9.1 | Custom DOM matchers (`toBeInTheDocument`) | Eliminates verbose `toBeTruthy` assertions on DOM nodes |
| @playwright/test | 1.59.1 | E2E smoke tests | Headless Chromium; CI-ready; locator-based (resilient selectors) |
| @sentry/react | 10.52.0 | Error capture + breadcrumbs | Official SDK; `beforeSend` hook; tree-shakes to errors-only |
| posthog-js | 1.372.10 | Product analytics (cookieless) | `persistence: 'localStorage'` mode; typed capture API |
| eslint | 10.3.0 | Static analysis | v10 = flat-config by default; required for `eslint.config.js` |
| typescript-eslint | 8.59.2 | TS-aware lint rules | Official TS/ESLint bridge; `@typescript-eslint/*` namespaced rules |
| prettier | 3.8.3 | Code formatting | Single opinionated formatter; `format:check` in CI |

### Supporting

| Library | Version (verified npm) | Purpose | When to Use |
|---------|------------------------|---------|-------------|
| eslint-plugin-react | 7.37.5 | React JSX rules | Always with React projects |
| eslint-plugin-react-hooks | 7.1.1 | Hooks rules (exhaustive-deps) | Always; ships flat-config support in v7 |
| eslint-plugin-react-refresh | 0.5.2 | Vite HMR compatibility rules | Vite + React projects |
| eslint-plugin-jsx-a11y | 6.10.2 | Accessibility rules | Required by D-02 and PROJECT.md keyboard/screen-reader constraints |
| eslint-plugin-import-x | 4.16.2 | Import order + path validation | Modern fork of `eslint-plugin-import`; actively maintained |
| eslint-import-resolver-typescript | 4.4.4 | Resolves `@/*` alias for import-x | Required for `@/` path alias in import-order rules |
| @vitest/coverage-v8 | 4.1.5 | Code coverage (v8 provider) | Deferred to post-Phase 1; install now, configure threshold later |
| jsdom | 29.1.1 | DOM environment for Vitest | Pulled in by Vitest; stable for RTL 16 + React 19 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| eslint-plugin-import-x | eslint-plugin-import (legacy) | import-x is the actively maintained fork; import is in maintenance mode |
| jsdom (Vitest env) | happy-dom | happy-dom is 20x faster but has RTL 16 compatibility edge cases; jsdom is safe bet for React 19 |
| @playwright/test Chromium only | All three browsers | Phase 1 smoke needs speed; full cross-browser is Phase 2+ |
| PostHog `persistence: 'localStorage'` | `cookieless_mode: 'always'` | `cookieless_mode: 'always'` prevents all localStorage too — breaks distinct_id (D-15); `localStorage` persistence is the correct cookieless-while-functional setting |

**Installation:**

```bash
# Test libraries
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test @vitest/coverage-v8

# Playwright browsers (run after above)
npx playwright install chromium

# Sentry
npm install @sentry/react

# PostHog
npm install posthog-js

# ESLint ecosystem
npm install -D eslint typescript-eslint eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-plugin-jsx-a11y eslint-plugin-import-x eslint-import-resolver-typescript prettier
```

---

## Architecture Patterns

### System Architecture Diagram

```
Developer push / PR
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              GitHub Actions ci.yml                       │
│  ┌─────────┐ ┌──────────────┐ ┌──────────┐             │
│  │  lint   │ │ format:check │ │typecheck │  (parallel)  │
│  └────┬────┘ └──────┬───────┘ └────┬─────┘             │
│       │             │              │                     │
│  ┌────▼────┐   ┌────▼──────┐      │  (parallel)        │
│  │test:unit│   │ test:e2e  │◄─────┘                     │
│  │ (Vitest)│   │(Playwright)│                            │
│  └────┬────┘   └─────┬─────┘                            │
│       │              │                                   │
│  merge blocked if any job fails                          │
└──────────────────────────────────────────────────────────┘

Dev machine (local verify)
        │
        ▼
  npm run lint → eslint.config.js (flat-config) scans src/
  npm run format:check → prettier --check src/
  npm run typecheck → tsc -b --noEmit
  npm run test → vitest run + playwright test (chromium)

Runtime (browser, dev/QA build)
┌────────────────────────────────────────────────────────┐
│  main.tsx                                               │
│   1. Sentry.init() ← beforeSend scrubs symptom/mood/   │
│      note/aiHistory                                     │
│   2. applyThemeToDOM() + await hydrate()                │
│   3. PostHog.init() → identify(localStorage UUID)       │
│   4. createRoot().render(<App/>)                        │
│                                                         │
│  Error path: uncaught throw → Sentry event →           │
│    beforeSend scrubs → DSN upload → Sentry dashboard   │
│                                                         │
│  Analytics path: track('tab_viewed') → PostHog capture  │
│    gated by VITE_ANALYTICS_ENABLED → PostHog dashboard  │
└────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
leanshot/
├── .github/
│   └── workflows/
│       └── ci.yml                   # 5-job CI pipeline
├── e2e/
│   └── onboarding.spec.ts           # Playwright smoke test
├── src/
│   ├── lib/
│   │   ├── helpers.ts
│   │   ├── helpers.test.ts          # D-07: co-located
│   │   ├── sentry.ts                # beforeSend scrubber export
│   │   ├── analytics.ts             # typed track() helper
│   │   ├── storage.ts
│   │   └── storage.test.ts          # migrateFromV3 fixture matrix
│   ├── hooks/
│   │   ├── useStreaks.ts
│   │   └── useStreaks.test.ts        # extracted calc() fn tests
│   └── components/
│       └── onboarding/
│           └── OnboardingFlow.test.tsx  # RTL happy-path
├── eslint.config.js
├── .prettierrc
├── playwright.config.ts
├── vite.config.ts                   # gains `test` block for Vitest
├── .env.example                     # VITE_SENTRY_DSN, VITE_POSTHOG_KEY, etc.
└── .env.local                       # gitignored (already in .gitignore)
```

### Pattern 1: Vitest Config Merged into vite.config.ts

Vitest 4 reads `test` block from `vite.config.ts` directly — no separate `vitest.config.ts` needed.

```typescript
// Source: Vitest 4 docs — https://vitest.dev/config/
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // exclude e2e — Playwright has its own runner
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
```

```typescript
// src/test-setup.ts
import '@testing-library/jest-dom';
```

**jsdom rationale:** jsdom 29.1.1 has full RTL 16 compatibility. happy-dom is faster but has known gaps with `getComputedStyle` and some framer-motion JSDOM event patterns that can cause flaky RTL tests with React 19 StrictMode double-invocation. jsdom is the safer choice.

### Pattern 2: ESLint Flat-Config (eslint.config.js)

ESLint 10 defaults to flat-config. The `eslint.config.js` file (CJS format, no `.mjs` extension needed unless `"type": "module"` in package.json — check LeanShot's package.json).

```javascript
// Source: typescript-eslint.io/getting-started + plugin READMEs
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import importXPlugin from 'eslint-plugin-import-x';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  // Global ignores
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  // Base JS + TS recommended
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React + hooks + refresh
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
      'jsx-a11y': jsxA11yPlugin,
      'import-x': importXPlugin,
    },
    settings: {
      react: { version: 'detect' },
      'import-x/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
    },
    rules: {
      // React rules
      ...reactPlugin.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 19 automatic JSX runtime
      'react/prop-types': 'off',         // TypeScript handles this

      // React hooks
      ...reactHooksPlugin.configs.recommended.rules,
      // NOTE: BaseChart.tsx:36 has a legitimate 2-effect Chart.js pattern.
      // The disable comment there is kept (documented exception, not suppressed).

      // React Refresh (Vite HMR)
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Accessibility — non-negotiable per PROJECT.md
      ...jsxA11yPlugin.configs.recommended.rules,

      // Import ordering
      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'never',
        alphabetize: { order: 'asc', caseInsensitive: true },
      }],
      'import-x/no-unresolved': 'error',

      // TypeScript — avoid duplicating what tsc already catches
      // noUnusedLocals/noUnusedParameters in tsconfig does this; set warn not error
      // to handle the few edge cases where TS fires differently than ESLint
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Prefer type imports (matches existing codebase convention)
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        project: './tsconfig.app.json',
      },
    },
  },
]);
```

**Key decision (D-02 + Discretion):** `@typescript-eslint/no-unused-vars` set to `warn` (not `error`) because `tsconfig.app.json` already enforces `noUnusedLocals` / `noUnusedParameters` at compile time. Setting it to `error` in ESLint creates duplicate enforcement that fires differently in edge cases (e.g., ambient type-only imports that TS allows but ESLint flags). The CI chain is `typecheck` (catches unused vars as errors) + `lint` (catches everything else).

### Pattern 3: Sentry Init in main.tsx (BEFORE hydrate())

```typescript
// Source: @sentry/react README + Context7 /getsentry/sentry-javascript
// src/lib/sentry.ts — scrubber module

const REDACT_KEYS = new Set(['symptom', 'mood', 'note', 'aiHistory']);

function redactValue(key: string, value: unknown): unknown {
  if (REDACT_KEYS.has(key)) return '[Redacted]';
  if (typeof value === 'string') {
    // Handle JSON-serialized strings in breadcrumb bodies (D-09)
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        return JSON.stringify(walkAndRedact(parsed as Record<string, unknown>));
      }
    } catch {
      // Not JSON — return as-is
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => walkAndRedact(item as Record<string, unknown>));
  if (typeof value === 'object' && value !== null) {
    return walkAndRedact(value as Record<string, unknown>);
  }
  return value;
}

function walkAndRedact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

export function beforeSend(event: import('@sentry/react').ErrorEvent): import('@sentry/react').ErrorEvent {
  // Walk extra, contexts, request body — redact matching keys
  if (event.extra) {
    event.extra = walkAndRedact(event.extra as Record<string, unknown>);
  }
  if (event.contexts) {
    event.contexts = walkAndRedact(event.contexts as Record<string, unknown>) as typeof event.contexts;
  }
  // Breadcrumbs — data payloads may contain health fields
  if (event.breadcrumbs?.values) {
    event.breadcrumbs.values = event.breadcrumbs.values.map((bc) => ({
      ...bc,
      data: bc.data ? walkAndRedact(bc.data as Record<string, unknown>) : bc.data,
    }));
  }
  // Stack frames, error class, file/line are NOT touched (D-09: keep debuggable)
  return event;
}
```

```typescript
// src/main.tsx — init order (D-12, CONTEXT.md integration points)
import * as Sentry from '@sentry/react';
import { beforeSend } from '@/lib/sentry';

// MUST be first — captures errors during theme read, hydrate(), lazy chunk loads
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,  // 'development' | 'production'
  enabled: !!import.meta.env.VITE_SENTRY_DSN,  // no-op when DSN absent (local dev without .env.local)
  integrations: [],  // D-11: no Replay, no Tracing, no Profiling
  beforeSend,
});

// ... existing theme read ...
// ... existing await hydrate() ...
// ... PostHog init AFTER hydrate() (see Pattern 4) ...
// ... createRoot().render() ...
```

### Pattern 4: PostHog Init with localStorage UUID (D-13, D-14, D-15)

```typescript
// src/lib/analytics.ts

import posthog from 'posthog-js';

// Typed event taxonomy (D-14)
export type EventName =
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'onboarding_abandoned'
  | 'tab_viewed';

const DISTINCT_ID_KEY = 'leanshot_distinct_id';

/** Follows the apiKeyStorage try/catch pattern from src/lib/storage.ts */
function getOrCreateDistinctId(): string {
  try {
    const existing = localStorage.getItem(DISTINCT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DISTINCT_ID_KEY, id);
    return id;
  } catch {
    // Private-mode browser — return ephemeral UUID (not persisted)
    return crypto.randomUUID();
  }
}

export function initAnalytics(): void {
  const enabled = import.meta.env.VITE_ANALYTICS_ENABLED === 'true';
  const key = import.meta.env.VITE_POSTHOG_KEY;
  const host = import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com';

  posthog.init(key ?? '__placeholder__', {
    api_host: host,
    // D-15: localStorage UUID, no PostHog-managed cookies
    persistence: 'localStorage',
    // Do not autocapture clicks/forms — health content in DOM is too sensitive
    autocapture: false,
    capture_pageview: false,      // We track tab_viewed manually
    disable_surveys: true,
    // Gate actual network sends behind the flag (D-13)
    loaded: (ph) => {
      if (!enabled) {
        ph.opt_out_capturing();   // Silence all network calls in prod until Phase 7
      }
      const distinctId = getOrCreateDistinctId();
      ph.identify(distinctId);   // D-15: stable anon UUID
    },
  });
}

/** Type-safe wrapper — only call when analytics are enabled */
export function track(event: EventName, properties?: Record<string, string | number | boolean>): void {
  // Guard: never fire if opt-out active (redundant safety net)
  if (import.meta.env.VITE_ANALYTICS_ENABLED !== 'true') return;
  posthog.capture(event, properties);
}
```

**PostHog `persistence: 'localStorage'` vs `cookieless_mode: 'always'`:**
- `cookieless_mode: 'always'` means PostHog NEVER stores anything in localStorage or cookies — it generates a server-side hash. This would destroy the `distinct_id` persistence D-15 requires.
- `persistence: 'localStorage'` means PostHog uses localStorage (no cookies). Combined with `opt_out_capturing()` in production, this satisfies the analytics-dormant-until-Phase-7 requirement while keeping the UUID persisted for funnel analysis in dev/QA.
- Calling `posthog.opt_out_capturing()` silences all network calls but keeps the in-memory state — the dev-mode `opt_in` path is `ph.opt_in_capturing()` or simply not calling `opt_out` when `enabled=true`. [CITED: posthog.com/docs/libraries/js/persistence]

**Phase 5 alias lifecycle (D-15):** When auth ships, call `posthog.alias(auth.uid, distinctId)` after successful login to bind the pre-auth UUID to the authenticated user ID. This is the standard PostHog identity merge pattern.

**Init order in main.tsx:** PostHog init runs AFTER `await hydrate()` so the persisted state (including existing `leanshot_distinct_id`) is available. It does NOT need to run before the first render — analytics events don't gate the UI paint.

### Pattern 5: GitHub Actions ci.yml

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Cancel in-flight run for same branch/PR on new push
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  format-check:
    name: Format check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run format:check

  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck

  test-unit:
    name: Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit

  test-e2e:
    name: E2E smoke
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install chromium --with-deps
      - name: Build for E2E
        run: npm run build
        env:
          VITE_SENTRY_DSN: ''
          VITE_POSTHOG_KEY: ''
          VITE_ANALYTICS_ENABLED: 'false'
      - run: npm run test:e2e
```

**Node version:** LTS 22 (matches the dev machine: `v22.18.0`). Single version is sufficient for Phase 1 — no matrix.

**Playwright browser caching:** Playwright's own documentation advises against caching browser binaries — the cache restore time is comparable to download time (`npx playwright install chromium --with-deps` takes ~30s). [CITED: playwright.dev/docs/ci]

**Sentry source-map upload:** Explicitly deferred to Phase 2 (D-11, deferred). The `@sentry/vite-plugin` is NOT added to `vite.config.ts` in Phase 1.

**npm scripts to add to package.json:**
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint src",
    "lint:fix": "eslint src --fix",
    "format": "prettier --write src",
    "format:check": "prettier --check src",
    "test": "vitest run && playwright test",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "test:watch": "vitest"
  }
}
```

### Pattern 6: Playwright Config

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Retry once on CI to tolerate flakes
  retries: process.env.CI ? 1 : 0,
  // Sequential in CI (stability > speed for smoke)
  workers: process.env.CI ? 1 : undefined,
  // Chromium only (D-06; all-browser in Phase 2+)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Vite dev server for E2E (uses built output in CI)
  webServer: process.env.CI
    ? {
        command: 'npm run preview',
        port: 4173,
        reuseExistingServer: false,
      }
    : {
        command: 'npm run dev',
        port: 5173,
        reuseExistingServer: true,
      },
  // Retain traces on failure only
  use: {
    trace: 'on-first-retry',
    video: 'off',
    screenshot: 'only-on-failure',
  },
});
```

### Pattern 7: useConfirm() Hook

The `useConfirm()` hook wraps the existing `Modal` component and returns a Promise — callers `await confirm('message')` and receive `true/false`. No second modal primitive introduced (CONTEXT.md code_context: reuse Modal).

```typescript
// src/hooks/useConfirm.ts
import { useState, useCallback, useRef } from 'react';

export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((msg: string): Promise<boolean> => {
    setMessage(msg);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback((): void => {
    setOpen(false);
    resolveRef.current?.(true);
  }, []);

  const handleCancel = useCallback((): void => {
    setOpen(false);
    resolveRef.current?.(false);
  }, []);

  return { confirm, open, message, handleConfirm, handleCancel };
}
```

**Usage at call sites (D-01):**

```typescript
// SettingsPage reset (replaces double confirm())
const { confirm, open, message, handleConfirm, handleCancel } = useConfirm();

const reset = async (): Promise<void> => {
  const ok = await confirm('Erase ALL your LeanShot data? This cannot be undone.');
  if (!ok) return;
  resetAll();
  onClose();
};

// Render alongside the Modal:
// <ConfirmModal open={open} message={message} onConfirm={handleConfirm} onCancel={handleCancel} />
```

A thin `ConfirmModal` wrapper renders the `Modal` with confirm/cancel `Button` children. Lives in `src/components/ui/Confirm.tsx` (or `src/hooks/useConfirm.ts` with the modal in the same file — planner decides, both are one file).

**Three migration sites:**
1. `SettingsPage.tsx:78-79` — double `confirm()` → `await confirm('Erase ALL...')`
2. `AIChatPanel.tsx:114` — `confirm('Clear conversation history?')` → `await confirm(...)`
3. `InsightsTab.tsx:159` — `alert('Connect your payment provider here.')` → D-01 says drop this card entirely (the affiliate/payment feature is not active; hide behind `false` gate or remove the CTA button)

### Pattern 8: `as never` Type Fixes (5 sites)

**Exact fixes read from source files:**

**Topbar.tsx:36** — `setTab(tab as never)` in `handleSearch`:
```typescript
// Fix: validate tab value against TabId union before calling setTab
import type { TabId } from '@/types';

const TAB_VALUES = new Set<string>(['home', 'medication', 'symptoms', 'body',
  'nutrition', 'activity', 'supplements', 'mood', 'insights']);

// inside handleSearch:
if (TAB_VALUES.has(tab)) {
  setTab(tab as TabId);   // safe cast — validated above
}
```
Note: The map values in `handleSearch` are all literal strings that match `TabId` values. The `as never` was hiding that TypeScript couldn't prove `string` (from `Record<string, string>` values) is `TabId`. The fix narrows with a runtime check.

**ActivityTab.tsx:118** — `setWo({ ...wo, type: e.target.value as never })`:
```typescript
// Fix: the state type is already `{ type: 'resistance' | 'cardio' | 'hybrid' | 'walk' | 'yoga' }`
// The select options match these values. Cast via Workout['type'] which is the union:
import type { Workout } from '@/types';
type WorkoutType = Workout['type'];  // 'resistance' | 'cardio' | 'hybrid' | 'walk' | 'yoga'

setWo({ ...wo, type: e.target.value as WorkoutType });
```
This is a safe cast because the `<Select>` options are exhaustive — but TypeScript can't prove `string` is `WorkoutType`. Alternative: use a type guard.

**BodyTab.tsx:82** — `addMeasurement(entry as never)`:
```typescript
// entry is typed as { date: string; [k: string]: number | string }
// Measurement is { date: string; waist?: number; hips?: number; ... }
// Fix: use Measurement directly:
const entry: Measurement = { date: todayStr() };
(Object.keys(meas) as Array<keyof typeof meas>).forEach((k) => {
  const v = parseFloat(meas[k]);
  if (v) entry[k] = v;   // safe: meas keys match Measurement optional keys
});
addMeasurement(entry);
```
The `entry[k] = v` line still needs a cast if TypeScript complains about the index signature. Option: `(entry as Record<string, number>)[k] = v` is clean and correct because we've filtered numeric.

**HomeTab.tsx:43** — `setTab(insight.cta!.tab as never)`:
```typescript
// Fix: tighten Insight.cta.tab in src/lib/insights.ts:17 from string to TabId
// BEFORE in insights.ts:
cta?: { label: string; tab: string };
// AFTER:
cta?: { label: string; tab: TabId };

// Then in HomeTab.tsx:
onClick={() => setTab(insight.cta!.tab)}   // no cast needed
```
This is the cleanest fix — tighten the source type. All `generateInsights` return sites must use a valid `TabId` value (they do: 'activity', 'nutrition', 'medication', etc.).

**BaseChart.tsx:44** — `c.options = (config.options ?? {}) as never`:
```typescript
import type { ChartOptions, ChartType } from 'chart.js';

// Fix: assert as ChartOptions<ChartType> which is the correct type for Chart.options
c.options = (config.options ?? {}) as ChartOptions<ChartType>;
```
This is a Chart.js API limitation — `Chart.options` is typed as `ChartOptions<TType>` but `ChartConfiguration.options` is also `ChartOptions<TType>`, so the types should be compatible. The `as ChartOptions<ChartType>` cast is accurate and eliminates `never`.

**BaseChart.tsx:36 — ESLint disable comment:**

The two-effect pattern is intentional and correct:
- Effect 1: depends on `[theme]` — destroys+recreates the Chart.js instance on theme change (so all colors update from CSS vars).
- Effect 2: depends on `[config]` — pushes data updates without recreating.

The `// eslint-disable-next-line react-hooks/exhaustive-deps` at line 36 suppresses the "missing `config` dependency" warning for Effect 1. This suppression IS correct — adding `config` to Effect 1's deps would cause the chart to destroy+recreate on every data change, which is wrong.

**Resolution (D-01):** Keep the eslint-disable comment but replace the bare suppression with a reason comment:
```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: effect 1 owns chart
//   creation/destruction on theme change only; effect 2 handles data updates
```
This satisfies ESLint (the disable still works) and documents the exception so future reviewers don't "fix" it incorrectly. The orphan-disable-with-no-config situation from CONCERNS.md is resolved because ESLint is now configured.

### Anti-Patterns to Avoid

- **`as never` for union narrowing:** Use runtime type guards or proper union types. `as never` hides real type errors that become runtime crashes.
- **PostHog autocapture enabled:** The default `autocapture: true` would send DOM content (symptom text, note text) as event properties. Always disable for health apps.
- **Sentry init after `hydrate()`:** Sentry MUST be initialized first — errors during `hydrate()` (localStorage corruption, migration bugs) would be silently swallowed.
- **`posthog.capture()` without the `analyticsEnabled` gate:** Health event properties could include inferred content. The `track()` wrapper enforces the gate.
- **Importing `posthog-js` directly in components:** All calls should go through `src/lib/analytics.ts`'s `track()` so the gate and type enforcement are centralized.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Error serialization + source maps | Custom error reporter | `@sentry/react` | SDK handles async stack normalization, browser compat, rate limiting, DSN routing |
| Recursive object scrubber for arbitrary nested depth | Hand-written loop | Pattern 3's `walkAndRedact` function | Custom scrubber but proven minimal pattern — the hard part is JSON-string detection in breadcrumb bodies |
| UUID generation | `Math.random()` UUID | `crypto.randomUUID()` | Native browser API; UUID v4; available in all ES2022 targets |
| Test environment DOM | Custom JSDOM setup | `environment: 'jsdom'` in Vitest config | Vitest configures it automatically with the `test.environment` option |
| E2E server management | Custom `server.js` | Playwright `webServer` config | Config-driven; handles port, reuse, timeout, ready signal |
| Import path resolution for `@/*` in ESLint | Manual alias config | `eslint-import-resolver-typescript` | Reads from `tsconfig.app.json` automatically |

---

## Common Pitfalls

### Pitfall 1: ESLint flat-config `eslint-plugin-react-hooks` not supporting v7 flat-config

**What goes wrong:** `eslint-plugin-react-hooks@7.1.1` is the first version with proper flat-config support. Earlier versions required a compatibility shim. If the wrong version is installed, `rules.recommended` may not export a flat-compatible shape.
**Why it happens:** The react-hooks plugin was maintained by Meta and had slower adoption of flat-config syntax vs. community plugins.
**How to avoid:** Pin `eslint-plugin-react-hooks@7.1.1` (current latest). Verify `reactHooksPlugin.configs.recommended` is an array or flat-config object, not a legacy-format object.
**Warning signs:** ESLint throws `TypeError: cannot read properties of undefined (reading 'recommended')` when loading the config.

### Pitfall 2: PostHog `opt_out_capturing()` doesn't prevent identify()

**What goes wrong:** Calling `ph.opt_out_capturing()` in the `loaded` callback suppresses `capture()` events but `identify()` may still fire a `$identify` event to PostHog's servers.
**Why it happens:** PostHog's opt-out is event-capture scoped, not network-call scoped, in some versions.
**How to avoid:** Call `opt_out_capturing()` BEFORE `identify()` in the `loaded` callback, or conditionally skip `identify()` when not enabled:
```typescript
loaded: (ph) => {
  if (!enabled) {
    ph.opt_out_capturing();
    return;  // skip identify entirely in production
  }
  const distinctId = getOrCreateDistinctId();
  ph.identify(distinctId);
},
```
**Warning signs:** PostHog dashboard shows `$identify` events from production builds before Phase 7 flag flip.

### Pitfall 3: Sentry `beforeSend` modifying the event in-place vs. returning

**What goes wrong:** `beforeSend` receives the event by reference. Mutating it and returning `undefined` instead of the modified event drops the event entirely (Sentry interprets `return undefined` as `return null` = drop).
**Why it happens:** The signature requires returning the (possibly modified) event: `(event) => ErrorEvent | null`. Returning `undefined` silently drops the event.
**How to avoid:** Always `return event` at the end of `beforeSend`. The Pattern 3 scrubber mutates in-place and returns — this is correct. [CITED: Context7 /getsentry/sentry-javascript beforeSend signature]
**Warning signs:** Sentry shows no events even after throwing a test error.

### Pitfall 4: Vitest `globals: true` requires tsconfig reference

**What goes wrong:** Setting `test.globals: true` in Vitest adds `describe`, `it`, `expect` as globals. TypeScript will complain about undefined globals unless `@types/vitest` is referenced in tsconfig.
**Why it happens:** Vitest's global types live in `@types/vitest` or in a `/// <reference types="vitest/globals" />` triple-slash directive.
**How to avoid:** Add to `tsconfig.app.json` types array OR add `/// <reference types="vitest/globals" />` in `src/test-setup.ts`.
**Warning signs:** `tsc -b --noEmit` fails with `Cannot find name 'describe'`.

### Pitfall 5: WMHMDA / FTC HBNR — Production Analytics Dormant Until Phase 7

**What goes wrong:** The `VITE_ANALYTICS_ENABLED=true` flag gets set in the production Vercel/Cloudflare environment before Phase 7's legal counsel sign-off. Even a single `tab_viewed` event from a real user in Washington state with health data starts a WMHMDA compliance clock.
**Why it happens:** Founders set the flag to "test it in prod" before understanding the regulatory bar.
**How to avoid:** The flag defaults to `false` in all production deployments. Phase 7 explicitly flips it after legal review. The `.env.example` should include a comment: `# PRODUCTION: leave false until Phase 7 legal sign-off`.
**Warning signs:** PostHog dashboard shows events from non-dev IP addresses before Phase 7.

### Pitfall 6: React 19 StrictMode double-invoke breaks Playwright test expectations

**What goes wrong:** RTL tests in Vitest with React 19 `<StrictMode>` double-invoke effects. Effects that call `toast()` or other side-effects fire twice. Playwright tests avoid this (no StrictMode in production), but RTL tests must account for it.
**Why it happens:** React 19 StrictMode double-mounts components in development to detect side-effect bugs. This is intentional but can cause `expect(toastMock).toHaveBeenCalledTimes(1)` to fail with `2`.
**How to avoid:** RTL tests should not render inside `<StrictMode>`. Or use `act()` around effect-triggering code. The `OnboardingFlow` test renders the component directly without wrapping in `StrictMode`.
**Warning signs:** Intermittent test failures where call count is 2 instead of 1, or toasts fire twice.

---

## Code Examples

### Sentry Test Error Trigger (D-12)

```typescript
// Inside SettingsPage.tsx — within the existing section structure
// Rendered behind import.meta.env.DEV

{import.meta.env.DEV && (
  <div className="mt-6 border-t border-[var(--color-border)] pt-5">
    <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-3">
      Dev Tools
    </h3>
    <Button
      variant="destructive"
      size="sm"
      onClick={() => {
        throw new Error('phase-1-sentry-smoke');
      }}
    >
      Throw test error → Sentry
    </Button>
  </div>
)}
```

The `throw` must be outside any `try/catch` and outside any React error boundary to reach Sentry's global `window.onerror` handler. Placing it in a synchronous `onClick` handler (not inside a `Promise` or `async` function) is correct.

### migrateFromV3 Fixture Test Matrix (D-05)

```typescript
// src/lib/storage.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('migrateFromV3', () => {
  let storageMock: Record<string, string>;

  beforeEach(() => {
    storageMock = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => storageMock[k] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { storageMock[k] = v; });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k) => { delete storageMock[k]; });
  });

  afterEach(() => vi.restoreAllMocks());

  it('v3 only → migrates to v4', () => { /* ... */ });
  it('v4 only → unchanged, no migration', () => { /* ... */ });
  it('v3 + v4 → v4 wins, v3 removed', () => { /* ... */ });
  it('corrupted v3 → no crash, no data loss from v4', () => { /* ... */ });
});
```

### Playwright Onboarding Smoke (D-06)

```typescript
// e2e/onboarding.spec.ts
import { test, expect } from '@playwright/test';

test('onboarding happy path reaches dashboard', async ({ page }) => {
  await page.goto('/');

  // Marketing page → start onboarding
  await page.getByRole('button', { name: /get started/i }).click();

  // Step 1: Name
  await page.getByLabel(/your name/i).fill('Alex');
  await page.getByRole('button', { name: /next/i }).click();

  // Steps 2-7: fill required fields, click Next each time
  // (exact selectors depend on OnboardingFlow — use accessible labels)
  // ...

  // Dashboard loads — HomeTab renders
  await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeVisible();
});
```

**Playwright locator strategy (D-06):** Use `getByRole` and `getByLabel` — these are resilient to CSS/layout changes and test accessibility at the same time. Never use CSS selectors like `.onboarding-step-2` which break on rename. [CITED: playwright.dev/docs/locators]

---

## Walking Skeleton (SKELETON.md content)

Since this is Phase 1 of a new project, the walking skeleton defines the minimal end-to-end flow that proves the engineering rails work. The "user" here is the founder/engineer.

### Verifiable Gates

| # | Gate | Verification Step |
|---|------|-------------------|
| S-01 | Clone fresh, install | `git clone && npm i` exits 0 |
| S-02 | Types pass | `npm run typecheck` exits 0 on unmodified v2 codebase |
| S-03 | Lint passes | `npm run lint` exits 0 after D-01 fixes applied |
| S-04 | Format passes | `npm run format:check` exits 0 |
| S-05 | Unit tests pass | `npm run test:unit` exits 0 (all 4 test suites green) |
| S-06 | E2E smoke passes locally | `npm run test:e2e` exits 0 (Chromium, onboarding completes) |
| S-07 | Push trivial PR | GitHub Actions: all 5 jobs green, merge not blocked |
| S-08 | Sentry receives error | In dev: open Settings → Dev Tools → click "Throw test error → Sentry" → Sentry dashboard shows `phase-1-sentry-smoke` within 60s with `symptom`/`mood`/`note`/`aiHistory` absent from event payload |
| S-09 | PostHog receives events | In dev (VITE_ANALYTICS_ENABLED=true): open app, switch tabs, open PostHog → `tab_viewed` events appear, `distinct_id` matches localStorage UUID, no health-content fields |
| S-10 | Production build passes | `npm run build` exits 0 with empty `VITE_SENTRY_DSN`, `VITE_ANALYTICS_ENABLED=false` |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.eslintrc.cjs` legacy config | `eslint.config.js` flat-config | ESLint v9 (April 2024), default in v10 | All plugins must support flat-config; v7+ of react-hooks required |
| `eslint-plugin-import` | `eslint-plugin-import-x` | 2024 — import-x forked for ESLint v9+ | Active maintenance; flat-config native |
| Separate `vitest.config.ts` | `test` block in `vite.config.ts` | Vitest 1+ | Single config file; alias resolution automatic |
| Playwright `page.click('button.submit')` | `page.getByRole('button', { name: /submit/i })` | Playwright 1.27+ | Locator API; resilient, accessible |
| `@sentry/browser` | `@sentry/react` | Sentry SDK v7+ | React-specific error boundary + component stack |
| PostHog `distinct_id` from cookie | `persistence: 'localStorage'` + manual UUID | PostHog JS v1.100+ | Cookie-free; meets WMHMDA "no third-party tracking" |

**Deprecated/outdated:**
- `eslint-plugin-import` (not `import-x`): still works but no flat-config support and in maintenance mode.
- `@sentry/tracing` package: merged into `@sentry/react` SDK in v7; don't install separately.
- `@testing-library/react-hooks`: merged into `@testing-library/react` in v13; not needed.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `eslint-plugin-react-hooks@7.1.1` exports flat-config compatible shape | ESLint config pattern | Would need a compatibility shim (`@eslint/eslintrc`) adding config complexity |
| A2 | `posthog.opt_out_capturing()` prevents `$identify` network calls | PostHog init pattern | Could send identify events to PostHog in production before Phase 7 |
| A3 | `crypto.randomUUID()` available in all dev + CI environments (ES2022 target) | analytics.ts UUID generation | Private-mode fallback path handles it; worst case: ephemeral UUID per session |
| A4 | LeanShot package.json does NOT have `"type": "module"` (affects eslint.config.js extension) | ESLint flat-config | If `"type": "module"` is set, `eslint.config.js` is fine as-is; if absent, might need `.mjs` or CJS wrapper |

---

## Open Questions

1. **Does `package.json` have `"type": "module"`?**
   - What we know: STACK.md and CLAUDE.md don't mention it; Vite configs typically don't require it.
   - What's unclear: `eslint.config.js` in CJS mode requires `module.exports = [...]` syntax; in ESM mode uses `export default [...]`.
   - Recommendation: Check `package.json` at implementation time. If no `"type": "module"`, use `eslint.config.mjs` (forces ESM) or use CJS syntax in `eslint.config.js`.

2. **Does `Workout.type` have a union type defined in `src/types/index.ts`?**
   - What we know: `ActivityTab.tsx:27` uses `'resistance' as const` — the type is `'resistance' | 'cardio' | 'hybrid' | 'walk' | 'yoga'`.
   - What's unclear: Whether this union is explicitly exported from `src/types/index.ts` as `WorkoutType` or embedded in the `Workout` interface.
   - Recommendation: If not exported, extract as `export type WorkoutType = Workout['type']` in types/index.ts.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All dev/CI | ✓ | 22.18.0 | — |
| npm | Package installs | ✓ | 10.9.3 | — |
| Git / GitHub | CI pipeline | ✓ | — | — |
| Chromium (Playwright) | test:e2e | Installed by `npx playwright install chromium` | — | — |
| Sentry account + DSN | PROD-02 | Not verified — requires founder to create project | — | Local dev works without DSN (Sentry init is no-op when DSN absent) |
| PostHog account + key | PROD-03 | Not verified — requires founder to create project | — | Local dev works with placeholder key (opt_out_capturing silences it) |
| GitHub Actions (repo) | CI | Not verified — requires repo to be on GitHub | — | Any CI runner with same yml structure works (GitLab, etc.) |

**Missing dependencies with no fallback:**
- Sentry DSN and PostHog key must be created before Success Criteria 1 and 2 can be verified.
- GitHub repository required for GitHub Actions CI (Success Criterion 3).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 + @playwright/test 1.59.1 |
| Config file | `vite.config.ts` (Vitest `test` block) + `playwright.config.ts` |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test:unit && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PROD-02 | Sentry captures uncaught error from Settings trigger | Manual verify | N/A (Sentry dashboard) | ❌ Wave 0: `e2e/` dir |
| PROD-02 | `beforeSend` redacts symptom/mood/note/aiHistory from event payload | Unit | `npm run test:unit -- sentry` | ❌ Wave 0: `src/lib/sentry.test.ts` |
| PROD-03 | `track()` helper fires with correct EventName type | Unit | `npm run test:unit -- analytics` | ❌ Wave 0: `src/lib/analytics.test.ts` |
| PROD-03 | PostHog receives `tab_viewed` in dev (manual verify) | Manual verify | N/A (PostHog dashboard) | — |
| PROD-04 | `helpers.ts` pure functions | Unit | `npm run test:unit` | ❌ Wave 0: `src/lib/helpers.test.ts` |
| PROD-04 | `useStreaks.calc()` four predicates | Unit | `npm run test:unit` | ❌ Wave 0: `src/hooks/useStreaks.test.ts` |
| PROD-04 | `migrateFromV3` four-way fixture matrix | Unit | `npm run test:unit` | ❌ Wave 0: `src/lib/storage.test.ts` |
| PROD-04 | `OnboardingFlow` RTL happy-path | Integration | `npm run test:unit` | ❌ Wave 0: `src/components/onboarding/OnboardingFlow.test.tsx` |
| PROD-04 | Onboarding Playwright smoke | E2E | `npm run test:e2e` | ❌ Wave 0: `e2e/onboarding.spec.ts` |
| PROD-05 | `npm run lint` exits 0 on codebase after D-01 fixes | CI gate | `npm run lint` | ❌ Wave 0: `eslint.config.js` |
| PROD-05 | `npm run format:check` exits 0 | CI gate | `npm run format:check` | ❌ Wave 0: `.prettierrc` |
| PROD-05 | `npm run typecheck` exits 0 | CI gate | `npm run typecheck` | Already works: `tsc -b --noEmit` |
| PROD-05 | All 5 CI jobs green on PR | CI gate | `.github/workflows/ci.yml` | ❌ Wave 0: `.github/workflows/ci.yml` |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm run lint` (fast gates, ~10s)
- **Per wave merge:** `npm run test:unit && npm run test:e2e` (full suite, ~60-90s)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps (all must be created before implementation begins)

- [ ] `eslint.config.js` — ESLint flat-config
- [ ] `.prettierrc` — Prettier config
- [ ] `vite.config.ts` — add `test` block
- [ ] `src/test-setup.ts` — `@testing-library/jest-dom` import
- [ ] `playwright.config.ts` — Playwright config
- [ ] `.github/workflows/ci.yml` — CI pipeline
- [ ] `.env.example` — env var template
- [ ] `src/lib/helpers.test.ts` — covers PROD-04
- [ ] `src/hooks/useStreaks.test.ts` — covers PROD-04
- [ ] `src/lib/storage.test.ts` — covers PROD-04 (migrateFromV3)
- [ ] `src/components/onboarding/OnboardingFlow.test.tsx` — covers PROD-04
- [ ] `src/lib/sentry.ts` — beforeSend module
- [ ] `src/lib/analytics.ts` — typed track() helper
- [ ] `e2e/onboarding.spec.ts` — Playwright smoke

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 1 is pre-auth |
| V3 Session Management | No | Phase 1 is pre-auth |
| V4 Access Control | No | Phase 1 is pre-auth |
| V5 Input Validation | Partial | No user input goes to server in Phase 1; Sentry `beforeSend` is the validation boundary |
| V6 Cryptography | Partial | `crypto.randomUUID()` for distinct_id; no key storage in Phase 1 |
| V7 Error Handling | Yes | Sentry `beforeSend` must not leak PII in error payloads |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Sentry event leaks PII (symptom, mood, note, aiHistory) | Information Disclosure | `beforeSend` recursive key-value scrubber (D-09, D-10) |
| PostHog fires in production before Phase 7 compliance sign-off | Privacy violation (WMHMDA) | `opt_out_capturing()` in `loaded` callback when `VITE_ANALYTICS_ENABLED !== 'true'`; default `false` in all production builds |
| PostHog `autocapture` captures health-content DOM text | Information Disclosure | `autocapture: false` + `capture_pageview: false` in posthog.init |
| Sentry DSN exposed in compiled JS bundle | Information Disclosure | Acceptable — Sentry DSNs are designed to be public (they only accept, not read). Rate-limited by Sentry per-project. |
| `VITE_ANALYTICS_ENABLED=true` accidentally set in prod | Privacy violation | `.env.example` comment warning; `false` default in Phase 2 deploy config |

---

## Sources

### Primary (HIGH confidence)

- `npm view @sentry/react version` → 10.52.0 (verified 2026-05-10)
- `npm view @sentry/vite-plugin version` → 5.2.1 (verified 2026-05-10)
- `npm view posthog-js version` → 1.372.10 (verified 2026-05-10)
- `npm view vitest version` → 4.1.5 (verified 2026-05-10)
- `npm view @testing-library/react version` → 16.3.2 (verified 2026-05-10)
- `npm view @playwright/test version` → 1.59.1 (verified 2026-05-10)
- `npm view eslint version` → 10.3.0 (verified 2026-05-10)
- `npm view typescript-eslint version` → 8.59.2 (verified 2026-05-10)
- `npm view prettier version` → 3.8.3 (verified 2026-05-10)
- `npm view eslint-plugin-react-hooks version` → 7.1.1 (verified 2026-05-10)
- `npm view eslint-plugin-jsx-a11y version` → 6.10.2 (verified 2026-05-10)
- Context7 `/getsentry/sentry-javascript` — `beforeSend` signature, ErrorEvent type, React init pattern
- Context7 `/posthog/posthog-js` — `persistence` options, `identify`, `opt_out_capturing`
- [PostHog persistence docs](https://posthog.com/docs/libraries/js/persistence) — `localStorage` vs `cookieless_mode` behavior
- [PostHog cookieless tracking tutorial](https://posthog.com/tutorials/cookieless-tracking) — `cookieless_mode: 'always'` limitations
- [Playwright CI docs](https://playwright.dev/docs/ci) — browser caching guidance, worker count recommendation
- [typescript-eslint Getting Started](https://typescript-eslint.io/getting-started/) — flat-config structure
- Codebase reads: `src/components/dashboard/charts/BaseChart.tsx`, `src/components/layout/Topbar.tsx`, `src/components/dashboard/tabs/ActivityTab.tsx`, `src/components/dashboard/tabs/BodyTab.tsx`, `src/components/dashboard/tabs/HomeTab.tsx`, `src/lib/insights.ts`, `src/types/index.ts`, `src/lib/helpers.ts`, `src/hooks/useStreaks.ts`, `src/components/ui/Modal.tsx`, `src/main.tsx`, `vite.config.ts`

### Secondary (MEDIUM confidence)

- [PostHog cookieless tracking GitHub issue #2277](https://github.com/PostHog/posthog-js/issues/2277) — `cookieless_mode` added post-1.261.6
- [eslint-plugin-react-hooks flat-config GitHub issue](https://github.com/facebook/react/issues/28313) — timeline of flat-config support landing in v7

### Tertiary (LOW confidence)

- None — all claims in this research were verified or cited.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified via npm registry 2026-05-10
- Architecture: HIGH — patterns derived from official docs + codebase source reads
- Pitfalls: HIGH — derived from actual codebase analysis (file + line numbers) and official docs
- PostHog cookieless distinct_id lifecycle: MEDIUM — documented behavior but nuanced interaction between `opt_out_capturing` and `identify`

**Research date:** 2026-05-10
**Valid until:** 2026-06-10 (stable libraries; PostHog and ESLint ecosystem move fast — re-verify plugins if > 30 days)
