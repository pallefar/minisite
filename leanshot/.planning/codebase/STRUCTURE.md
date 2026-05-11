# Codebase Structure

**Analysis Date:** 2026-05-10

## Directory Layout

```
leanshot/
├── index.html                          # SPA shell + font preconnect + theme-color metas
├── package.json                        # Vite + React 19 + Tailwind v4 + Zustand
├── vite.config.ts                      # @vitejs/plugin-react + @tailwindcss/vite + `@/*` alias
├── tsconfig.json                       # Solution config — references the two below
├── tsconfig.app.json                   # Strict TS for `src/*`
├── tsconfig.node.json                  # TS for vite.config.ts itself
├── .gitignore
├── .planning/
│   └── codebase/                       # Output of `/gsd-map-codebase`
└── src/
    ├── main.tsx                        # Bootstrap: theme + hydrate + render
    ├── App.tsx                         # State-driven view router; Suspense boundaries
    ├── index.css                       # Tailwind v4 entry + `@theme` tokens + keyframes
    ├── vite-env.d.ts                   # Vite type augmentations
    ├── types/
    │   └── index.ts                    # All shared domain types (single barrel)
    ├── lib/                            # Pure logic, store, persistence, integrations
    │   ├── store.ts                    # Zustand `useStore` + actions + persist config
    │   ├── storage.ts                  # Storage keys, initial state, v3→v4 migration, apiKeyStorage
    │   ├── ai.ts                       # Anthropic Messages API wrapper + MissingAPIKeyError
    │   ├── pharmacology.ts             # Half-lives, titration tables, calcMedLevel()
    │   ├── insights.ts                 # generateInsights() + pickFocus() rule engines
    │   ├── constants.ts                # SUPPS_DEFAULT, SYMPTOMS_LIST, TAB_TITLES, SITES
    │   ├── helpers.ts                  # Date/format/cn/clamp/pct utilities
    │   ├── motion.ts                   # easing/duration tokens + framer-motion variants
    │   ├── chart-theme.ts              # Chart.js token reader (live CSS-var sync)
    │   └── share-card/
    │       ├── renderer.ts             # Canvas helpers (roundRect, wrapText) + ShareData/Template types
    │       ├── template-bold.ts
    │       ├── template-milestone.ts
    │       └── template-minimal.ts
    ├── hooks/                          # React hooks — small, single-purpose
    │   ├── useTheme.ts                 # + applyThemeToDOM() side-effect helper
    │   ├── useStreaks.ts               # Memoised streak calculations from store
    │   ├── useToast.ts                 # Action shorthand around store.showToast/dismissToast
    │   ├── useReducedMotion.ts
    │   └── useCountUp.ts
    ├── components/
    │   ├── ui/                         # Domain-free design-system primitives
    │   │   ├── Badge.tsx
    │   │   ├── Button.tsx              # Button + IconButton, 6 variants, 3 sizes
    │   │   ├── Card.tsx                # Card + CardHeader + StatTile, 12-col bento spans
    │   │   ├── EmptyState.tsx
    │   │   ├── Input.tsx               # Input + Select + Textarea
    │   │   ├── Modal.tsx
    │   │   ├── Pill.tsx                # Pill + PillGroup (single-select chips)
    │   │   ├── ProgressRing.tsx        # ProgressRing + ProgressBar
    │   │   ├── Sheet.tsx               # Mobile bottom sheet / desktop centered dialog
    │   │   ├── Skeleton.tsx
    │   │   ├── Sparkline.tsx
    │   │   ├── SwipeToDelete.tsx
    │   │   └── Toast.tsx               # Subscribes to store.toast
    │   ├── layout/                     # App-shell chrome
    │   │   ├── AppShell.tsx            # Sidebar + main + MobileNav + FAB + Toast
    │   │   ├── GreetingStrip.tsx
    │   │   ├── MobileNav.tsx           # iOS-style bottom nav with layoutId pill
    │   │   ├── Sidebar.tsx             # Desktop rail
    │   │   └── Topbar.tsx
    │   ├── marketing/
    │   │   └── Landing.tsx             # Pre-onboarding landing page
    │   ├── onboarding/
    │   │   ├── OnboardingFlow.tsx      # 7-step user-creation wizard
    │   │   ├── ProgressIndicator.tsx
    │   │   └── UnitToggle.tsx
    │   └── dashboard/
    │       ├── QuickLogSheet.tsx       # Mobile bottom-sheet quick actions
    │       ├── ai/
    │       │   └── AIChatPanel.tsx     # Slide-in coach panel; calls callAnthropic()
    │       ├── cards/                  # Bento-grid widgets (one per concept)
    │       │   ├── EffectivenessCard.tsx
    │       │   ├── FocusCard.tsx       # Reads pickFocus(state)
    │       │   ├── GLPCurveCard.tsx
    │       │   ├── HeroCard.tsx
    │       │   ├── QuickLogCard.tsx
    │       │   ├── SiteRotationCard.tsx
    │       │   ├── StreaksCard.tsx
    │       │   └── SymptomCard.tsx
    │       ├── charts/                 # Chart.js wrappers
    │       │   ├── BaseChart.tsx       # Theme-aware Chart instance lifecycle
    │       │   ├── MedLevelChart.tsx   # 28-day past + 7-day projection
    │       │   └── SimpleCharts.tsx    # Weight, protein, etc.
    │       ├── modals/
    │       │   ├── DoctorReport.tsx    # Print-friendly clinical summary
    │       │   └── PhotoCompareModal.tsx
    │       ├── settings/
    │       │   └── SettingsPage.tsx    # Profile, goals, AI key, data export/reset
    │       ├── share/
    │       │   └── ShareCardModal.tsx  # Composes share-card templates onto canvas
    │       ├── tabs/                   # One file per dashboard tab
    │       │   ├── ActivityTab.tsx
    │       │   ├── BodyTab.tsx
    │       │   ├── HomeTab.tsx
    │       │   ├── InsightsTab.tsx
    │       │   ├── MedicationTab.tsx
    │       │   ├── MoodTab.tsx
    │       │   ├── NutritionTab.tsx
    │       │   ├── SupplementsTab.tsx
    │       │   └── SymptomsTab.tsx
    │       └── tour/
    │           └── GuidedTour.tsx      # First-run coachmarks; exports shouldShowTour()
    └── illustrations/                  # Inline SVG components, no domain logic
        ├── AIAvatar.tsx
        ├── ConnectData.tsx
        ├── EmptyInjections.tsx
        ├── EmptyPhotos.tsx
        ├── EmptySymptoms.tsx
        ├── HeroOrbital.tsx
        ├── OnboardSteps.tsx
        ├── StreakBadge.tsx
        └── Vial.tsx
```

## Directory Purposes

**`src/`:**
- Purpose: All application source. Anything outside is config or generated.
- Contains: TS/TSX source, the global `index.css` Tailwind entry, Vite env types.

**`src/types/`:**
- Purpose: Shared domain TypeScript types. Single barrel — there is no per-feature `.d.ts`.
- Contains: `index.ts` only.
- Key files: `src/types/index.ts` exports `User`, `Injection`, `WeightLog`, `Meal`, `Workout`, `Vial`, `Cost`, `MoodLog`, `SleepLog`, `Photo`, `AIMessage`, `TabId`, `Theme`, plus enums.

**`src/lib/`:**
- Purpose: Pure logic, state container, persistence, external-service clients, and constants. No JSX.
- Contains:
  - **State container:** `store.ts`, `storage.ts`
  - **External integration:** `ai.ts`
  - **Domain logic:** `pharmacology.ts`, `insights.ts`, `constants.ts`
  - **Utilities:** `helpers.ts`, `motion.ts`, `chart-theme.ts`
  - **Subsystem:** `share-card/` (canvas-rendered shareables; the only nested subdir under `lib/`)
- Key files:
  - `src/lib/store.ts` — `useStore` hook + `hydrate()` + every action.
  - `src/lib/storage.ts` — `STORAGE_KEY = 'leanshot_v4'`, `STORAGE_VERSION = 4`, `migrateFromV3()`, `apiKeyStorage`.
  - `src/lib/ai.ts` — `callAnthropic(opts)` + `MissingAPIKeyError`.
  - `src/lib/pharmacology.ts` — `HALF_LIVES`, `TITRATION`, `TRIAL_DATA`, `calcMedLevel`, `medLabel`, `medLabelShort`.
  - `src/lib/insights.ts` — `generateInsights(state)`, `pickFocus(state)`.
  - `src/lib/constants.ts` — `SUPPS_DEFAULT`, `SYMPTOMS_LIST`, `TAB_TITLES`, `SITES`, `siteShort`.
  - `src/lib/helpers.ts` — `cn`, `todayStr`, `formatShort`, `formatLong`, `lastNDays`, `daysBetween`, `hoursSince`, `clamp`, `pct`, `greeting`, `relTime`, `formatDuration`, `escapeHtml`.

**`src/hooks/`:**
- Purpose: Reusable React hooks. Small, single-purpose, named `use*.ts`.
- Contains: `useTheme.ts`, `useStreaks.ts`, `useToast.ts`, `useReducedMotion.ts`, `useCountUp.ts`.
- Key files:
  - `src/hooks/useTheme.ts` exports both the `useTheme` hook **and** `applyThemeToDOM(theme)` for `main.tsx` to call before mount.
  - `src/hooks/useToast.ts` is intentionally a thin function (not stateful) — it grabs `useStore.getState()` and schedules a `setTimeout` dismiss.

**`src/components/`:**
- Purpose: All JSX. Organised by surface, not by feature.
- Subdivisions:
  - `ui/` — domain-free primitives.
  - `layout/` — frame chrome.
  - `marketing/` — pre-onboarding.
  - `onboarding/` — onboarding flow.
  - `dashboard/` — everything inside the authenticated app.

**`src/components/ui/`:**
- Purpose: Design-system primitives that know nothing about LeanShot domain.
- Contains: `Badge`, `Button` (+ `IconButton`), `Card` (+ `CardHeader` + `StatTile`), `EmptyState`, `Input` (+ `Select` + `Textarea`), `Modal`, `Pill` (+ `PillGroup`), `ProgressRing` (+ `ProgressBar`), `Sheet`, `Skeleton`, `Sparkline`, `SwipeToDelete`, `Toast`.
- Allowed imports: `lucide-react`, `framer-motion`, `@/lib/helpers` (for `cn`). The Toast primitive is the one exception — it subscribes to the store.

**`src/components/layout/`:**
- Purpose: Persistent app chrome around tab content.
- Contains: `AppShell.tsx` (the wrapper used by every dashboard view), `Sidebar.tsx` (desktop rail), `MobileNav.tsx` (bottom bar), `Topbar.tsx`, `GreetingStrip.tsx`.

**`src/components/dashboard/tabs/`:**
- Purpose: One module per visible tab. Each is lazy-loaded by `App.tsx`.
- Contains: `HomeTab.tsx`, `MedicationTab.tsx`, `SymptomsTab.tsx`, `BodyTab.tsx`, `NutritionTab.tsx`, `ActivityTab.tsx`, `SupplementsTab.tsx`, `MoodTab.tsx`, `InsightsTab.tsx` — exactly one per `TabId` in `src/types/index.ts`.

**`src/components/dashboard/cards/`:**
- Purpose: Self-contained dashboard widgets that subscribe to the store directly.
- Contains: `HeroCard`, `FocusCard`, `GLPCurveCard`, `SiteRotationCard`, `EffectivenessCard`, `SymptomCard`, `StreaksCard`, `QuickLogCard`.
- Convention: Each takes few or no props; reads its inputs from `useStore`.

**`src/components/dashboard/charts/`:**
- Purpose: Chart.js wrappers.
- Contains: `BaseChart.tsx` (lifecycle wrapper), `MedLevelChart.tsx`, `SimpleCharts.tsx` (weight/protein/etc.).

**`src/components/dashboard/modals/`, `ai/`, `settings/`, `share/`, `tour/`:**
- Purpose: Overlay surfaces lazy-loaded from `App.tsx` (`AIChatPanel`, `SettingsPage`, `DoctorReport`, `GuidedTour`) plus their internal helpers.

**`src/illustrations/`:**
- Purpose: Inline SVG React components used for hero art, empty states, and avatars.
- Convention: PascalCase named export, no domain logic, accept a `size` and/or `className` prop.

## Key File Locations

**Entry Points:**
- `index.html` — HTML shell.
- `src/main.tsx` — JS bootstrap (theme + hydrate + render).
- `src/App.tsx` — top-level component; chooses view, hosts modal state.

**Configuration:**
- `vite.config.ts` — Vite + React + Tailwind plugins, dev port `5173`, `@/*` → `./src/*` alias.
- `tsconfig.app.json` — strict compile config for `src/*`.
- `package.json` — scripts: `dev`, `build` (`tsc -b && vite build`), `preview`, `typecheck`.

**Core State / Logic:**
- `src/lib/store.ts` — Zustand store and every action.
- `src/lib/storage.ts` — persistence keys, migration, API-key helper.
- `src/lib/insights.ts` — dashboard rule engines.
- `src/lib/pharmacology.ts` — clinical/PK constants and `calcMedLevel`.
- `src/lib/ai.ts` — Anthropic API wrapper.

**Design System:**
- `src/index.css` — Tailwind v4 entry, `@theme` tokens, keyframes (`animate-rise`, `animate-fade-in`, `thinking`), reduced-motion overrides.
- `src/components/ui/*.tsx` — primitives.
- `src/lib/motion.ts` — JS motion vocabulary mirroring CSS.

**Testing:**
- Not applicable — no test framework configured at this point.

## Naming Conventions

**Files:**
- **React components:** PascalCase `.tsx`. The default convention is *one component per file* with a named export matching the filename (`Card.tsx` exports `Card`). A handful of files export sibling helpers from the same surface (`Card.tsx` also exports `CardHeader`, `StatTile`; `Button.tsx` exports `Button` + `IconButton`; `Input.tsx` exports `Input` + `Select` + `Textarea`).
- **Hooks:** camelCase starting with `use`, `.ts` extension (no JSX). E.g. `useTheme.ts`, `useStreaks.ts`.
- **Lib modules:** camelCase or kebab-case `.ts`, named after their concern. E.g. `store.ts`, `storage.ts`, `pharmacology.ts`, `chart-theme.ts`.
- **Types barrel:** `src/types/index.ts` — singular import path (`@/types`).

**Directories:**
- All lowercase, kebab-case where multi-word (`share-card/`).
- Plural when they hold many sibling files of the same kind (`tabs/`, `cards/`, `charts/`, `hooks/`, `components/`, `illustrations/`).
- Singular when they hold one focal feature (`ai/`, `settings/`, `share/`, `tour/`, `marketing/`, `onboarding/`).

**Imports:**
- Always use the `@/*` alias for cross-directory imports (`import { useStore } from '@/lib/store'`). Relative imports are used only within the same directory (e.g. `./Sidebar` inside `src/components/layout/AppShell.tsx`).

**Components:**
- Named `export function ComponentName(...)` — `forwardRef` is used where ref-forwarding is needed (`Card`, `Button`).
- Props interfaces are PascalCase suffixed `Props` (`CardProps`, `AIChatPanelProps`).

**Store actions:**
- Verb-first camelCase: `setTab`, `addInjection`, `removeInjection`, `upsertWeight`, `bulkSetSteps`, `toggleSupp`, `appendAI`, `clearAI`, `resetAll`.

**Local storage keys:**
- Versioned, lowercase, snake-style: `leanshot_v4`, `leanshot_v3` (legacy), `leanshot_theme_v4`, `leanshot_anthropic_key`, `leanshot_tour_seen_v4`. Defined in `src/lib/storage.ts` and `src/hooks/useTheme.ts`.

## Where to Add New Code

**A new dashboard tab:**
1. Add the new `TabId` literal to `src/types/index.ts`.
2. Add metadata to `TAB_TITLES` in `src/lib/constants.ts`.
3. Add the icon row to `TABS` in both `src/components/layout/Sidebar.tsx` and `src/components/layout/MobileNav.tsx`.
4. Create `src/components/dashboard/tabs/MyNewTab.tsx` exporting `export function MyNewTab() { ... }`.
5. Add the lazy import + the `currentTab === 'my-new'` branch in `src/App.tsx`.

**A new dashboard card:**
- Create `src/components/dashboard/cards/MyCard.tsx` with `export function MyCard()`.
- Compose with `<Card span={N}>` and `<CardHeader>` from `src/components/ui/Card.tsx`.
- Subscribe to the store via `useStore((s) => s.slice)` selectors.
- Drop it into the relevant tab in `src/components/dashboard/tabs/*.tsx`.

**A new piece of persisted data:**
1. Add the type to `src/types/index.ts`.
2. Add the key + initial value to `PersistedState` and `initialState` in `src/lib/storage.ts`.
3. If users may already have v3 data, extend the `migrateFromV3` mapping in `src/lib/storage.ts`.
4. Add actions to `Actions` interface and to the `create` body in `src/lib/store.ts`.
5. Add the key to `partialize` in `src/lib/store.ts:231` so it persists.
6. Bump `STORAGE_VERSION` only if you also change the shape of an existing field.

**A new UI primitive:**
- Place under `src/components/ui/` as `MyPrimitive.tsx`. Keep it domain-free — pull tokens from CSS variables, not from the store.

**A new external integration / API client:**
- Add `src/lib/<service>.ts` mirroring the shape of `src/lib/ai.ts` (typed errors, single async entry point, secret read via a storage helper in `src/lib/storage.ts`).

**A new hook:**
- Place under `src/hooks/` as `useMyThing.ts`. If it derives from store state, prefer composing inside the hook with `useStore((s) => ...)` + `useMemo`.

**A new chart:**
- Add a wrapper to `src/components/dashboard/charts/SimpleCharts.tsx` (or its own file if non-trivial) that returns `<BaseChart config={...} ariaLabel={...} />`. Read theme tokens with `getChartTokens(theme)` from `src/lib/chart-theme.ts`.

**A new illustration / SVG asset:**
- Add `src/illustrations/MyArt.tsx` with a PascalCase named export accepting `size?: number; className?: string`. Use CSS-variable colors so it tracks the theme.

**A new modal/overlay accessible from the dashboard:**
- Build the component under `src/components/dashboard/modals/` (or its own subfolder if it has internal helpers).
- In `src/App.tsx`, lazy-import it and add a `useState` open-flag plus a render slot inside the existing trailing `<Suspense>` block.
- Wire the open-trigger via a prop passed into `AppShell` (mirror `onLogDose`, `onOpenReport`, `onOpenAI`, `onOpenSettings`).

## Special Directories

**`.planning/`:**
- Purpose: Planning artefacts produced by `/gsd-*` commands.
- Generated: Yes — overwritten on each `/gsd-map-codebase` run.
- Committed: Per the user's repo policy.

**`node_modules/`:**
- Purpose: Installed npm dependencies.
- Generated: Yes (`npm install`).
- Committed: No.

**`src/illustrations/`:**
- Purpose: Inline SVG components used as art (not as icons — icons come from `lucide-react`).
- Generated: No, hand-authored.
- Committed: Yes.

**`src/lib/share-card/`:**
- Purpose: Canvas-rendered shareable summary cards (bold / minimal / milestone templates).
- Generated: No.
- Committed: Yes.

---

*Structure analysis: 2026-05-10*
