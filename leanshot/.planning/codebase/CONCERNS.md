# Codebase Concerns

**Analysis Date:** 2026-05-10

## Tech Debt

**No linter / formatter / pre-commit hooks configured:**
- Issue: Repository ships zero quality gates. There is no `.eslintrc*`, no `eslint.config.*`, no `biome.json`, no `.prettierrc*`, no `.husky/`, and no `.github/workflows/`. `package.json` exposes only `dev`, `build`, `preview`, `typecheck` — no `lint`, no `format`, no `test`.
- Files: `/Users/karstenhaldan/minisite/leanshot/package.json` (entire `scripts` block), absence of `/Users/karstenhaldan/minisite/leanshot/.github/`
- Impact: Style drift across files, easy-to-miss bugs (unused imports, dead branches, exhaustive-deps violations), no enforcement of accessibility or security rules. Already producing artifacts: `BaseChart.tsx:36` carries `// eslint-disable-next-line react-hooks/exhaustive-deps` even though no ESLint config exists, suggesting the rule was once enforced and silently dropped.
- Fix approach: Add `eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y` + `@typescript-eslint` with React 19 + TS 5.6 presets. Add `prettier` with project-wide config. Wire `lint`, `format`, `format:check` scripts. Optional: add `lint-staged` + `husky` pre-commit. Fail fast in `build` script via `tsc -b && eslint . && vite build`.

**No automated tests anywhere:**
- Issue: Repository contains zero `*.test.*` / `*.spec.*` files. No `vitest.config.*`, no `jest.config.*`, no Playwright/Cypress config. Pure logic modules (pharmacology, insights, streaks, storage migration) ship untested despite being clinical-adjacent.
- Files: entire `/Users/karstenhaldan/minisite/leanshot/src/lib/` directory, especially `pharmacology.ts`, `insights.ts`, `storage.ts`, hooks `/Users/karstenhaldan/minisite/leanshot/src/hooks/useStreaks.ts`
- Impact: Refactors are risky. Migration code (`migrateFromV3` at `src/lib/storage.ts:77`) silently swallows errors and returns `null` — a regression here would invisibly delete v1 user data. Half-life math (`calcMedLevel` at `src/lib/pharmacology.ts:117`) drives a chart that users may show their doctor.
- Fix approach: Add Vitest (already a Vite project — minimal config). First targets: `pharmacology.calcMedLevel`, `insights.generateInsights`, `insights.pickFocus`, `storage.migrateFromV3`, `useStreaks.calc`. Add a single React Testing Library smoke test for `OnboardingFlow` to catch regression in the seven-step flow.

**Affiliate placeholder in production code:**
- Issue: Amazon link contains literal `YOURTAG-20` placeholder.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/SupplementsTab.tsx:66` — `href={`https://www.amazon.com/s?k=${s.search}&tag=YOURTAG-20`}`
- Impact: Every "Reorder" button on the Stack tab links to a malformed affiliate URL. Either revenue is leaking (if intent is to monetize) or the URL is misleading (if intent is plain Amazon search).
- Fix approach: Move the tag (or absence thereof) to `lib/constants.ts`. If the affiliate program is not active, drop the `&tag=` param entirely.

**`alert()` placeholder in monetization CTA:**
- Issue: "Get the guide" CTA uses `alert('Connect your payment provider here.')` — a developer note shipped to users.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/InsightsTab.tsx:159`
- Impact: Tapping the prominent "Get the guide" button on the Insights tab pops a native browser alert with developer instructions — embarrassing, looks broken, undermines the "clinical" brand.
- Fix approach: Either (a) hide the card behind a feature flag, (b) link to a real product page / Stripe checkout, or (c) show a "Coming soon — drop your email" form.

**`leanshot_v3` migration is one-way and silently lossy:**
- Issue: `migrateFromV3` deletes `LEGACY_KEY` even on partial success — once a single field is malformed and fields are coerced via `??`, the v3 blob is gone forever. There is no backup before deletion.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/storage.ts:103` (`localStorage.removeItem(LEGACY_KEY)`); duplicate migration call site `/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts:271-276`
- Impact: A user with corrupted v3 data loses everything. Also: migration runs both in `migrate()` (zustand persist) and inside the manual `hydrate()` helper — the duplicated logic is racy.
- Fix approach: Snapshot v3 to `leanshot_v3_backup` before removing. Delete the duplicate migration in `hydrate()` and rely solely on persist's `migrate` callback. Bump `STORAGE_VERSION` only via that callback.

**Vial decrement uses unstable index recompute on every iteration:**
- Issue: Inside `addInjection`, `firstActive` is recomputed inside the `vials.map(...)` callback on every iteration instead of hoisting it.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts:122-126`
- Impact: Functionally correct but O(n²). Fine at n=3 vials, wasteful otherwise. Easy to refactor and shows up in any code review.
- Fix approach: Hoist `const firstActive = s.vials.findIndex(...)` above `vials.map(...)`.

**Type assertions used to bypass missing union narrowing:**
- Issue: Five `as never` escapes scattered across the codebase to silence TS errors without fixing the underlying type model.
- Files:
  - `/Users/karstenhaldan/minisite/leanshot/src/components/layout/Topbar.tsx:36` — `setTab(tab as never)`
  - `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/ActivityTab.tsx:118` — `setWo({ ...wo, type: e.target.value as never })`
  - `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/BodyTab.tsx:82` — `addMeasurement(entry as never)`
  - `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/HomeTab.tsx:43` — `setTab(insight.cta!.tab as never)`
  - `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/charts/BaseChart.tsx:44` — `c.options = (config.options ?? {}) as never`
- Impact: Each `as never` is a runtime crash waiting for a typo. `Topbar` and `HomeTab` cast `string` → `TabId` without validating against `TAB_TITLES`; if `insights.ts` ever returns a `cta.tab` that does not match a `TabId`, the call to `setTab` corrupts UI state.
- Fix approach: Tighten `Insight.cta.tab` to `TabId` in `/Users/karstenhaldan/minisite/leanshot/src/lib/insights.ts:18`. Replace `as never` in `Topbar.handleSearch` with a guarded narrow against `TAB_TITLES` keys. For `BodyTab`, type `Measurement` to allow extra string keys properly. For `BaseChart`, accept `ChartOptions<ChartType>` instead of `never`.

**Native `alert()` / `confirm()` used for destructive actions:**
- Issue: Three flows rely on browser-native dialogs that ignore the design system, cannot be themed, and break iOS PWA UX.
- Files:
  - `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/SettingsPage.tsx:78-79` — double `confirm()` for "Reset everything"
  - `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/AIChatPanel.tsx:114` — `confirm('Clear conversation history?')`
  - `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/InsightsTab.tsx:159` — `alert(...)` (also tagged above as placeholder)
- Impact: Visual inconsistency on a product whose central pitch is "clinical warmth"; non-blocking but jarring.
- Fix approach: Promote a confirm helper around the existing `Modal` component, e.g. `useConfirm()` returning a promise.

**Inline AI prompt construction is fragile to data drift:**
- Issue: `AIChatPanel.send` and `NutritionTab.aiEstimate` build prompts by string-concatenating store values. Any new `User` field that ought to influence advice has to be threaded manually.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/AIChatPanel.tsx:43` (the `ctx` template literal); `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/NutritionTab.tsx:60-63` (JSON-only macro estimator)
- Impact: Coach advice can become stale. The macro estimator parses arbitrary model output with `JSON.parse(text.replace(/```json|```/g, '').trim())` — any non-JSON reply throws and surfaces as a generic toast.
- Fix approach: Centralize prompt assembly in `lib/ai.ts` (e.g. `buildCoachContext(state)`). For the macro estimator, prefer Claude's tool use / structured output rather than regex-stripping markdown.

## Known Bugs

**`dosesUsed > dosesPerVial` after manual edit:**
- Symptoms: Adding a vial with `dosesUsed` greater than `dosesPerVial` (the form lets you type any number) results in a negative `remaining` rendering as `-1/4 doses` and a vial card with negative width on the fill bar.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/MedicationTab.tsx:380-382` (no max-validation on the input); `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/MedicationTab.tsx:163` (`pct = ... (remaining / v.dosesPerVial) * 100`)
- Trigger: Add vial → "Already used" = 99, "Doses per vial" = 4 → save.
- Workaround: Delete and re-add the vial.

**`Math.max(...Object.values(streaks))` returns `-Infinity` if streaks empty:**
- Symptoms: Share card "best streak" shows `-Infinity` — only triggered if `useStreaks` ever returned `{}`, but the type guarantees four numeric keys, so practically reads `Math.max(0,0,0,0) = 0`. Brittle to future refactors that make any streak optional.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/share/ShareCardModal.tsx:38`
- Trigger: Hypothetical — a future change to `Streaks` interface would break silently.
- Workaround: Wrap in `Math.max(0, ...Object.values(streaks))`.

**Apple Health import filters weights by raw kg range only:**
- Symptoms: Imperial users with a CSV in pounds get all entries silently rejected (the `>30 && <300` check rejects anything > 300 lb).
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/ActivityTab.tsx:92` — `if (val > 30 && val < 300)`
- Trigger: User on imperial units uploads Health export where weight is recorded in kg but represented as lb after conversion.
- Workaround: Edit data manually before import.

**`steps[ds] ?? 0 >= 7000` mixes coalescing and comparison without parens:**
- Symptoms: Operator precedence is fine in JS (`??` binds tighter than `>=`), but the readability hazard is real and the same expression is duplicated in `useStreaks` and several tabs.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/hooks/useStreaks.ts:52`
- Trigger: A future contributor inverts to `(steps[ds] ?? 0 >= 7000)` thinking it parenthesizes; subtle behaviour change.
- Workaround: None needed today; refactor for clarity.

**Insights selector creates a new array every render:**
- Symptoms: `useStore(generateInsights)` and `useStore((s) => generateInsights(s)[0])` rebuild a fresh array on every store mutation — Zustand's default equality check is `Object.is`, so any state change re-runs `generateInsights` and re-renders the consumer. With a typical user the recompute is cheap; with hundreds of meals it scans `s.meals` every action (toast, water tap, etc.).
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/InsightsTab.tsx:26`; `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/HomeTab.tsx:16`
- Trigger: Any unrelated state change (toast, tab change) triggers re-render of `HomeTab` insight card.
- Workaround: Wrap with shallow equality or memoize `generateInsights(s)` inside `useMemo` keyed on the slices it actually reads.

**Settings page subscribes to entire store:**
- Symptoms: `const fullState = useStore((s) => s);` causes `SettingsPage` to re-render on every store change — including water increments, toast id, tab switches.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/SettingsPage.tsx:28`
- Trigger: Open Settings; perform any action elsewhere; Settings re-renders.
- Workaround: Inline the export-data logic into a click handler that pulls `useStore.getState()` once at click time.

## Security Considerations

**Anthropic API key stored in plaintext localStorage and shipped from the browser to api.anthropic.com:**
- Risk: This is the single biggest security and threat-modelling issue in the codebase.
  1. The user's Anthropic API key is persisted in plaintext under `localStorage.getItem('leanshot_anthropic_key')` (`/Users/karstenhaldan/minisite/leanshot/src/lib/storage.ts:29`, `:111-133`).
  2. Any third-party script with DOM access (a future analytics tag, a copy-pasted polyfill, a malicious npm dep) can read the key via `localStorage.getItem('leanshot_anthropic_key')`. There is no `httpOnly` boundary the way a cookie would have.
  3. Any XSS (today the app has none, but the surface is large — see "XSS surface" below) yields the key.
  4. The key is sent client-side directly to `https://api.anthropic.com/v1/messages` with header `anthropic-dangerous-direct-browser-access: true` (`/Users/karstenhaldan/minisite/leanshot/src/lib/ai.ts:51-58`). Anthropic's own header naming flags this as off-label.
  5. Rate limits, audit logging, and key rotation are entirely the end-user's problem. A leaked key cannot be revoked by LeanShot.
  6. Privacy copy in `Landing.tsx:378-382` and `SettingsPage.tsx:178-184` claims local-only data; the AI exception is mentioned, but the security trade-off of "BYO key in browser storage" is not.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/storage.ts:111-133`, `/Users/karstenhaldan/minisite/leanshot/src/lib/ai.ts:1-71`, `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/SettingsPage.tsx:141-163`
- Current mitigation: The Settings input renders as `type="password"`. The fetch handler does not log the key. CORS is "fixed" only because Anthropic's dangerous-direct-browser-access header opens it. No additional layer.
- Recommendations:
  1. **Add a server proxy.** A tiny Vercel/Cloudflare edge function that holds the key (or proxies the user's key) and signs requests on behalf of the browser. This is the only real fix.
  2. **Until then, harden the BYO-key path:** mask the key on display (show `sk-ant-…7f3a`), warn explicitly in the Settings copy that the key is in localStorage and that any browser extension can read it, add a "rotate key" CTA that links to the Anthropic console, and document the threat model in the privacy copy.
  3. **Do not log the key** on errors — currently `error: Anthropic ${r.status}: ${text}` would leak a header echo if Anthropic ever reflected one (`/Users/karstenhaldan/minisite/leanshot/src/lib/ai.ts:64`).
  4. Consider WebAuthn/passkey-gated session storage instead of localStorage so a stolen disk image without the user present is useless.

**Hardcoded model identifier may not exist:**
- Risk: `DEFAULT_MODEL = 'claude-sonnet-4-6'` in `/Users/karstenhaldan/minisite/leanshot/src/lib/ai.ts:22` is not a real Anthropic model ID at the time of writing (the real format is `claude-sonnet-4-5-20250929` or `claude-opus-4-5`). This means every AI call will 404 / 400 in production.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/ai.ts:22`
- Current mitigation: None.
- Recommendations: Pin to a published model ID (e.g. `claude-sonnet-4-5`), and add a Settings field so the user can override. This also addresses model deprecation churn.

**External link to `console.anthropic.com` and Amazon uses `rel="noopener"` only:**
- Risk: Modern browsers default to `noopener` for `target="_blank"`, but explicit `noreferrer` would also strip the Referer header. Low impact.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/SettingsPage.tsx:160`, `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/SupplementsTab.tsx:67-68`
- Current mitigation: `rel="noopener"` is set.
- Recommendations: Append `noreferrer` for consistency.

**XSS surface — minimal but present:**
- Risk: No `dangerouslySetInnerHTML`, no `eval`, no `new Function` — good. However, three free-text inputs are rendered into the DOM via React's text path: NSV text (`/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/InsightsTab.tsx:94`), injection notes (`MedicationTab.tsx:255`), and AI assistant content (`AIChatPanel.tsx:204`). React escapes these by default — safe today. The risk surface is the doctor report `window.print()` flow, where any future change to `dangerouslySetInnerHTML` for richer formatting would inherit unsanitized user notes.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/modals/DoctorReport.tsx`
- Current mitigation: React text rendering only.
- Recommendations: Add an explicit comment in `DoctorReport` reminding maintainers to keep the report HTML-free. If markdown is ever added to AI replies, route it through DOMPurify or a markdown lib that escapes by default.

**Anthropic prompt injection vector:**
- Risk: User-supplied symptom notes, NSV text, meal names are concatenated verbatim into the system prompt or messages array (`AIChatPanel.tsx:43-69`). A malicious paste could exfiltrate the key into the AI's reply if the user is tricked into reading it back.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/ai/AIChatPanel.tsx:43-69`
- Current mitigation: System prompt instructs the model to defer to a doctor; nothing structural prevents prompt injection.
- Recommendations: Wrap user-supplied free-text in clearly delimited XML tags inside the prompt, e.g. `<user_notes>${notes}</user_notes>`, and instruct the model to treat content inside those tags as data, not instructions.

## Performance Bottlenecks

**`MedLevelChart` recomputes 144 sample points on every state change:**
- Problem: The 28-day past + 7-day projected curve uses a 6-hour stride → ~140 sample points. Each sample calls `calcMedLevel` which iterates every injection. With 30 injections and any state change in any subscribed slice, the chart recomputes ~4,200 multiplications. Cheap on desktop, noticeable on mid-range mobile during scrolling.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/charts/MedLevelChart.tsx:21-33`, `/Users/karstenhaldan/minisite/leanshot/src/lib/pharmacology.ts:117-126`
- Cause: `useMemo` is keyed on `[u, injections, theme]` — `u` is reference-stable from Zustand, `injections` only changes on add/remove, so the memo is sound; the cost is all up-front. The bigger issue is that `BaseChart` (`src/components/dashboard/charts/BaseChart.tsx:40-46`) calls `chart.update('none')` on every config change, which itself can flash a paint.
- Improvement path: Memoize `calcMedLevel` per-injection across all sample points using exponential decay accumulators. Or: increase stride to 12 h and downsample for the projected portion.

**`useCountUp` runs four parallel rAF loops on the hero card:**
- Problem: `HeroCard` invokes `useCountUp` four times for `lostAbs`, `goalPct`, `injections.length`, `todayProtein` (`/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/cards/HeroCard.tsx:35-38`). Each presumably runs its own `requestAnimationFrame`. On a mid-tier phone the 60 fps animation can collide with the mesh-drift animation and the orbital animation, triggering layout thrash.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/cards/HeroCard.tsx:35-38`, `/Users/karstenhaldan/minisite/leanshot/src/hooks/useCountUp.ts`
- Cause: One rAF loop per hook call.
- Improvement path: Coalesce into a single rAF; skip the animation when `prefers-reduced-motion: reduce` (already handled at the CSS layer but the rAF still runs).

**Lucide-react ships ~36 MB of source** (per-icon ESM modules):
- Problem: `node_modules/lucide-react` is 36 MB on disk. Each named import (`import { Syringe } from 'lucide-react'`) hits a single tree-shakable file, but imports are spread across 19 files. Vite tree-shakes correctly in production builds, so bundle size impact is low — but dev `vite` startup parses many tiny files.
- Files: 19 files matching `import .* from 'lucide-react'`. Highest concentration: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/settings/SettingsPage.tsx:2` (10 icons), `/Users/karstenhaldan/minisite/leanshot/src/components/layout/Sidebar.tsx`, `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/InsightsTab.tsx` (8 icons).
- Cause: Project default; no real fix needed.
- Improvement path: If startup matters, swap to `lucide-react/dist/esm/icons/...` deep imports, or migrate to inline SVG for the ~6 most-used glyphs.

**chart.js + framer-motion + lucide-react together ≈ 290 KB gzipped:**
- Problem: Estimated production bundle (rough order-of-magnitude): chart.js ~70 KB gz, framer-motion ~50 KB gz, react+react-dom ~45 KB gz, lucide-react (tree-shaken) ~6 KB gz, application code ~60 KB gz. The `MedLevelChart` is lazy-loaded via the medication tab boundary, but the marketing landing page eagerly imports `framer-motion` for hero animations (`Landing.tsx:3`).
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/marketing/Landing.tsx:3` (uses `motion`), `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/charts/BaseChart.tsx:2` (registers `Chart.register(...registerables)` — pulls every chart type even if only line+bar+doughnut are used)
- Cause: `Chart.register(...registerables)` imports the entire Chart.js controllers/elements/scales surface.
- Improvement path: Replace `registerables` with explicit `Chart.register(LineController, BarController, DoughnutController, LineElement, BarElement, PointElement, ArcElement, LinearScale, CategoryScale, Tooltip, Legend, Filler)` — saves ~20-30 KB gz.

**`generateInsights` runs the entire insight engine every render of HomeTab:**
- Problem: HomeTab subscribes via `useStore((s) => generateInsights(s)[0])`. Zustand's default `Object.is` equality means any unrelated state change (e.g., toast id increment) re-runs the engine, allocates a fresh array, returns a fresh object, and re-renders.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/HomeTab.tsx:16`
- Cause: Selector returns a fresh object reference each time.
- Improvement path: Wrap with `useShallow` from `zustand/react/shallow`, or compute `generateInsights` lazily with `useMemo` keyed only on the slices it consumes (`weights`, `meals`, `symptoms`, `workouts`, `water`, `mood`, `supplements`, `vials`, `user`).

**Photo storage is base64-in-localStorage, capped by 5-10 MB browser quota:**
- Problem: `BodyTab.onPhoto` resizes to max 600 px JPEG @ 0.7 quality and stores the data URL inside the persisted Zustand store. ~120 KB per photo at typical sizes. With photos every 2 weeks for a year, that's ~3.1 MB just for photos before any other state, all serialized into the same `leanshot_v4` localStorage key. Approaching the 5 MB Safari limit will silently drop the next persist call.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/BodyTab.tsx:87-109`, `/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts:228` (persist with `localStorage` storage)
- Cause: `persist` middleware writes the entire serialized state on every change.
- Improvement path: Move photos to IndexedDB (e.g. `idb-keyval`), reference them by id from the store. This also speeds up every persist round-trip since the JSON shrinks dramatically.

## Fragile Areas

**Storage migration & dual-rehydration:**
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts:251-282`, `/Users/karstenhaldan/minisite/leanshot/src/lib/storage.ts:77-109`
- Why fragile: The `migrate` callback inside `persist({...})` and the manual `hydrate()` helper both attempt to read v3 → v4. They invoke `migrateFromV3()` independently, and `migrateFromV3` deletes the legacy key on first call. The order of execution depends on whether persist has already rehydrated from v4 or not. Comments in `store.ts:267-274` acknowledge the workaround.
- Safe modification: Treat this code as load-bearing for existing v1 users. Any change must be paired with a unit test that asserts: (a) v3 with no v4 → v4 populated; (b) v4 only → unchanged; (c) v3 + v4 → v4 wins; (d) corrupted v3 → no data loss, no crash.
- Test coverage: Zero tests today.

**`BaseChart` re-creation on theme change is bypassed by ESLint suppression:**
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/charts/BaseChart.tsx:29-46`
- Why fragile: The first `useEffect` deliberately omits `config` from its deps with `// eslint-disable-next-line react-hooks/exhaustive-deps`, relying on the second `useEffect` to push config updates. If the underlying Chart.js minor release changes how `chart.update('none')` reacts to dataset replacement, charts can desync.
- Safe modification: Move chart instance management into a custom hook `useChart(canvasRef, config, deps)` that takes explicit primitive-only deps; remove the ESLint disable.
- Test coverage: Zero — Chart.js is mocked nowhere.

**Tour selectors are stringified DOM queries:**
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tour/GuidedTour.tsx:18-56`
- Why fragile: Tour relies on `[data-tour="hero"]`, `[data-tour="glp"]`, `[data-tour="focus"]`, `[data-tour="sites"]`, `[data-tour="symptoms"]`, `[data-tour="nav"]`, `[data-tour="mobile-nav"]` markers spread across multiple components. Renaming or accidentally removing one breaks the tour silently — `compute()` short-circuits with `setPosition(null)` and the tooltip just disappears.
- Safe modification: Extract markers into `lib/tour-markers.ts` with named constants, and add a `tour:assert-targets` script that scans both the constants file and the JSX for `data-tour=` and fails on mismatch. At minimum, `console.warn` when a target is missing in dev.
- Test coverage: Zero.

**`SwipeToDelete` resets via `setTimeout(onDelete, 200)` after CSS animation:**
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/ui/SwipeToDelete.tsx:38-43`
- Why fragile: If `onDelete` is async or unmounts the parent before the timeout fires, React 19 may warn about state updates on unmounted components. Also: the delete fires before the animation finishes, leaving a half-frame flash.
- Safe modification: Listen to `transitionend` on the inner div instead of a fixed 200 ms.
- Test coverage: Zero.

**Topbar `handleSearch` is a hardcoded keyword router:**
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/layout/Topbar.tsx:21-41`
- Why fragile: Adding a new tab requires adding an entry to the keyword map; missing one means the search box silently fails for that domain. The map is also case-insensitive but uses substring matches — typing `mode` jumps to `mood` which is fine, typing `meal` jumps to nutrition, but typing `wing` jumps to `wins` because of the substring rule.
- Safe modification: Convert to a typed `Record<TabId, string[]>` of keywords keyed by destination, with longest-match-wins ordering.

## Scaling Limits

**Zustand persist serializes the entire state on every action:**
- Current capacity: ~5-10 MB per origin (browser-dependent). With 3.5 MB of photos a typical year-1 power user has headroom; year 2 starts hitting the cap.
- Limit: First write that exceeds quota throws `QuotaExceededError`. Zustand persist swallows this — there is no `onPersistError` handler in `lib/store.ts:226-260`. The user simply stops persisting silently.
- Scaling path: Move photos and `aiHistory` (which can grow unbounded) to IndexedDB, keep only metadata in localStorage. Add a quota warning UI when approaching 80% of available space.

**`aiHistory` grows unbounded:**
- Current capacity: Effectively unbounded — every assistant + user message is appended.
- Limit: Eventually hits localStorage quota. Long-running users who chat daily will accumulate hundreds of KB.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts:223` (`appendAI`), `:88` (no truncation)
- Scaling path: Cap at last N messages (e.g. 50) on append; expose a "clear conversation" button (already exists at `AIChatPanel.tsx:113-117`) but also auto-trim.

**`useStreaks.calc` walks 365 days for every streak slice:**
- Current capacity: ~365 iterations × 4 streak types = 1,460 predicate evaluations per recompute. Each predicate scans the full `weights` / `meals` / `supplements` collection.
- Limit: Quadratic with respect to (days × entries). For a year-2 user with ~700 meals, ~2,000 weights, ~700 supplement days → ~1M comparisons per re-render of any consumer.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/hooks/useStreaks.ts:17-28`
- Scaling path: Index entries by date once (`Map<string, Entry[]>`) before walking the day list.

## Dependencies at Risk

**Tailwind CSS v4 beta:**
- Risk: `tailwindcss@4.0.0-beta.7` and `@tailwindcss/vite@4.0.0-beta.7` are *beta* releases. v4 introduced breaking changes around the `@theme` directive, CSS-first config, and the Vite plugin entry point. Beta APIs can shift between releases. The actually-installed version is `4.3.0` (per `node_modules/tailwindcss/package.json`), which is post-beta — so the package.json range is loose enough to drift further on the next `npm install`.
- Impact: A `npm install` from scratch may fetch a Tailwind release that breaks `@theme` semantics inside `/Users/karstenhaldan/minisite/leanshot/src/index.css:11-153`, causing the entire design-token system to fail.
- Migration plan: Pin to a stable v4 minor (`"tailwindcss": "4.3.0"` exact), regenerate `package-lock.json`, and add a brief Tailwind v4 upgrade note in the README before bumping.

**React 19:**
- Risk: React 19.0.0 GA's breaking changes (removed legacy context, removed `defaultProps` on function components, stricter ref semantics, changed `useEffect` cleanup semantics in StrictMode for `useReducer`). Installed version is 19.2.6.
- Impact: Several patterns in the codebase rely on React 18-style assumptions:
  - `BaseChart` uses two effects with carefully-staged StrictMode-safe destruction (`/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/charts/BaseChart.tsx:29-46`). If React 19's double-invocation behaviour ever changes, the chart could leak Chart.js instances.
  - `framer-motion@11.11.17` peers `react@^18.0.0 || ^19.0.0` — supported on paper, but framer-motion 11's animation behavior under React 19's stricter Suspense semantics has had bug reports upstream.
- Migration plan: Subscribe to React 19 changelog. Add a smoke test that mounts/unmounts each major chart twice in StrictMode and asserts no `Chart` instance leaks.

**framer-motion@11:**
- Risk: framer-motion 12 has shipped (rebranded as "Motion"), with API changes around `LayoutGroup`, `useInView`, and reduced-motion handling. v11 will eventually fall out of active maintenance.
- Impact: Sites/pages using `motion.div` initial/animate/exit (`AIChatPanel.tsx`, `Modal.tsx`, `OnboardingFlow.tsx`, `Landing.tsx`, `GuidedTour.tsx`) would all need a single-pass migration when v12 is adopted.
- Migration plan: Track Motion 12 release notes; the project's pattern is conservative enough that the migration should be mechanical.

**`@types/node@25`:**
- Risk: `@types/node` v25 corresponds to Node 25 type definitions, while the project does not actually run on Node 25 (Vite's stated minimum is 18+). Mismatch can cause `tsc -b` to flag APIs that exist in types but not in the runtime Node.
- Files: `/Users/karstenhaldan/minisite/leanshot/package.json:23`
- Impact: Low today (the only Node code is `vite.config.ts`).
- Migration plan: Pin `@types/node` to the LTS version being used by the deploy target.

**`@use-gesture/react@10`:**
- Risk: Active. peerDeps `react >= 16.8.0` — wide compatibility. Low risk.

**`zustand@5`:**
- Risk: Zustand 5 made some persist API tweaks (`createJSONStorage` is now required; `partialize` semantics tightened). Code already uses the new patterns (`/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts:96-260`). Low risk.

**Anthropic API versioning header `'anthropic-version': '2023-06-01'`:**
- Risk: Pinning a 2023 API version inside `/Users/karstenhaldan/minisite/leanshot/src/lib/ai.ts:56`. Anthropic regularly publishes new API versions; eventually the 2023-06-01 surface will be deprecated.
- Impact: Future deprecation breaks every AI call.
- Migration plan: Track `anthropic-version` deprecation announcements; bump and test against the current `messages` API contract.

## Missing Critical Features

**No server-side proxy for the AI key:**
- Problem: As described in "Security Considerations," the BYO-key + browser-direct architecture is structurally insecure even when implemented correctly.
- Blocks: Pro tier monetization (per `Landing.tsx:323-331` "Pro" includes "AI coach with full context"). If LeanShot ever charges for AI, the per-user-key model cannot collect revenue and cannot rate-limit.

**No real auth / multi-device sync:**
- Problem: All data lives in a single browser's localStorage. There is no account, no export-to-cloud beyond the manual JSON download.
- Blocks: "Apple Health import" Pro feature (`Landing.tsx:329`) implies cross-device sync; today it's still local. The app cannot recover from a cleared browser cache without manual JSON re-import.

**No telemetry / error reporting:**
- Problem: When the AI call fails, `MissingAPIKeyError` and generic errors surface as toasts, but failures upstream of the UI (e.g. a chart render bug, a Zustand persist quota error) are silent.
- Blocks: Debugging in the wild. Every issue requires a user to manually copy-paste a console log.

**No `<noscript>` fallback or SSR:**
- Problem: `index.html` is a vanilla SPA shell with `<div id="root"></div>` and no fallback content. SEO depends entirely on the `<title>` and `<meta>` tags.
- Files: `/Users/karstenhaldan/minisite/leanshot/index.html`
- Blocks: Search-indexing of marketing landing copy and FAQ content.

**No PWA / install prompt / offline:**
- Problem: Despite the "local-only data" pitch, the app does not register a service worker. Going offline mid-session works (everything is in localStorage), but the *initial* load needs network.
- Blocks: True offline-first promise; iOS home-screen install with offline support.

**Missing accessibility coverage:**
- `<img>` tags with empty `alt=""` for user-uploaded photos (`/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/BodyTab.tsx:215`, `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/modals/PhotoCompareModal.tsx:66`, `:83`) — defensible (decorative-by-policy) but no captioning option for screen readers.
- Color-only signals: vial card uses `text-[var(--color-warning)]` to signal "expiring vial" without an icon for color-blind users (`/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/MedicationTab.tsx:165-176`).
- The Settings nav switches sections via JS click handlers without a `<nav>` keyboard-navigation pattern (arrow keys jump between tabs in proper tablists). A11y is "good enough" but not WCAG 2.1 AA conformant.
- Native `confirm()` dialogs (Settings reset, AI clear) bypass focus management entirely; keyboard users are dropped into a blocking system dialog with no return-focus guarantee.

## Test Coverage Gaps

**Pharmacology and insights engines are completely untested:**
- What's not tested: `calcMedLevel`, `HALF_LIVES`, `TITRATION`, `TRIAL_DATA`, `trialClass`, `medLabel*` in `pharmacology.ts`. `generateInsights`, `pickFocus` in `insights.ts`. `useStreaks.calc` in `hooks/useStreaks.ts`.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/pharmacology.ts`, `/Users/karstenhaldan/minisite/leanshot/src/lib/insights.ts`, `/Users/karstenhaldan/minisite/leanshot/src/hooks/useStreaks.ts`
- Risk: These are pure functions whose output is rendered to a user as quasi-clinical content. A typo in a half-life value or a sign error in `calcMedLevel` would produce subtly wrong med-level curves that users may show their doctors. There's no test to catch a regression.
- Priority: **High.**

**Storage migration is untested:**
- What's not tested: `migrateFromV3`, `hydrate`, the four-way matrix of (v3 present|absent) × (v4 present|absent).
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/storage.ts`, `/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts:251-282`
- Risk: Existing v1 users only get one chance to migrate. A regression silently destroys their entire history.
- Priority: **High.**

**Onboarding flow has no integration test:**
- What's not tested: Seven-step `OnboardingFlow`, including the `complete()` mapping from `DraftState` → persisted `User`, and the auto-derived `proteinFromBody` / `calorieBase` defaults.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/onboarding/OnboardingFlow.tsx:75-117`
- Risk: A change to `User` interface fields can silently break onboarding for new users.
- Priority: **High.**

**AI client is untested:**
- What's not tested: `callAnthropic`, `MissingAPIKeyError`, response shape parsing in `lib/ai.ts`.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/ai.ts`
- Risk: Every Claude API change is detected only by users in production.
- Priority: **Medium.**

**Apple Health import regex parsers are untested:**
- What's not tested: `importHealth` in `ActivityTab.tsx`. The function uses two complex regexes against XML and a CSV-shape heuristic.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/ActivityTab.tsx:53-104`
- Risk: A user uploads an export, sees a toast "Imported 0 steps, 0 weights" with no diagnostic. False sense of integration.
- Priority: **Medium.**

**Share-card canvas rendering is untested:**
- What's not tested: `boldTemplate.draw`, `minimalTemplate.draw`, `milestoneTemplate.draw`, the `wrapText` helper and `roundRect` helper.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/lib/share-card/*.ts`
- Risk: Rendering glitches per template; visual regression. Hard to test purely (canvas is a DOM API), but golden-image tests via `node-canvas` are tractable.
- Priority: **Low.**

**SwipeToDelete gesture handler is untested:**
- What's not tested: Threshold logic, reduced-motion guard, animation reset.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/ui/SwipeToDelete.tsx`
- Risk: Swipe is the only delete affordance on mobile photos and weight rows. Regression here is invisible to keyboard users.
- Priority: **Medium.**

**No visual regression / Storybook:**
- What's not tested: Every UI primitive in `src/components/ui/` lacks isolated rendering tests. `Card`, `Button`, `Input`, `Modal`, `Toast`, `Sheet`, `Sparkline`, `ProgressRing`, `Badge`, `Pill`, `EmptyState`, `Skeleton`, `SwipeToDelete`.
- Files: `/Users/karstenhaldan/minisite/leanshot/src/components/ui/`
- Risk: Design-system regressions only surface during manual review.
- Priority: **Low** for unit, **Medium** for visual.

---

*Concerns audit: 2026-05-10*
