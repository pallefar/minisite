<!-- refreshed: 2026-05-10 -->
# Architecture

**Analysis Date:** 2026-05-10

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Browser DOM (`#root`)                     │
│                       index.html                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Bootstrap                                                   │
│  `src/main.tsx` — applies theme, hydrates Zustand,           │
│  then mounts `<App />` inside `<StrictMode>`                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  View Router (state-driven, no URL routing)                  │
│  `src/App.tsx` — view = 'marketing' | 'onboarding' |         │
│                          'dashboard' (derived from `user`)   │
└──────┬──────────────────┬──────────────────────┬────────────┘
       │                  │                      │
       ▼                  ▼                      ▼
┌───────────────┐  ┌───────────────────┐  ┌──────────────────┐
│  Marketing    │  │  Onboarding       │  │  AppShell        │
│  Landing.tsx  │  │  OnboardingFlow   │  │  layout/* + tabs │
└───────────────┘  └─────────┬─────────┘  └────────┬─────────┘
                             │                     │
                             ▼                     ▼
                    ┌─────────────────────────────────────────┐
                    │  Zustand store (`src/lib/store.ts`)      │
                    │  Single source of truth                  │
                    │  • PersistedState (domain data)          │
                    │  • UIState (currentTab, toast)           │
                    │  • Actions (setters/mutators)            │
                    └─────────────────┬───────────────────────┘
                                      │
                            ┌─────────┴──────────┐
                            ▼                    ▼
                 ┌────────────────────┐  ┌────────────────────┐
                 │ localStorage       │  │ Anthropic Messages │
                 │ `leanshot_v4`      │  │ API (browser-direct)│
                 │ `leanshot_v3`      │  │ via `lib/ai.ts`     │
                 │ (legacy migrated)  │  │                     │
                 └────────────────────┘  └────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Bootstrap | Apply pre-paint theme, sync-hydrate persisted state, render root | `src/main.tsx` |
| App router | Decide which top-level view to render based on `user` presence; manage modal/panel open state | `src/App.tsx` |
| AppShell | Sidebar + topbar + main pane + mobile bottom nav + FAB + global Toast | `src/components/layout/AppShell.tsx` |
| Sidebar | Desktop tab navigation + theme toggle + AI/settings entry points | `src/components/layout/Sidebar.tsx` |
| MobileNav | iOS-style bottom navigation for tab switching | `src/components/layout/MobileNav.tsx` |
| Topbar | Quick-action header (log dose, open report, open AI) | `src/components/layout/Topbar.tsx` |
| GreetingStrip | Per-tab personalised header on the Home tab | `src/components/layout/GreetingStrip.tsx` |
| Tab views | One module per tab; render a 12-col bento grid of cards/charts | `src/components/dashboard/tabs/*.tsx` |
| Cards | Self-contained dashboard widgets reading from the store | `src/components/dashboard/cards/*.tsx` |
| Charts | Chart.js wrappers (med-level, weight, etc.) | `src/components/dashboard/charts/*.tsx` |
| AI panel | Slide-in conversational coach | `src/components/dashboard/ai/AIChatPanel.tsx` |
| Modals | Overlay surfaces (Doctor report, Photo compare) | `src/components/dashboard/modals/*.tsx` |
| Settings | Drawer for profile, goals, AI key, data export/reset | `src/components/dashboard/settings/SettingsPage.tsx` |
| Onboarding | Multi-step user-creation flow | `src/components/onboarding/OnboardingFlow.tsx` |
| Marketing | Pre-onboarding landing page | `src/components/marketing/Landing.tsx` |
| Tour | First-run guided overlay (DOM-anchored coachmarks) | `src/components/dashboard/tour/GuidedTour.tsx` |
| Store | Zustand instance + persist middleware + selectors | `src/lib/store.ts` |
| Persistence | Storage keys, initial state, v3→v4 migration, API-key helper | `src/lib/storage.ts` |
| AI client | Anthropic Messages API wrapper with `MissingAPIKeyError` | `src/lib/ai.ts` |
| Domain logic | Pure pharmacology (`pharmacology.ts`), insights rules (`insights.ts`), constants (`constants.ts`) | `src/lib/*.ts` |
| Hooks | Theme, streaks, count-up, reduced-motion, toast | `src/hooks/*.ts` |
| Types | Shared domain interfaces | `src/types/index.ts` |
| UI primitives | Button, Card, Modal, Sheet, Input, Toast, etc. | `src/components/ui/*.tsx` |
| Illustrations | Inline SVG components (HeroOrbital, AIAvatar, EmptyState art) | `src/illustrations/*.tsx` |

## Pattern Overview

**Overall:** Client-only Single-Page Application (SPA) with state-driven view selection, no URL routing.

**Key Characteristics:**
- **One global Zustand store** is the single source of truth for both domain data and ephemeral UI state (current tab, transient toast). No Context, no Redux, no React Query.
- **No router.** The visible "page" (`marketing` / `onboarding` / `dashboard`) is derived from `useStore((s) => s.user)`. Within the dashboard, the active tab is `currentTab` in the store. Modals/panels (AI, Settings, Doctor Report, Tour) are local `useState` flags inside `App.tsx`.
- **Synchronous hydration** before first render: `main.tsx` calls `await hydrate()` so the chosen view matches persisted state on the very first paint (no marketing-page flash for returning users).
- **Lazy-loaded route-equivalents.** Every tab module, the marketing page, the onboarding flow, the AI panel, the settings drawer, the doctor report, and the guided tour are code-split via `React.lazy(() => import(...))` in `src/App.tsx` and rendered inside `<Suspense>` boundaries.
- **Pure-function domain logic** lives in `src/lib/`. Components are thin: they pull state via store selectors, call lib functions for derived values, and render. There is no class hierarchy.
- **Theme is pre-applied imperatively.** `applyThemeToDOM()` from `src/hooks/useTheme.ts` sets `data-theme` on `<html>` before React mounts; CSS variables in `src/index.css` provide the design tokens.
- **All dates are stored as ISO strings or `YYYY-MM-DD`** in the persisted state. Never as `Date` objects (would break JSON.stringify round-trip).

## Layers

**Bootstrap layer:**
- Purpose: Get a hydrated, themed React tree on screen.
- Location: `src/main.tsx`
- Contains: Theme pre-application, `hydrate()` invocation, `createRoot` + render.
- Depends on: `src/lib/store.ts`, `src/hooks/useTheme.ts`, `src/types/index.ts`, `src/index.css`.

**App-shell / view-router layer:**
- Purpose: Pick the top-level surface and host modal state.
- Location: `src/App.tsx`, `src/components/layout/`
- Contains: View selection (marketing / onboarding / dashboard), Suspense boundaries, global modal/panel toggles, tour replay event listener.
- Depends on: store selectors, lazy-loaded feature modules.
- Used by: `src/main.tsx`.

**Feature layer (tabs / flows / overlays):**
- Purpose: Self-contained user-facing surfaces.
- Location: `src/components/dashboard/tabs/`, `src/components/dashboard/cards/`, `src/components/dashboard/charts/`, `src/components/dashboard/modals/`, `src/components/dashboard/ai/`, `src/components/dashboard/settings/`, `src/components/dashboard/share/`, `src/components/dashboard/tour/`, `src/components/onboarding/`, `src/components/marketing/`
- Contains: Domain-aware composition of UI primitives, store reads, and lib calls.
- Depends on: UI primitives, store, hooks, lib.

**UI primitive layer:**
- Purpose: Design-system building blocks shared by every feature.
- Location: `src/components/ui/`
- Contains: `Button`, `Card`, `Modal`, `Sheet`, `Input`, `Toast`, `Badge`, `Pill`, `ProgressRing`, `Skeleton`, `Sparkline`, `SwipeToDelete`, `EmptyState`.
- Depends on: `src/lib/helpers.ts` (`cn` utility) and CSS tokens in `src/index.css`. Toast also reads/writes the store. Otherwise these primitives are domain-free.

**State layer:**
- Purpose: Persisted domain data + ephemeral UI flags + actions.
- Location: `src/lib/store.ts`, `src/lib/storage.ts`
- Contains: Zustand `create` call with `persist` middleware, partialize, version migration from `leanshot_v3`, manual `hydrate()` helper.
- Used by: every feature/card via `useStore` selectors.

**Domain / utility layer:**
- Purpose: Pure functions and data tables.
- Location: `src/lib/`
- Contains:
  - `pharmacology.ts` — half-lives, titration tables, `calcMedLevel(time, halfLife, injections)`, `medLabel`/`medLabelShort`.
  - `insights.ts` — `generateInsights(state)` and `pickFocus(state)` rule engines.
  - `constants.ts` — `SUPPS_DEFAULT`, `SYMPTOMS_LIST`, `TAB_TITLES`, `SITES`, `siteShort`.
  - `helpers.ts` — date formatting (`todayStr`, `formatShort`, `lastNDays`), `cn`, `clamp`, `pct`, `greeting`, `relTime`, `formatDuration`.
  - `motion.ts` — easings + durations + framer-motion variants (`cardRise`, `stagger`).
  - `chart-theme.ts` — `getChartTokens(theme)` reads live CSS variables for Chart.js.
  - `ai.ts` — `callAnthropic`, `MissingAPIKeyError`.
  - `share-card/` — Canvas renderers + three templates.
- Depends on: `src/types/`, `src/lib/storage.ts` (for `apiKeyStorage` only).

**Hook layer:**
- Purpose: Reusable React behavior; mostly thin wrappers around the store or browser APIs.
- Location: `src/hooks/`
- Contains: `useTheme` (with the `applyThemeToDOM` side-effect), `useStreaks` (selects + memoises), `useToast` (action shorthand), `useReducedMotion`, `useCountUp`.

**Type layer:**
- Purpose: Shared TypeScript domain types.
- Location: `src/types/index.ts`
- Contains: `User`, `Injection`, `WeightLog`, `Meal`, `Workout`, `Vial`, `Cost`, `MoodLog`, `SleepLog`, `Photo`, `AIMessage`, `TabId`, `Theme`, plus enums (`MedicationId`, `Sex`, `GoalType`, `ActivityLevel`, `LiftingLevel`, `InjectionSite`, `DoseUnit`, `Units`).

## Data Flow

### Primary request path — "Log an injection"

1. User taps the FAB / Quick-Log tile / Topbar "Log dose" → `setTab('medication')` is called from `src/components/dashboard/QuickLogSheet.tsx` or `src/components/dashboard/cards/QuickLogCard.tsx`.
2. `App.tsx:97` re-renders the `<TabSwitcher>` with `currentTab === 'medication'` and lazy-loads `MedicationTab` (`src/components/dashboard/tabs/MedicationTab.tsx`).
3. User fills the injection form and submits; the tab calls `useStore.getState().addInjection(injection)` (`src/lib/store.ts:119`).
4. The `addInjection` action prepends to `injections` and decrements the first non-empty vial's `dosesUsed`.
5. Zustand `persist` middleware writes the new state to `localStorage['leanshot_v4']` synchronously.
6. Subscribers re-render: `HeroCard`, `GLPCurveCard`, `MedLevelChart`, `EffectivenessCard`, etc., all of which select from the store.
7. `useToast()` (`src/hooks/useToast.ts`) is invoked; the `Toast` component (`src/components/ui/Toast.tsx`) reads the new `toast` slice and animates in.

### AI coach flow

1. User opens the AI panel; `App.tsx` flips local `aiOpen` state and lazy-loads `AIChatPanel`.
2. `AIChatPanel` reads `user`, `aiHistory`, `weights`, `symptoms` from the store and builds a per-message `system` prompt enriched with user context (`src/components/dashboard/ai/AIChatPanel.tsx:43`).
3. On submit, `appendAI({ role: 'user', content })` writes to the store.
4. `callAnthropic({ system, messages })` (`src/lib/ai.ts:40`) reads the API key from `apiKeyStorage.get()`, throws `MissingAPIKeyError` if absent, otherwise POSTs to `https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-dangerous-direct-browser-access: true`.
5. Response text is appended via `appendAI({ role: 'assistant', ... })`. A naive keyword check (`detectDataRef`) flags the reply as personalised and the bubble shows a "Personalized" badge.
6. Errors fork on `MissingAPIKeyError` vs network failure; each path appends a friendly assistant message instead of crashing.

### Theme flow

1. `src/main.tsx:11` reads `localStorage['leanshot_theme_v4']` (or `prefers-color-scheme`) and calls `applyThemeToDOM(initialTheme)` before mounting React. This sets `<html data-theme="...">`.
2. Components consume `useTheme()` (`src/hooks/useTheme.ts`) when they need to react (e.g. Chart.js wrappers re-mount via `key={theme}` so they recompute colors).
3. Toggling theme writes the new value to `localStorage` and updates `<html data-theme>`.

### Onboarding → dashboard transition

1. `App.tsx` mounts `<Onboarding>` while `view === 'onboarding'`.
2. `OnboardingFlow` collects the draft, calls `setUser(...)` and `upsertWeight(...)` on the store.
3. The `useEffect` at `App.tsx:42` observes `user` becoming truthy and switches `view` to `'dashboard'`.
4. A second `useEffect` (`App.tsx:48`) checks `shouldShowTour()` and auto-launches the guided tour ~900 ms later for first-time visitors.

**State Management:**
- **Where state lives:** A single Zustand store (`src/lib/store.ts`) with `persist` middleware. `partialize` excludes `currentTab` and `toast` so transient UI never hits localStorage.
- **How components read it:** `useStore((s) => s.someSlice)` selectors. Never `useStore(s => s)` — that would re-render on every change.
- **How components write it:** Pull the action via a selector (`const addInjection = useStore((s) => s.addInjection)`) and call it. Or, for one-shot writes (e.g. inside an event handler that doesn't render), `useStore.getState().addInjection(...)` (used in `useToast`).
- **Hydration timing:** Synchronous before first render via `await hydrate()` in `main.tsx`. v3→v4 migration is attempted both in `hydrate()` and in `persist`'s `migrate` callback.

## Key Abstractions

**`PersistedState`:**
- Purpose: The serialisable domain shape — everything the user owns.
- Defined: `src/lib/storage.ts:31` (interface), `src/lib/storage.ts:52` (`initialState`).
- Pattern: One flat object indexed by entity (`injections`, `weights`, `meals`, etc.) plus `Record<dateString, value>` maps for daily counters (`water`, `foodNoise`, `steps`, `supplements`).

**`Store` (= `PersistedState & UIState & Actions`):**
- Purpose: The full Zustand state shape including ephemeral UI and action signatures.
- Defined: `src/lib/store.ts:91`.

**Card:**
- Purpose: Bento-grid widget primitive used for the entire dashboard.
- Defined: `src/components/ui/Card.tsx`.
- Pattern: `<Card span={4|6|7|8|12}>` mapped to a 12-col `lg:` grid via `spanClasses`. Variants: `default | elevated | interactive | hero | flat`. Header convention: `<CardHeader title icon action />`.

**Tab content module:**
- Purpose: One file per visible tab; rendered inside `<TabSwitcher>` in `App.tsx`.
- Examples: `src/components/dashboard/tabs/HomeTab.tsx`, `MedicationTab.tsx`, `BodyTab.tsx`, etc.
- Pattern: Each tab pulls slices from the store, composes cards, and embeds a logging form (often inside a `<Modal>` or inline).

**`BaseChart`:**
- Purpose: Theme-aware Chart.js wrapper.
- Defined: `src/components/dashboard/charts/BaseChart.tsx`.
- Pattern: Charts pass a `ChartConfiguration`; the wrapper destroys+recreates on theme change and updates `chart.data` in-place on data change. Callers should set `key={theme}` on parents that need a hard remount.

**`Insight` and `pickFocus`:**
- Purpose: Pure rule engine for dashboard "today's focus" + "smart insights".
- Defined: `src/lib/insights.ts`. Consumes a `PersistedState` snapshot, returns plain data; the UI maps each result to a card.

## Entry Points

**HTML entry point:**
- Location: `index.html`
- Triggers: Browser load.
- Responsibilities: Pre-load Inter/Fraunces/JetBrains Mono web fonts, set theme color metas, render `<div id="root">`, load `/src/main.tsx` as an ES module.

**JS entry point:**
- Location: `src/main.tsx`
- Triggers: Vite resolves the `<script type="module">` from `index.html`.
- Responsibilities: Read saved theme → apply pre-mount; `await hydrate()` → mount `<StrictMode><App /></StrictMode>` into `#root`.

**Top-level component:**
- Location: `src/App.tsx`
- Triggers: Mounted by `main.tsx`.
- Responsibilities: Pick view (marketing/onboarding/dashboard) from store, host modal-open state, wire global `leanshot:replay-tour` event, render `<AppShell>` + the active tab + lazy overlay components.

## Architectural Constraints

- **Threading:** Single-threaded browser main thread; no Web Workers, no Service Worker. Long ops (Anthropic calls, Chart.js re-render) run in-band.
- **Global state:** A single Zustand store module (`src/lib/store.ts`). Module-level `let toastId = 0` counter for unique toast IDs. `apiKeyStorage` (`src/lib/storage.ts:111`) is a singleton localStorage wrapper. Theme key `leanshot_theme_v4` and store keys `leanshot_v4`/`leanshot_v3` are constants, not configurable.
- **Persistence:** `localStorage` only — no IndexedDB, no remote backend. Photos live as inline data URLs in state, which means the persisted blob can grow large.
- **Routing:** Intentionally none. Browser back/forward and deep-linking to a tab are not supported. All navigation is `setTab(...)` against the store. Adding a router would require migrating tab state out of Zustand.
- **No SSR / no SSG.** Vite SPA only. `window`, `document`, and `localStorage` are accessed eagerly in `main.tsx`.
- **Direct browser → Anthropic:** Requires the `anthropic-dangerous-direct-browser-access: true` header and the user supplying their own API key. There is no proxy server; the key sits in `localStorage['leanshot_anthropic_key']`.
- **Strict TypeScript:** `tsconfig.app.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`. The build (`npm run build`) runs `tsc -b && vite build`.
- **Path alias:** `@/*` → `./src/*` is configured in both `vite.config.ts` and `tsconfig.app.json`. Always import via `@/...` to stay relocatable.

## Anti-Patterns

### Reading the entire store

**What happens:** A component does `const state = useStore((s) => s)` (or omits the selector entirely).
**Why it's wrong:** It re-renders on every store change anywhere in the app — defeating the partial-subscription model that keeps this app fast despite a single global store.
**Do this instead:** Subscribe to the smallest slice you need, one selector per slice. See `src/components/dashboard/cards/EffectivenessCard.tsx:9-13` for the canonical pattern.

### Importing tabs eagerly

**What happens:** A new feature `import { FooTab } from '@/components/dashboard/tabs/FooTab'` at the top of `App.tsx`.
**Why it's wrong:** It defeats the code-splitting strategy that keeps the initial bundle small. Marketing visitors should never download dashboard JS.
**Do this instead:** Use `lazy(() => import('@/components/dashboard/tabs/FooTab').then((m) => ({ default: m.FooTab })))` exactly like the existing tabs in `src/App.tsx:9-25`.

### Storing dates as `Date` objects

**What happens:** Persisting `new Date()` directly into the Zustand store.
**Why it's wrong:** Persist serialises with `JSON.stringify`, so `Date` round-trips into a string. Code that later does `myDate.getTime()` will throw.
**Do this instead:** Store `new Date().toISOString()` (for timestamps) or `'YYYY-MM-DD'` slices (for dates). See `Injection.datetime` and `WeightLog.date` in `src/types/index.ts`.

### Bypassing the AI client

**What happens:** A new feature calls `fetch('https://api.anthropic.com/...')` directly.
**Why it's wrong:** It will silently 401 in production (no auth header), it skips the `MissingAPIKeyError` branch the UI relies on, and it duplicates the dangerous-direct-browser-access header.
**Do this instead:** Always go through `callAnthropic(...)` from `src/lib/ai.ts`. Catch `MissingAPIKeyError` to show the "add your key" prompt.

### Hard-coding colors in components

**What happens:** A component uses `bg-[#1B4842]` or `text-white` instead of a CSS variable.
**Why it's wrong:** Breaks dark mode and any future theme. The whole design system is variable-driven via `src/index.css`.
**Do this instead:** Use `bg-[var(--color-primary)]`, `text-[var(--color-text)]`, etc. For Chart.js, read tokens via `getChartTokens(theme)` in `src/lib/chart-theme.ts`.

### Skipping `applyThemeToDOM` on first paint

**What happens:** A new bootstrap step renders before the theme is applied.
**Why it's wrong:** Causes a flash of light theme for dark-mode users. The current `main.tsx` deliberately runs `applyThemeToDOM` synchronously *before* `await hydrate()`.
**Do this instead:** Keep theme application as the very first synchronous step in `src/main.tsx`. Anything heavier should run after the React tree mounts.

## Error Handling

**Strategy:** Catch at the boundary that knows how to present the failure. The store is treated as cannot-fail (everything is in-memory + localStorage); only network and parsing call-sites use try/catch.

**Patterns:**
- **Typed errors for known recoverable cases.** `MissingAPIKeyError` (`src/lib/ai.ts:13`) lets `AIChatPanel` distinguish "user must add key" from "network failed".
- **Defensive JSON parsing.** `migrateFromV3` (`src/lib/storage.ts:77`) wraps `JSON.parse` in try/catch and falls back to `null`. Each field uses `?? defaultValue` so a malformed v3 blob still produces a valid v4 state.
- **Silent localStorage failures.** Every `localStorage` read/write is wrapped (`try { ... } catch { /* noop */ }`) so private-mode browsers do not crash the app. Examples: `src/main.tsx:13`, `src/hooks/useTheme.ts:7`, `src/lib/storage.ts:113`.
- **No global error boundary.** A bug in a tab will currently bubble to React's default behavior. (Tracked as a follow-up — not yet implemented.)
- **Chart.js teardown.** `BaseChart` always destroys its Chart instance in effect cleanup so StrictMode double-mounts and theme re-mounts do not leak.

## Cross-Cutting Concerns

**Logging:** `console.error` for unexpected failures (`src/lib/storage.ts:106`, `src/lib/store.ts:279`). No structured logger, no remote sink.

**Validation:** Form-side, ad-hoc — each tab parses string inputs with `Number(x) || fallback` (e.g. `src/components/dashboard/settings/SettingsPage.tsx:38`). No central validator.

**Authentication:** None for the app itself (single-user, local-only). The Anthropic API key is treated as an opaque secret stored in `localStorage['leanshot_anthropic_key']` via `apiKeyStorage` (`src/lib/storage.ts:111`).

**Animations:** Centralised vocabulary in `src/lib/motion.ts` (`easing`, `duration`, `cardRise`, `stagger`). All large animations gate on `useReducedMotion()`. CSS keyframes (`animate-rise`, `animate-fade-in`) are defined in `src/index.css` and disabled when the user prefers reduced motion.

**Theming:** CSS custom properties on `<html data-theme="...">`. JS code reads live values via `getChartTokens(theme)` (`src/lib/chart-theme.ts`). Components reference tokens with arbitrary-value Tailwind classes (`bg-[var(--color-surface)]`).

**A11y:** ARIA labels on every icon-only button, `role="dialog"` + `aria-modal="true"` on overlay panels, `aria-live="polite"` on the toast, focus-visible rings consistently styled via `focus-visible:ring-[var(--color-primary)]`.

---

*Architecture analysis: 2026-05-10*
