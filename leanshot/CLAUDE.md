<!-- GSD:project-start source:PROJECT.md -->
## Project

**LeanShot**

LeanShot is a web app that lets people on GLP-1s (and adjacent peptides) track everything that affects their treatment — injections, body metrics, food, activity, mood, symptoms — and turns it into a unified picture they share with their doctor and a coach (rule-based + AI) shares with them. v1 serves three audiences: GLP-1 patients (B2C), doctors viewing a specific patient's data (read-share), and clinics/coaches monitoring multiple patients (B2B).

**Core Value:** **Drug-level projection + injection-site rotation** are the headline. The pharmacology curve (28 days past + 7 days projected) and site-rotation tracking are the centerpiece — every other tab feeds context into that picture or interprets it for the user. If the curve is wrong or the rotation logic confuses users, the product fails regardless of what else works.

### Constraints

- **Tech stack**: React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. Locked for v1 — net-new backend should pick a stack that complements (e.g., a small Node/TS or edge-runtime backend) rather than fighting it.
- **Architecture**: Local-first must continue to work even after cloud sync is added. Users without an account, or offline, must still be able to log and view their data. This rules out a pure cloud-first rewrite.
- **Compliance posture**: Not yet a HIPAA covered entity. Avoid features that would push us into that bucket prematurely (e.g., direct EHR integration). Keep the disclaimer + data minimization stance from day one.
- **AI dependency**: AI coach calls Anthropic directly. Outage on Anthropic = degraded coach UX, not full-app outage — keep the rest of the app functional even when AI is unavailable.
- **Bundle size**: chart.js + framer-motion + lucide-react together are heavy. A static SPA on a real domain has to load fast for a non-technical audience — code-split aggressively (App.tsx already lazy-loads tabs/modals; preserve that).
- **Performance / accessibility**: Audience includes patients with chronic conditions. Keyboard navigation, screen-reader labels, color contrast, and reduced-motion behavior must work end-to-end.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript ~5.6.3 — All source under `src/` (`.ts`, `.tsx`). Strict mode enabled (`tsconfig.app.json:14`)
- TSX/JSX (`react-jsx` transform) — All UI components (e.g. `src/App.tsx`, `src/components/**/*.tsx`)
- CSS — Single global stylesheet `src/index.css` (Tailwind v4 `@theme` + custom properties)
- HTML — Single entry point `index.html` mounting `/src/main.tsx`
## Runtime
- Browser-only SPA. No backend, no SSR, no Node.js runtime in production.
- Target: `ES2022` with `DOM`, `DOM.Iterable` libs (`tsconfig.app.json:3-5`)
- Module system: `ESNext` with `bundler` resolution (`tsconfig.app.json:6-8`)
- Node.js — installed `v22.18.0` locally; no `.nvmrc` or `engines` pin in `package.json`
- TypeScript types for Node provided by `@types/node ^25.6.2` (devDependency, used by `vite.config.ts`)
- npm (lockfile `package-lock.json`, `lockfileVersion: 3`)
- Lockfile: present at `package-lock.json`
## Frameworks
- React `^19.0.0` — `src/main.tsx` uses `createRoot` from `react-dom/client`, `<StrictMode>` enabled
- React DOM `^19.0.0` — `src/main.tsx:2`
- Tailwind CSS `^4.0.0-beta.7` — Loaded via `@import "tailwindcss"` at top of `src/index.css:1`
- `@tailwindcss/vite` `^4.0.0-beta.7` — Vite plugin registered in `vite.config.ts:7`. v4 uses CSS-first `@theme {}` config (no `tailwind.config.js`)
- framer-motion `^11.11.17` — Used for sheets, modals, navigation, marketing transitions (e.g. `src/components/ui/Sheet.tsx:2`, `src/components/ui/Modal.tsx:3`, `src/components/layout/Sidebar.tsx:9`)
- @use-gesture/react `^10.3.1` — Drag/swipe handling in `src/components/ui/SwipeToDelete.tsx:2`
- zustand `^5.0.1` with `persist` + `createJSONStorage` middleware — Single store at `src/lib/store.ts`
- chart.js `^4.4.6` — Single thin wrapper at `src/components/dashboard/charts/BaseChart.tsx` registers `...registerables`
- lucide-react `^0.460.0` — Icon set used across all UI components (e.g. `src/components/layout/Topbar.tsx:2`)
- None configured. No `vitest.config.*`, `jest.config.*`, `playwright.config.*`, or `*.test.*`/`*.spec.*` files exist in the repo.
- Vite `^6.0.1` — Dev server on port `5173` with `host: true` (`vite.config.ts:13`)
- @vitejs/plugin-react `^4.3.4` — Registered in `vite.config.ts:7`
- TypeScript `~5.6.3` — Project references in `tsconfig.json` split app and node configs
## Key Dependencies
- react `^19.0.0` / react-dom `^19.0.0` — Core rendering
- zustand `^5.0.1` — Single source of truth for all user data (also drives persistence)
- chart.js `^4.4.6` — Time-series charts (med-level curves, weight, symptoms)
- framer-motion `^11.11.17` — All transitions and gestures-as-animation
- lucide-react `^0.460.0` — Every icon in the app
- @tailwindcss/vite `^4.0.0-beta.7` + tailwindcss `^4.0.0-beta.7` — Pre-release v4 styling pipeline
- @vitejs/plugin-react `^4.3.4` — JSX/HMR for Vite
- @types/react `^19.0.0`, @types/react-dom `^19.0.0`, @types/node `^25.6.2` — Type-only
## Configuration
- `.gitignore` lists `.env` and `.env.local` (line 5–6 of `.gitignore`). No `.env*` files exist on disk in the repo.
- No `import.meta.env.VITE_*` references found anywhere in `src/` — the app does not read any build-time env vars.
- The single secret used by the app (Anthropic API key) is supplied per-user at runtime through Settings UI and stored under `localStorage` key `leanshot_anthropic_key` (`src/lib/storage.ts:29`, `apiKeyStorage` helper at `src/lib/storage.ts:111`).
- `tsconfig.json` — Root project-references file; references `tsconfig.app.json` and `tsconfig.node.json`
- `tsconfig.app.json` — App config: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`, `react-jsx`, path alias `@/* → ./src/*`
- `tsconfig.node.json` — Build-tool config covering only `vite.config.ts`, includes `types: ["node"]`
- `vite.config.ts` — Plugins: `react()`, `tailwindcss()`. Resolve alias `@` → `./src`. Dev server `port: 5173`, `host: true` (LAN-accessible).
- `index.html` — Default theme attr `data-theme="light"` on `<html>`. Theme-color metas for light (`#EFEBE0`) and dark (`#0B1413`). Apple PWA-style meta tags (`apple-mobile-web-app-capable`). Mounts `/src/main.tsx` into `#root`.
- No ESLint config (`.eslintrc*`, `eslint.config.*`), no Prettier config (`.prettierrc*`), no Biome config. Code style enforced only by `tsc --strict`.
## Platform Requirements
- Node.js capable of running Vite 6 + TS 5.6 (Node ≥18; current dev machine on `v22.18.0`)
- npm (lockfile is npm-format, `lockfileVersion: 3`)
- Run scripts (`package.json:6-11`):
- Static SPA — output of `vite build` (no Vite-emitted server). Any static host (Netlify/Vercel/S3/Cloudflare Pages/etc.) works.
- Browser requirements: ES2022, `localStorage`, `fetch`, optional `navigator.clipboard` + `ClipboardItem` (graceful fallback in `src/components/dashboard/share/ShareCardModal.tsx:67`), `FileReader`, `Blob`, `URL.createObjectURL`, `<canvas>` 2D context, `window.matchMedia`, `window.print()`.
- The Anthropic browser call relies on the `anthropic-dangerous-direct-browser-access: true` header and CORS support from the Anthropic API.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## TypeScript Configuration
- `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"` — modern browser-only output, no Node.js back-compat
- `jsx: "react-jsx"` — automatic JSX runtime, no `import React from 'react'` needed
- `allowImportingTsExtensions: true` paired with `noEmit: true` — TypeScript only typechecks; Vite handles the build
- `isolatedModules: true` and `moduleDetection: "force"` — every file must be a module
- `useDefineForClassFields: true` — modern class semantics
## Linting & Formatting
## Import Patterns
- `tsconfig.app.json` — `"paths": { "@/*": ["./src/*"] }`
- `vite.config.ts:9-11` — `resolve.alias['@'] = fileURLToPath(...)`
- All cross-directory imports in `src/`
## Component Patterns
## Hooks
## Tailwind Class Organization
## Naming Conventions
- **Components (`.tsx`):** `PascalCase.tsx` matching the primary export — `Button.tsx`, `HeroCard.tsx`, `OnboardingFlow.tsx`. One primary component per file (with co-located subcomponents allowed).
- **Hooks (`.ts`):** `camelCase` starting with `use` — `useToast.ts`, `useStreaks.ts`, `useReducedMotion.ts`.
- **Lib/utility (`.ts`):** `kebab-case` or single-word lowercase — `helpers.ts`, `insights.ts`, `chart-theme.ts`, `share-card/template-bold.ts`.
- **Types:** `src/types/index.ts` is a single barrel exporting every domain type.
- **Functions:** `camelCase` — `pickFocus`, `generateInsights`, `calcMedLevel`, `migrateFromV3`.
- **React components:** `PascalCase` — `HeroCard`, `FocusCard`, `TitrationTrack`.
- **Hooks:** `useX` (camelCase, `use` prefix) — required by React's rules-of-hooks.
- **Type aliases / interfaces:** `PascalCase` — `User`, `Injection`, `ButtonProps`. Both `interface` and `type` are used: **`interface`** for object shapes (props, domain entities), **`type`** for unions/aliases (`Units`, `TabId`, `BadgeTone`).
- **Constants (module-level):** `SCREAMING_SNAKE_CASE` for true constants — `STORAGE_KEY`, `STORAGE_VERSION`, `TOTAL_STEPS`, `KEYWORDS_FOR_DATA_REF`, `SUPPS_DEFAULT`, `SYMPTOMS_LIST`, `TITRATION`, `HALF_LIVES`, `DEFAULT_MODEL`, `ICON_MAP`.
- **Local variables:** `camelCase` — descriptive names, sometimes terse single-letters in tight scopes (`u` for user, `s` for state inside a `useStore` selector, `m` for meal in `.map()`).
## Error Handling
## Logging
## Comments & Documentation
## Function Design
## Module / Export Design
## State Management
- **Persisted domain data** is partialized via `partialize` (`store.ts:231-250`) — only data, not UI flags.
- **Ephemeral UI state** (`currentTab`, `toast`) lives in the same store but isn't persisted.
- **Action methods are flat properties on the store** — no slices. Examples: `addInjection`, `removeInjection`, `upsertWeight`, `bulkSetSteps`. Naming follows verb-noun.
- **Synchronous hydration before first render** (`src/main.tsx:25-32`) avoids the marketing-page flash for already-onboarded users.
- **Components subscribe with one selector per primitive** to minimize re-renders (covered above under Hooks).
## Accessibility Conventions
- **`aria-label` is required on icon-only buttons** (typed in `IconButtonProps`, `Button.tsx:80-81`).
- **`role="dialog"` + `aria-modal="true"`** on every modal/sheet (`Modal.tsx:60-62`, `Sheet.tsx:45-47`).
- **`role="status"` + `aria-live="polite"`** on toasts (`Toast.tsx:22-23`).
- **`aria-pressed`** on toggle pills (`Pill.tsx:14`); **`aria-busy`** on loading buttons (`Button.tsx:51`); **`aria-invalid`** on errored inputs (`Input.tsx:87`).
- **`aria-hidden`** on decorative icons and visual ornaments (`Button.tsx:62`, `HeroCard.tsx:127, 192`, `Skeleton.tsx:10`).
- **`prefers-reduced-motion`** is respected via the `useReducedMotion()` hook (`src/hooks/useReducedMotion.ts`) — every animated component checks it before running RAF loops or large transitions. CSS-level reduced-motion is also enforced via `index.css`.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
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
- **One global Zustand store** is the single source of truth for both domain data and ephemeral UI state (current tab, transient toast). No Context, no Redux, no React Query.
- **No router.** The visible "page" (`marketing` / `onboarding` / `dashboard`) is derived from `useStore((s) => s.user)`. Within the dashboard, the active tab is `currentTab` in the store. Modals/panels (AI, Settings, Doctor Report, Tour) are local `useState` flags inside `App.tsx`.
- **Synchronous hydration** before first render: `main.tsx` calls `await hydrate()` so the chosen view matches persisted state on the very first paint (no marketing-page flash for returning users).
- **Lazy-loaded route-equivalents.** Every tab module, the marketing page, the onboarding flow, the AI panel, the settings drawer, the doctor report, and the guided tour are code-split via `React.lazy(() => import(...))` in `src/App.tsx` and rendered inside `<Suspense>` boundaries.
- **Pure-function domain logic** lives in `src/lib/`. Components are thin: they pull state via store selectors, call lib functions for derived values, and render. There is no class hierarchy.
- **Theme is pre-applied imperatively.** `applyThemeToDOM()` from `src/hooks/useTheme.ts` sets `data-theme` on `<html>` before React mounts; CSS variables in `src/index.css` provide the design tokens.
- **All dates are stored as ISO strings or `YYYY-MM-DD`** in the persisted state. Never as `Date` objects (would break JSON.stringify round-trip).
## Layers
- Purpose: Get a hydrated, themed React tree on screen.
- Location: `src/main.tsx`
- Contains: Theme pre-application, `hydrate()` invocation, `createRoot` + render.
- Depends on: `src/lib/store.ts`, `src/hooks/useTheme.ts`, `src/types/index.ts`, `src/index.css`.
- Purpose: Pick the top-level surface and host modal state.
- Location: `src/App.tsx`, `src/components/layout/`
- Contains: View selection (marketing / onboarding / dashboard), Suspense boundaries, global modal/panel toggles, tour replay event listener.
- Depends on: store selectors, lazy-loaded feature modules.
- Used by: `src/main.tsx`.
- Purpose: Self-contained user-facing surfaces.
- Location: `src/components/dashboard/tabs/`, `src/components/dashboard/cards/`, `src/components/dashboard/charts/`, `src/components/dashboard/modals/`, `src/components/dashboard/ai/`, `src/components/dashboard/settings/`, `src/components/dashboard/share/`, `src/components/dashboard/tour/`, `src/components/onboarding/`, `src/components/marketing/`
- Contains: Domain-aware composition of UI primitives, store reads, and lib calls.
- Depends on: UI primitives, store, hooks, lib.
- Purpose: Design-system building blocks shared by every feature.
- Location: `src/components/ui/`
- Contains: `Button`, `Card`, `Modal`, `Sheet`, `Input`, `Toast`, `Badge`, `Pill`, `ProgressRing`, `Skeleton`, `Sparkline`, `SwipeToDelete`, `EmptyState`.
- Depends on: `src/lib/helpers.ts` (`cn` utility) and CSS tokens in `src/index.css`. Toast also reads/writes the store. Otherwise these primitives are domain-free.
- Purpose: Persisted domain data + ephemeral UI flags + actions.
- Location: `src/lib/store.ts`, `src/lib/storage.ts`
- Contains: Zustand `create` call with `persist` middleware, partialize, version migration from `leanshot_v3`, manual `hydrate()` helper.
- Used by: every feature/card via `useStore` selectors.
- Purpose: Pure functions and data tables.
- Location: `src/lib/`
- Contains:
- Depends on: `src/types/`, `src/lib/storage.ts` (for `apiKeyStorage` only).
- Purpose: Reusable React behavior; mostly thin wrappers around the store or browser APIs.
- Location: `src/hooks/`
- Contains: `useTheme` (with the `applyThemeToDOM` side-effect), `useStreaks` (selects + memoises), `useToast` (action shorthand), `useReducedMotion`, `useCountUp`.
- Purpose: Shared TypeScript domain types.
- Location: `src/types/index.ts`
- Contains: `User`, `Injection`, `WeightLog`, `Meal`, `Workout`, `Vial`, `Cost`, `MoodLog`, `SleepLog`, `Photo`, `AIMessage`, `TabId`, `Theme`, plus enums (`MedicationId`, `Sex`, `GoalType`, `ActivityLevel`, `LiftingLevel`, `InjectionSite`, `DoseUnit`, `Units`).
## Data Flow
### Primary request path — "Log an injection"
### AI coach flow
### Theme flow
### Onboarding → dashboard transition
- **Where state lives:** A single Zustand store (`src/lib/store.ts`) with `persist` middleware. `partialize` excludes `currentTab` and `toast` so transient UI never hits localStorage.
- **How components read it:** `useStore((s) => s.someSlice)` selectors. Never `useStore(s => s)` — that would re-render on every change.
- **How components write it:** Pull the action via a selector (`const addInjection = useStore((s) => s.addInjection)`) and call it. Or, for one-shot writes (e.g. inside an event handler that doesn't render), `useStore.getState().addInjection(...)` (used in `useToast`).
- **Hydration timing:** Synchronous before first render via `await hydrate()` in `main.tsx`. v3→v4 migration is attempted both in `hydrate()` and in `persist`'s `migrate` callback.
## Key Abstractions
- Purpose: The serialisable domain shape — everything the user owns.
- Defined: `src/lib/storage.ts:31` (interface), `src/lib/storage.ts:52` (`initialState`).
- Pattern: One flat object indexed by entity (`injections`, `weights`, `meals`, etc.) plus `Record<dateString, value>` maps for daily counters (`water`, `foodNoise`, `steps`, `supplements`).
- Purpose: The full Zustand state shape including ephemeral UI and action signatures.
- Defined: `src/lib/store.ts:91`.
- Purpose: Bento-grid widget primitive used for the entire dashboard.
- Defined: `src/components/ui/Card.tsx`.
- Pattern: `<Card span={4|6|7|8|12}>` mapped to a 12-col `lg:` grid via `spanClasses`. Variants: `default | elevated | interactive | hero | flat`. Header convention: `<CardHeader title icon action />`.
- Purpose: One file per visible tab; rendered inside `<TabSwitcher>` in `App.tsx`.
- Examples: `src/components/dashboard/tabs/HomeTab.tsx`, `MedicationTab.tsx`, `BodyTab.tsx`, etc.
- Pattern: Each tab pulls slices from the store, composes cards, and embeds a logging form (often inside a `<Modal>` or inline).
- Purpose: Theme-aware Chart.js wrapper.
- Defined: `src/components/dashboard/charts/BaseChart.tsx`.
- Pattern: Charts pass a `ChartConfiguration`; the wrapper destroys+recreates on theme change and updates `chart.data` in-place on data change. Callers should set `key={theme}` on parents that need a hard remount.
- Purpose: Pure rule engine for dashboard "today's focus" + "smart insights".
- Defined: `src/lib/insights.ts`. Consumes a `PersistedState` snapshot, returns plain data; the UI maps each result to a card.
## Entry Points
- Location: `index.html`
- Triggers: Browser load.
- Responsibilities: Pre-load Inter/Fraunces/JetBrains Mono web fonts, set theme color metas, render `<div id="root">`, load `/src/main.tsx` as an ES module.
- Location: `src/main.tsx`
- Triggers: Vite resolves the `<script type="module">` from `index.html`.
- Responsibilities: Read saved theme → apply pre-mount; `await hydrate()` → mount `<StrictMode><App /></StrictMode>` into `#root`.
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
### Importing tabs eagerly
### Storing dates as `Date` objects
### Bypassing the AI client
### Hard-coding colors in components
### Skipping `applyThemeToDOM` on first paint
## Error Handling
- **Typed errors for known recoverable cases.** `MissingAPIKeyError` (`src/lib/ai.ts:13`) lets `AIChatPanel` distinguish "user must add key" from "network failed".
- **Defensive JSON parsing.** `migrateFromV3` (`src/lib/storage.ts:77`) wraps `JSON.parse` in try/catch and falls back to `null`. Each field uses `?? defaultValue` so a malformed v3 blob still produces a valid v4 state.
- **Silent localStorage failures.** Every `localStorage` read/write is wrapped (`try { ... } catch { /* noop */ }`) so private-mode browsers do not crash the app. Examples: `src/main.tsx:13`, `src/hooks/useTheme.ts:7`, `src/lib/storage.ts:113`.
- **No global error boundary.** A bug in a tab will currently bubble to React's default behavior. (Tracked as a follow-up — not yet implemented.)
- **Chart.js teardown.** `BaseChart` always destroys its Chart instance in effect cleanup so StrictMode double-mounts and theme re-mounts do not leak.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
