# Phase 2: Visible Compliance & Public Deploy — Pattern Map

**Mapped:** 2026-05-11
**Phase:** 02-visible-compliance-public-deploy
**Files mapped:** 8 entries
**Analogs found:** 7 / 8 (one explicit "no analog" — `vercel.json`)

---

## File Classification

| New/Modified file | Role | Data flow | Closest analog | Match quality |
|-------------------|------|-----------|----------------|---------------|
| `src/components/onboarding/DisclaimerStep.tsx` (Step 0) + `src/components/dashboard/DisclaimerModal.tsx` (dashboard fallback) | component (UI step + blocking modal) | render-only / event (acknowledge) | `src/components/ui/Modal.tsx` + `src/components/onboarding/OnboardingFlow.tsx` step blocks | exact (step shape) + exact (modal primitive) |
| `src/components/dashboard/charts/medLevelWatermarkPlugin.ts` (inline in `MedLevelChart.tsx` OR sibling file) | utility (Chart.js plugin) | canvas draw hook | `src/components/dashboard/charts/MedLevelChart.tsx` + `src/components/dashboard/charts/BaseChart.tsx` | role-match (no in-codebase plugin example yet) |
| `acknowledgedDisclaimer: 'v1' \| undefined` persisted field | model / persistence shape | persisted state | `src/lib/storage.ts` (`PersistedState`, `initialState`, `migrateFromV3`) + `src/lib/store.ts` `partialize` | exact |
| `vite.marketing.config.ts` (new sibling to `vite.config.ts`) | config | build-time | `vite.config.ts` | exact (sibling-clone) |
| `vercel.json` (new at repo root) | config | deploy-time | — | **no analog** (first Vercel/host config file in repo) |
| `.github/workflows/ci.yml` — new `compliance-copy` job + optional `lighthouse` job | config (CI) | event-driven (PR/push) | Phase 1's 5-job workflow at `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` | exact (extend pattern) |
| `src/components/onboarding/DisclaimerStep.test.tsx` + updated `OnboardingFlow.test.tsx` (7 → 8 steps) | test (component) | request-response (RTL) | `src/components/onboarding/OnboardingFlow.test.tsx` | exact |
| `e2e/onboarding.spec.ts` (7 → 8 steps), optional new `e2e/disclaimer.spec.ts` | test (e2e) | event-driven (browser) | `e2e/onboarding.spec.ts` | exact |
| `EventName` additions (`disclaimer_acknowledged`, `disclaimer_required`) + `analytics.test.ts` extension | utility (event taxonomy) | event-driven | `src/lib/analytics.ts` + `src/lib/analytics.test.ts` | exact |

---

## Pattern Assignments

### 1. Disclaimer modal component → `src/components/ui/Modal.tsx` + `src/components/onboarding/OnboardingFlow.tsx`

**Analogs (both apply):**

- **Modal primitive** — `src/components/ui/Modal.tsx`. Already wires `role="dialog"`, `aria-modal="true"`, `aria-label`, ESC-to-close (`useEffect` listening for `Escape`, lines 37–48), framer-motion `AnimatePresence` backdrop + scaled card entry (lines 51–76), and `body.style.overflow = 'hidden'` while open. The disclaimer modal must **reuse this component** and pass `hideClose` so the X icon disappears (line 17, line 87–91) and override the ESC behavior — since `useEffect` calls `onClose` unconditionally on Escape, the dashboard-fallback variant either (a) passes a no-op `onClose` so ESC closes nothing visible, or (b) the planner adds a `dismissible?: boolean` prop to `Modal.tsx`. The Step-0 variant inside OnboardingFlow does **not** need to render `<Modal>` at all — it lives inside the card chrome of OnboardingFlow like every other step.

- **Step-component shape inside OnboardingFlow** — `src/components/onboarding/OnboardingFlow.tsx` does **not** extract per-step components today; every step is a `{step === N && (<div className="space-y-4">…</div>)}` block inside the same JSX tree (lines 182–505). New Step 0 follows the exact same inline pattern: an `AnimatePresence motion.div` keyed on `step`, an illustration in the banner section (lines 161–168 are the registry — add `{step === 0 && <DisclaimerIllustration />}` or reuse `OnboardWelcome`), a heading using the same `text-[26px] font-bold tracking-tight` + italic-display accent class combo (lines 184–193), and the same footer button row at lines 509–541 (single primary "I understand" button at step 0 with no Back button — branch on `step === 0`). `TOTAL_STEPS` constant at line 59 flips from `7` to `8`; `useState(1)` initial step at line 65 flips to `0`; `setStep((s) => Math.max(1, s - 1))` back at line 102 becomes `Math.max(0, …)`; the validation chain at lines 96–98 stays untouched (step 0 has no input validation, just an acknowledgment side-effect that writes `acknowledgedDisclaimer: 'v1'` to the store before advancing).

- **Progress indicator** — `src/components/onboarding/ProgressIndicator.tsx` already accepts `{ step, total }` and computes `(step / total) * 100`. With `total = 8`, step 0 produces 0% which is the desired pre-acknowledge state. **No code change needed** beyond the `total={TOTAL_STEPS}` prop in OnboardingFlow line 173 picking up the new constant value. (Alternative: skip rendering the indicator entirely while `step === 0` so the disclaimer screen reads as "Step 0 of N" implicitly — planner picks.)

---

### 2. MedLevelChart watermark plugin → `src/components/dashboard/charts/MedLevelChart.tsx` + `src/components/dashboard/charts/BaseChart.tsx`

**Analogs:**

- **`BaseChart.tsx`** — calls `Chart.register(...registerables)` **globally at module scope** (line 12). This registers built-in controllers/scales/elements once for the whole app. Per D-15, the watermark plugin must **NOT** follow this global pattern — instead it must be passed in via the chart's `ChartConfiguration.plugins` array so it only attaches to the `MedLevelChart` instance. Chart.js supports this: a plugin object with an `id` and `afterDraw` hook passed in `config.plugins: [medLevelWatermarkPlugin]` is scoped to that one Chart instance.

- **`MedLevelChart.tsx`** currently builds its `ChartConfiguration` inside a `useMemo` (lines 14–85) and returns `<BaseChart config={config} … />` (line 87). It does **not** currently pass any plugins. The watermark plugin integration: extend the returned config object with `plugins: [medLevelWatermarkPlugin]` (a new key alongside `type`, `data`, `options`). The plugin file (`medLevelWatermarkPlugin.ts`) defines a single Chart.js plugin object: `{ id: 'med-level-watermark', afterDraw(chart) { const { ctx, chartArea } = chart; … }`}` — using the chart's existing 2D canvas context (no new canvas, no DOM overlay). Theme-aware colors must come from `getChartTokens(theme)` (already imported in `MedLevelChart.tsx` line 3) so the watermark opacity differs light/dark per D-13; pass the theme into the plugin via a closure or read it through the chart instance's stored config.

- **BaseChart effect lifecycle** — `BaseChart.tsx` lines 35–53 show two effects: one creates/destroys on theme change, the other updates `c.data` and `c.options` in-place on every config change. The watermark plugin is part of the config object, so a theme-driven recompute of the `plugins: […]` array in `MedLevelChart`'s `useMemo` (deps already include `theme`) will get picked up by the second effect's `c.options = config.options` reassignment. Note: Chart.js does **not** re-read `config.plugins` on `.update()` — plugins attach at construction. This means the chart will need a full re-mount when the watermark plugin reference changes, which the existing `key={theme}` remount pattern handles for theme changes; for plugin definition changes (planner unlikely to need), the planner should rely on the destroy-and-recreate effect at lines 35–44 (already triggered on theme change).

---

### 3. Persisted-state extension `acknowledgedDisclaimer` → `src/lib/storage.ts` + `src/lib/store.ts`

**Analogs:**

- **`src/lib/storage.ts`** — three insertion points:
  1. `PersistedState` interface (lines 31–50): add `acknowledgedDisclaimer: 'v1' | undefined;` (or `'v1' | null`, matching the `user: User | null` precedent at line 32). Planner picks `undefined` vs `null` — the rest of the file uses `null` for the only nullable field, so `null` is the more consistent shape; D-10 names `undefined` though, which still works since interfaces tolerate optional/undefined values.
  2. `initialState` constant (lines 52–71): add the field with the default value (`undefined` per D-10 — so any net-new install starts with the dashboard fallback re-triggering until acknowledged).
  3. `migrateFromV3()` (lines 77–109): add `acknowledgedDisclaimer: undefined` to the `merged` object (line 82–101), so v3-migrated users hit the dashboard fallback on first v4 boot.

- **`src/lib/store.ts`** — two insertion points:
  1. `partialize` block (lines 226–245): add `acknowledgedDisclaimer: state.acknowledgedDisclaimer,` so the flag persists to localStorage.
  2. Add a new action method to the `Actions` interface (lines 37–90) and its implementation in the `create<Store>` body (after line 110 `setUser`): `acknowledgeDisclaimer: (version: 'v1') => set({ acknowledgedDisclaimer: version })`. Follows the same flat-property action-method convention (`setUser`, `setTab`, etc.).

- **`migrate` callback** at `store.ts:246–253` already handles v3→v4. Phase 2 does **not** need a v4→v5 bump — `acknowledgedDisclaimer` simply lives at the existing v4 version, and the `undefined` default in `initialState` (spread on line 250: `{ ...initialState, ...v3 }`) ensures legacy v3 migrators and v4 users without the field both end up with the dashboard fallback firing. This is the cleanest path; bumping `STORAGE_VERSION` to 5 would be unnecessary cost.

- **Test pattern** — `src/lib/storage.test.ts` mocks `Storage.prototype` and asserts shape (lines 7–16, 26–36). New persistence assertion: a one-line `expect(initialState.acknowledgedDisclaimer).toBeUndefined()` in a new `describe('initialState')` block, plus an assertion inside the "migrates v3 payload" test (line 26) that `result?.acknowledgedDisclaimer === undefined`.

---

### 4. `vite.marketing.config.ts` → `vite.config.ts`

**Analog:** `vite.config.ts` (24 lines total, full content above).

**Pattern features to mirror:**

- Default export via `defineConfig({…})` from `vitest/config` (line 1). The marketing config can switch to `vite/config` since the marketing site doesn't need the Vitest test block — or stay on `vitest/config` for consistency. Planner picks; `vitest/config` re-exports `defineConfig` from Vite.
- Same `plugins: [react(), tailwindcss()]` (line 7) — marketing uses the same React + Tailwind v4 stack.
- Same `resolve.alias['@']` (lines 8–12) — but planner may scope the marketing entry to a subdirectory (`src/components/marketing/`) to keep its dep graph minimal. The alias should still resolve to `./src` so shared types/utils remain reachable.
- Add `build.outDir: 'dist-marketing'` (per D-04) and a separate input — either `build.rollupOptions.input: 'marketing.html'` if the planner adds a second HTML entry, or a different `root` directory. The base `vite.config.ts` does not configure `build` at all (line 13 jumps straight to `server`), so the marketing config is additive, not overriding.
- The base `vite.config.ts` does **not** yet declare `build.rollupOptions.output.manualChunks` or `build.sourcemap` — those land in `vite.config.ts` (SPA) during the bundle-split/Sentry plans, not in the marketing config.

---

### 5. `vercel.json` (repo root) → **NO IN-REPO ANALOG**

The codebase does not yet contain any host-config files (`netlify.toml`, `vercel.json`, `wrangler.toml`) — `.planning/codebase/INTEGRATIONS.md` confirms this and `02-CONTEXT.md` notes "Phase 2 creates the first `vercel.json`." The file lives at the **repository root** (`/Users/karstenhaldan/minisite/vercel.json`), not under `leanshot/`, so it sits next to the existing `.github/workflows/ci.yml` and is reachable by both the SPA and the marketing Vercel projects which share the same git repo per D-04.

**Planner reference path:** fetch Vercel docs via `mcp__context7__resolve-library-id` + `query-docs` for the canonical schema (`headers`, `routes`, `rewrites`, `redirects`, `cleanUrls`, `trailingSlash`, framework preset). The header set is fully specified in D-05 / D-06 — the planner does not need to invent the policy, only the JSON shape.

**Cross-pattern note:** since both Vercel projects share the same repo and the same `vercel.json`, the planner must decide whether headers are project-scoped (via per-project Project Settings in the Vercel dashboard, not in `vercel.json`) or path-scoped within a single file. The simpler path: a single `vercel.json` whose `headers` apply to all routes, supplemented by Vercel-dashboard project-level overrides for the marketing project to drop the strict CSP per D-06.

---

### 6. CI workflow additions → `/Users/karstenhaldan/minisite/.github/workflows/ci.yml`

**Analog:** the existing 5-job workflow at `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` (118 lines).

**Pattern features to mirror for the new `compliance-copy` job (and optional `lighthouse` job):**

- **Workflow header** — `name: CI`, `on: push: branches: [main]` + `pull_request: branches: [main]` (lines 1–7), `concurrency.cancel-in-progress: true` (lines 9–12), and the critical `defaults.run.working-directory: leanshot` block at lines 14–16. Every new job inherits the `leanshot/` working directory automatically — no per-job override needed.
- **Job structure** — each of the 5 existing jobs (lines 19–117) follows the same skeleton: `name: <Human-readable>`, `runs-on: ubuntu-latest`, `steps:` array starting with `actions/checkout@v4`, then `actions/setup-node@v4` with `node-version: '22'`, `cache: 'npm'`, `cache-dependency-path: leanshot/package-lock.json`, then `npm ci`, then one or more `npm run <script>` steps. The new `compliance-copy` job follows this exact skeleton, replacing the `npm run …` step with a `grep -rniE …` shell step matching the 4 SC#5 terms per D-16/D-17. Example of the grep idiom already in use: `test-e2e` job lines 99–104 (`if grep -r "…" dist/; then echo FAIL; exit 1; fi`).
- **Lighthouse job (if scoped)** — same skeleton, but the run step calls `npx @lhci/cli@latest autorun --collect.url=$VERCEL_PREVIEW_URL` after `npm ci`. The Vercel preview URL is sourced from `${{ secrets.VERCEL_TOKEN }}` + Vercel API or from a deployment-status webhook trigger (planner picks; D-25 allows fallback to manual verification).
- **Forward constraint already documented** — Phase 1's `01-06-SUMMARY.md` "Threat Flags" notes a `fork-pr-secret-exposure` flag: any future step that uses `${{ secrets.* }}` must guard with `if: github.event.pull_request.head.repo.full_name == github.repository`. The Sentry source-map upload step (if it ever lands in the GH Actions workflow rather than Vercel's build command per D-20) and any Lighthouse job that consumes a Vercel token must carry this guard.
- **Artifact upload pattern** — `test-e2e` job lines 111–117 upload `playwright-report/` on failure. If the Lighthouse job emits a report, mirror this exact pattern (`actions/upload-artifact@v4`, `if: failure()`, 7-day retention).

---

### 7. Component tests (Disclaimer .test.tsx + updated OnboardingFlow.test.tsx) → `src/components/onboarding/OnboardingFlow.test.tsx`

**Analog:** `src/components/onboarding/OnboardingFlow.test.tsx` (72 lines).

**Pattern features to mirror:**

- **Imports** (lines 1–5): `render`, `screen`, `waitFor` from `@testing-library/react`; `userEvent` default-import from `@testing-library/user-event`; `afterEach`, `beforeEach`, `describe`, `expect`, `it`, `vi` from `vitest`; store import via the `@/` path alias. New disclaimer test uses the same imports.
- **Store hydration / reset** (lines 8–11): each test resets the store via `useStore.setState({ user: null })` in `beforeEach`. The disclaimer test additionally resets `acknowledgedDisclaimer: undefined` (or the field's chosen default) so each test starts in the unacknowledged state.
- **No StrictMode wrapper** (line 23–25 + explicit code comment): RTL effects fire twice under StrictMode and break call-count assertions (RESEARCH.md Pitfall 6). New tests render the disclaimer directly: `render(<DisclaimerStep onAcknowledge={…} />)` with no `<StrictMode>` wrapper.
- **Selector strategy** — accessible locators only: `screen.findByLabelText`, `screen.getByRole('button', { name: /…/i })`, `screen.getByText`. Disclaimer test follows: `screen.getByRole('button', { name: /i understand/i })`, `screen.getByText(/not medical advice/i)`. ESLint's `jsx-a11y` plugin + the PATTERNS.md from Phase 1 reinforce this (no `getByTestId`, no CSS-class queries).
- **Step-navigation update** (lines 17–69) — the existing test walks steps 1 → 7. Phase 2 inserts a step-0 acknowledge click at the top of the user journey (around line 26, before the name input): `await user.click(screen.getByRole('button', { name: /i understand/i }))`. The test header comment changes from "completes the 7-step happy path" → "completes the 8-step happy path (Step 0 disclaimer + 1-7 onboarding)". The setUserSpy assertion at lines 62–69 stays identical.
- **Spy pattern** — `vi.spyOn(useStore.getState(), 'setUser')` (line 18). Disclaimer test optionally spies on the new `acknowledgeDisclaimer` action: `vi.spyOn(useStore.getState(), 'acknowledgeDisclaimer')` and asserts it was called with `'v1'`.

---

### 8. e2e tests (updated `e2e/onboarding.spec.ts` + optional new `e2e/disclaimer.spec.ts`) → `e2e/onboarding.spec.ts`

**Analog:** `e2e/onboarding.spec.ts` (68 lines) + `playwright.config.ts`.

**Pattern features to mirror:**

- **Test bootstrapping** — Playwright `webServer` config (`playwright.config.ts` lines 18–30) switches between `npm run preview` (port 4173, CI) and `npm run dev` (port 5173, local). The `baseURL` switches accordingly (lines 31–36). `process.env.CI` is the discriminator. Phase 2's tests inherit this with no change.
- **Page navigation pattern** — `page.goto('/')` lands on marketing; the nav "Get started" button is clicked via `page.getByRole('button', { name: /get started/i }).first()` to disambiguate from the hero CTA (line 9 + inline comment). Phase 2's updates start identically.
- **Step assertions** — every step uses heading assertions first (`await expect(page.getByRole('heading', { name: /<step name>/i })).toBeVisible()`), then form interaction via `page.getByLabel(<accessible-name>)` and `page.getByRole('button', { name: /continue/i }).click()`. Phase 2 prepends a step-0 section before the existing step-1 block (lines 11–16): assert the disclaimer heading is visible, then `page.getByRole('button', { name: /i understand/i }).click()` to advance. Comment-banner divider style — `// ── Step 0: Disclaimer ───…────────` — matches the existing banner format at lines 11, 18, 27, etc.
- **Selector philosophy** — only accessible locators (`getByRole`, `getByLabel`, `getByText`), never `getByTestId` or CSS classes (matches Phase 1 PATTERNS.md). The "GreetingStrip uses `getByText` because the greeting renders in a `<p>` not an `<h1>`" deviation at lines 65–67 + comment is the documented exception.
- **Header-test pattern (optional new `e2e/disclaimer.spec.ts`)** — if the planner adds a dedicated spec for the dashboard-render fallback (D-11), it follows the same structure: seed `localStorage` via `page.addInitScript(() => { localStorage.setItem('leanshot_v4', JSON.stringify({…})); })` with a `user` object but no `acknowledgedDisclaimer`, then assert the modal appears over the dashboard before any tab content is interactable. The codebase has no `addInitScript` example yet — this would be a net-new helper but follows Playwright docs idiomatically.

---

### 9. Analytics events (`disclaimer_acknowledged`, `disclaimer_required`) → `src/lib/analytics.ts` + `src/lib/analytics.test.ts`

**Analog:** `src/lib/analytics.ts` (85 lines) + `src/lib/analytics.test.ts` (76 lines).

**Pattern features to mirror:**

- **`EventName` union extension** — `analytics.ts:14–19` defines the typed event taxonomy as a TS union literal. Phase 1 wired 5 events (`onboarding_started`, `onboarding_step_completed`, `onboarding_completed`, `onboarding_abandoned`, `tab_viewed`). Phase 2 (optional, planner picks per CONTEXT.md "may add"): extend the union by appending `| 'disclaimer_acknowledged' | 'disclaimer_required'`. No other code in `analytics.ts` changes — `track()` (lines 78–84) is generic over `EventName` and silently no-ops when `VITE_ANALYTICS_ENABLED !== 'true'` (D-13), so the new events are dormant in production until Phase 7 flips the flag.

- **Call sites** — Phase 1 fires `track('onboarding_started')` from `OnboardingFlow.tsx:90` inside a `useEffect(() => track(…), [])`, fires `track('onboarding_step_completed', { step })` inside the `next()` handler at line 99, and fires `track('onboarding_completed', { totalSteps: TOTAL_STEPS })` from `complete()` at line 142. New disclaimer-acknowledge call site mirrors this: fire `track('disclaimer_acknowledged', { version: 'v1' })` in the step-0 "I understand" click handler (right before `setStep((s) => s + 1)`). The dashboard-fallback site (`App.tsx`) fires `track('disclaimer_required', { surface: 'dashboard' })` once on first render when `acknowledgedDisclaimer !== 'v1'`.

- **Test extension** — `analytics.test.ts:5–15` is a single compile-time assertion that the EventName union contains exactly 5 starter events. With new events added the test becomes: assign 7 variables of type `EventName`, assert `expect([…]).toHaveLength(7)` (or split the assertion into "Phase 1 starter set" + "Phase 2 additions" describe blocks). The pattern uses **declared-but-unused** typed locals (`const e1: EventName = 'onboarding_started'`) — same idiom for the new events.

- **No PostHog SDK call needed** — `posthog.capture` (line 83) is generic over the event name string; nothing else in the SDK setup (`initAnalytics` lines 47–75) needs to know about the new events. The taxonomy union is the single source of truth.

---

## Shared Patterns Applied Across Multiple New Files

### Path alias `@/*`
Source: `tsconfig.app.json` `"paths": { "@/*": ["./src/*"] }` + `vite.config.ts:9–11` `resolve.alias['@']`. All new TS/TSX files import via `@/components/…`, `@/lib/…`, `@/hooks/…`, `@/types`. Already used by every existing file under `src/`.

### Strict TS + React 19 + `react-jsx`
No `import React from 'react'` needed at the top of new TSX files (already absent from `Modal.tsx`, `OnboardingFlow.tsx`, etc.). All new files use `strict` TS rules — no `any`, named `interface` for object shapes (`ButtonProps`, `User`), `type` for unions (`Units`, `EventName`).

### Modal a11y bundle
`role="dialog"` + `aria-modal="true"` + `aria-label` (Modal.tsx:60–62) — every modal/sheet in the codebase already uses this triple. The disclaimer modal reuses Modal.tsx so this is automatic.

### `import.meta.env.VITE_*` reads
Pattern: `analytics.ts:43–45` (`isEnabled()`), `analytics.ts:49–51` (`key`/`host`). New Sentry source-map config and any Vercel-env-driven UI gate follow the same idiom. The pattern is always: read once, default to a safe falsy state.

### Co-located test files
`Foo.tsx` + `Foo.test.tsx` in the same directory; `Bar.ts` + `Bar.test.ts` likewise (`storage.ts`/`storage.test.ts`, `analytics.ts`/`analytics.test.ts`, `helpers.ts`/`helpers.test.ts`, `OnboardingFlow.tsx`/`OnboardingFlow.test.tsx`). New disclaimer modal file gets its `.test.tsx` co-located. E2e specs live separately in `/e2e/`.

### Try/catch around `localStorage`
`storage.ts:78` (migrateFromV3), `storage.ts:111–132` (apiKeyStorage), `store.ts:113–117` (resetAll), `analytics.ts:31–39` (getOrCreateDistinctId). Any new localStorage write/read in Phase 2 wraps with `try { … } catch { /* noop */ }` — private-mode browsers must not crash the app.

---

## No Analog Found

| File | Role | Reason | Planner action |
|------|------|--------|----------------|
| `vercel.json` | host config | First Vercel/host config file in the repo (confirmed by `INTEGRATIONS.md`). | Fetch Vercel docs (`headers`, `redirects`, `rewrites`, `cleanUrls`, framework preset) via Context7 MCP; security-header payload is fully specified in D-05/D-06. |
| `medLevelWatermarkPlugin.ts` (Chart.js plugin) | utility (canvas draw hook) | No Chart.js plugin has been authored in the codebase yet — `BaseChart.tsx` only calls `Chart.register(...registerables)` globally. | Reference Chart.js plugin docs (`afterDraw` hook + canvas 2D API + `Plugin<'line'>` types). Scope to MedLevelChart only via `config.plugins: [plugin]` (per-instance), NOT `Chart.register()` (global). |

---

## Metadata

**Analog search scope:**
- `src/components/onboarding/` (4 files: OnboardingFlow.tsx + OnboardingFlow.test.tsx + ProgressIndicator.tsx + UnitToggle.tsx)
- `src/components/ui/` (14 primitives — Modal.tsx is the load-bearing one)
- `src/components/dashboard/charts/` (3 files — BaseChart.tsx + MedLevelChart.tsx + SimpleCharts.tsx)
- `src/lib/` (storage.ts, store.ts, analytics.ts + their `.test.ts` siblings)
- `vite.config.ts`, `playwright.config.ts`
- `e2e/onboarding.spec.ts`
- `/Users/karstenhaldan/minisite/.github/workflows/ci.yml`

**Files inspected:** 13 source files + 4 test files + 2 build configs + 1 CI workflow = 20 files total.

**Pattern extraction date:** 2026-05-11.
