---
phase: 42-v1-3-polish-closeout
plan: "04"
subsystem: pwa
tags: [pwa, vite-plugin-pwa, workbox, service-worker, offline, install-prompt, hipaa]

# Dependency graph
requires:
  - phase: 42-01
    provides: phase entry conditions accepted (npm:web-push spike) — POLISH-07 unblocked.
provides:
  - vite-plugin-pwa@1.3.0 wired in `injectManifest` strategy with HIPAA-safe runtime caching.
  - Custom service worker source `leanshot/src/sw.ts` that 42-08 will extend with a push event listener.
  - Lazy SW registration via `@/lib/pwa/register` (dynamic import from App.tsx; Pitfall 9 mitigated).
  - 3-state branded deferred install prompt (fresh / snoozed / dismissed / installed) per Pitfall 2.
  - OfflineBanner mounted globally; `disableLogging()` gate ready for Wave 3 logging surfaces.
  - Capacitor shim seam (`@/lib/native/capacitor-shim`) so v1.4 mobile shell plugs in without touching PWA code.
  - Test hooks: `window.__leanshot_pwa_ready`, `window.__leanshot_simulate_install_prompt`, `leanshot:install-prompt-tick` event.
affects:
  - 42-08 (push notifications) — will add a `push` event listener inside `src/sw.ts`.
  - Wave 3 logging surfaces (injection / weight / symptom / workout) — consume `disableLogging()`.
  - v1.4 Capacitor phase — hooks into the shim seam without touching this PWA code.

# Tech tracking
tech-stack:
  added:
    - "vite-plugin-pwa ^1.3.0"
    - "workbox-window ^7.4.1"
    - "workbox-precaching ^7.4.1"
    - "workbox-routing ^7.4.1"
    - "workbox-strategies ^7.4.1"
    - "workbox-expiration ^7.4.1"
    - "@vite-pwa/assets-generator ^1.0.2"
  patterns:
    - "injectManifest strategy (over generateSW) so the SW source file owns ALL background behavior — required because 42-08 extends it with a push event listener."
    - "Lazy SW registration via Promise.all of dynamic imports in App.tsx useEffect (Pitfall 9 — workbox-window stays off the index chunk)."
    - "Explicit URL allowlist for runtime cache (HIPAA Pitfall 1 — never a broad `supabase.co/rest/v1/.*` glob)."
    - "3-state install-prompt machine, where `installed` is only set on `appinstalled` OR matchMedia('(display-mode: standalone)') (Pitfall 2 — never on Maybe-later)."
    - "Capacitor shim as an architectural seam (per feedback_scaffolding_for_deferred_mobile_pattern)."

key-files:
  created:
    - "leanshot/src/sw.ts"
    - "leanshot/src/lib/pwa/register.ts"
    - "leanshot/src/lib/pwa/install-prompt.ts"
    - "leanshot/src/lib/pwa/offline-store.ts"
    - "leanshot/src/lib/pwa/register.test.ts"
    - "leanshot/src/lib/native/capacitor-shim.ts"
    - "leanshot/src/hooks/useOfflineState.ts"
    - "leanshot/src/hooks/useInstallPrompt.ts"
    - "leanshot/src/components/pwa/OfflineBanner.tsx"
    - "leanshot/src/components/pwa/InstallPromptCard.tsx"
    - "leanshot/e2e/pwa-offline.spec.ts"
    - "leanshot/e2e/pwa-install-prompt.spec.ts"
    - "leanshot/public/pwa-source.svg"
    - "leanshot/public/pwa-{64,192,512}x{...}.png + apple-touch-icon{,-180x180}.png + maskable-icon-512x512.png + favicon.ico"
    - "leanshot/pwa-assets.config.ts"
    - "leanshot/.planning/phases/42-v1-3-polish-closeout/deferred-items.md"
  modified:
    - "leanshot/vite.config.ts (VitePWA plugin wired before Sentry plugin per Sentry-must-be-last guidance)"
    - "leanshot/src/App.tsx (PWA bootstrap useEffect + globalOverlays mount of OfflineBanner + InstallPromptCard)"
    - "leanshot/src/components/dashboard/tabs/HomeTab.tsx (recordDashboardVisit + tick on mount)"
    - "leanshot/src/vite-env.d.ts (vite-plugin-pwa/client reference + ServiceWorkerGlobalScope.__WB_MANIFEST)"
    - "leanshot/scripts/assert-bundle-budget.sh (Rule 3 auto-fix — hash-hyphen regex bug)"
    - "leanshot/package.json + package-lock.json (devDependencies)"

key-decisions:
  - "injectManifest over generateSW — required because 42-08 needs to add a push event listener INSIDE the SW context; generateSW does not support arbitrary listeners."
  - "Explicit allowlist for Supabase API runtime cache: only /rest/v1/(kb_articles|changelog_entries|status_components). PHI-bearing endpoints pass through to network on every request (HIPAA Pitfall 1)."
  - "skipWaiting: false (D-17) — user controls update via toast; src/sw.ts handles client-posted SKIP_WAITING message."
  - "OfflineBanner mounted in globalOverlays (visible on every view); InstallPromptCard also globally mounted because it self-gates internally on engagement signals."
  - "Capacitor shim returns false when SDK absent — PWA registers on plain web; v1.4 phase hooks in via this seam without touching PWA code."

patterns-established:
  - "PWA glue lazy-loaded via Promise.all of dynamic imports in App.tsx useEffect — index chunk stays inside its 50 kB gz ceiling."
  - "TEST HOOKs documented inline as `/* TEST HOOK — leanshot e2e/... */`: __leanshot_pwa_ready, __leanshot_simulate_install_prompt, leanshot:install-prompt-tick event."

requirements-completed:
  - POLISH-07

# Metrics
duration: ~22min
completed: 2026-05-19
---

# Phase 42 Plan 04: PWA Service Worker Base Summary

**vite-plugin-pwa 1.3.0 (injectManifest) wired with a HIPAA-safe runtime cache allowlist, lazy SW registration, a 3-state branded install prompt, and an offline banner that gates Wave-3 logging — all under the 50 kB index ceiling.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-05-19T08:50Z (approx.)
- **Completed:** 2026-05-19T09:12Z
- **Tasks:** 3 of 3 completed
- **Files modified / created:** 29 (across 4 commits)

## Accomplishments

- vite-plugin-pwa 1.3.0 fully integrated in `injectManifest` mode; `npm run build` emits `dist/sw.js` (24.67 kB / 8.12 kB gz) + `dist/manifest.webmanifest`; precaches 99 entries.
- HIPAA-safe runtime cache: explicit URL allowlist for the three public-read tables (`kb_articles`, `changelog_entries`, `status_components`) using `NetworkFirst` (3s timeout, 5 min TTL); image / font assets use `CacheFirst` (1 d TTL). Never a broad `supabase.co/rest/v1/.*` glob (Pitfall 1).
- Lazy SW registration via Promise.all of dynamic imports inside App.tsx `useEffect`; index chunk stays at 21.42 kB gz (well under the 50 kB ceiling, Pitfall 9 effective).
- 3-state install prompt state machine (fresh → snoozed → dismissed → installed) backed by `leanshot_install_state_v1` in localStorage; "Maybe later" sets `snoozed_until = now + 30 d`; `installed` is set ONLY on `appinstalled` OR matchMedia(`(display-mode: standalone)`) — never on Maybe-later (Pitfall 2).
- OfflineBanner mounted globally via `globalOverlays`; `disableLogging()` gate exposed for Wave-3 logging surfaces. Banner text is verbatim D-13: "You're offline — logging resumes when reconnected."
- Capacitor shim seam established at `@/lib/native/capacitor-shim` so the v1.4 mobile shell can hook in without touching Plan 42-04 code (per `feedback_scaffolding_for_deferred_mobile_pattern`).
- 6 vitest unit tests + 4 Playwright e2e tests passing.

## Task Commits

Each task was committed atomically (per-commit pwd-drift guard not required — this run executes on `main` directly, not a worktree):

1. **Task 1: Install vite-plugin-pwa, generate icons, wire vite.config.ts + src/sw.ts** — `cffc97f` (feat)
2. **Task 2 RED: failing tests for register + install-prompt** — `c3241f7` (test)
2. **Task 2 GREEN: lazy SW register, capacitor shim, hooks, components, App.tsx wiring** — `e990329` (feat)
3. **Task 3: Playwright e2e for offline banner + install prompt deferral** — `c6a4818` (test)

_TDD: Task 2 split into RED (`c3241f7`) + GREEN (`e990329`). Task 3 GREEN-first because its implementation landed alongside Task 2; e2e tests confirm behavior end-to-end._

## Files Created/Modified

### Created
- `leanshot/src/sw.ts` — custom SW source consumed by `injectManifest`. Owns precaching, runtime cache routing, and the SKIP_WAITING message handler. Reserved slot for 42-08's `push` listener.
- `leanshot/src/lib/pwa/register.ts` — `initializePWA(onUpdate)` that early-returns in Capacitor (D-18) and wires `registerSW({ onNeedRefresh, onOfflineReady })` (D-17).
- `leanshot/src/lib/pwa/install-prompt.ts` — 3-state machine + localStorage persistence + beforeinstallprompt capture + appinstalled / standalone listeners. Exports `recordDashboardVisit`, `shouldShowCard`, `triggerInstallPrompt`, `maybeLater`, `dismiss`, `__resetForTests`.
- `leanshot/src/lib/pwa/offline-store.ts` — pub/sub store driven by `navigator.onLine` + `'online'/'offline'` window events. Exports `disableLogging()` for Wave-3 logging surfaces.
- `leanshot/src/lib/pwa/register.test.ts` — 6 vitest unit tests (Test 1-3 + Test 4a/4b + Test 5).
- `leanshot/src/lib/native/capacitor-shim.ts` — `Capacitor.isNativePlatform()` runtime sniff that returns false when SDK absent.
- `leanshot/src/hooks/useOfflineState.ts` + `useInstallPrompt.ts` — thin React hooks; `useInstallPrompt` exposes `{show, install, later, dismiss}` and listens for `beforeinstallprompt`, `appinstalled`, and the synthetic `leanshot:install-prompt-tick` event.
- `leanshot/src/components/pwa/OfflineBanner.tsx` — top-fixed banner, `role="status" aria-live="polite"`, verbatim D-13 copy.
- `leanshot/src/components/pwa/InstallPromptCard.tsx` — bottom-fixed branded card with Install + Maybe later buttons.
- `leanshot/e2e/pwa-offline.spec.ts` + `pwa-install-prompt.spec.ts` — 4 Playwright e2e tests (e2e-1..4).
- `leanshot/public/pwa-source.svg` + 7 generated PNG assets (`pwa-{64,192,512}x{...}.png`, `maskable-icon-512x512.png`, `apple-touch-icon{,-180x180}.png`, `favicon.ico`) via `@vite-pwa/assets-generator` minimal-2023 preset.
- `leanshot/pwa-assets.config.ts` — asset-generator config so the command can be re-run as `npx pwa-assets-generator` (zero args).
- `leanshot/.planning/phases/42-v1-3-polish-closeout/deferred-items.md` — pre-existing admin-shell bundle overage documented for Phase 24 owner.

### Modified
- `leanshot/vite.config.ts` — `VitePWA({...})` plugin inserted BEFORE the sentryVitePlugin block (which must remain last per existing guidance); `injectManifest` + `injectRegister:false` + manifest definition + workbox `{skipWaiting:false, clientsClaim:true}`. Inline comment documents the HIPAA allowlist contract.
- `leanshot/src/App.tsx` — added a PWA bootstrap `useEffect` (3 dynamic imports + initializers + `window.__leanshot_pwa_ready` test hook). Moved OfflineBanner + InstallPromptCard into `globalOverlays` Suspense block so they appear on every view (both self-gate internally).
- `leanshot/src/components/dashboard/tabs/HomeTab.tsx` — `useEffect` that lazy-imports install-prompt + useInstallPrompt and calls `recordDashboardVisit()` + `notifyInstallPromptTick()` on mount.
- `leanshot/src/vite-env.d.ts` — added `/// <reference types="vite-plugin-pwa/client" />` so `virtual:pwa-register` resolves in tsc, plus a local declaration of `ServiceWorkerGlobalScope.__WB_MANIFEST` for sw.ts.
- `leanshot/scripts/assert-bundle-budget.sh` — Rule 3 auto-fix (see Deviations below).
- `leanshot/package.json` + `package-lock.json` — devDependency additions.

## Verification

- ✅ `npx vitest run src/lib/pwa/register.test.ts` — **6 / 6 pass** (Capacitor early-return + onNeedRefresh + onUpdate fire-through + maybeLater 30d + appinstalled non-downgrade + shouldShowCard gating).
- ✅ `npx playwright test e2e/pwa-offline.spec.ts e2e/pwa-install-prompt.spec.ts --project=chromium` — **4 / 4 pass** in ~3.3 s.
- ✅ `npx tsc -b --noEmit` — clean.
- ✅ `npm run build` — emits `dist/sw.js` + `dist/manifest.webmanifest`; `sw.mjs` source is 24.67 kB / 8.12 kB gz; precache covers 99 entries (3362.90 KiB).
- ✅ `npm run check-bundle-budget` — `index` chunk reports **21.42 kB gz / 50 kB ceiling = OK** (Pitfall 9 mitigation working). `admin-shell` pre-existing overage tracked in deferred-items.md and verified absent on `main` BEFORE this plan via `git stash` → check → `git stash pop`.
- ✅ Plan verify grep — `grep -q "VitePWA" vite.config.ts && grep -q "skipWaiting: false" vite.config.ts && grep -E "kb_articles|changelog_entries|status_components" vite.config.ts && ls public/pwa-192x192.png public/pwa-512x512.png public/apple-touch-icon.png && ls dist/sw.js` — all green.
- ✅ Done criterion — `grep -c "import('@/lib/pwa/register')" src/App.tsx` = **1**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `scripts/assert-bundle-budget.sh` hash-hyphen regex bug**
- **Found during:** Task 2 (`npm run check-bundle-budget` after adding the PWA lazy imports).
- **Issue:** Vite content hashes use the base64url charset which INCLUDES `-`. The script's regex was `${chunk}-[A-Za-z0-9_]{8,}\.js$` (no hyphens). This build produced `index-BIGRN-KO.js`; the script reported `index MISSING` and the 50 kB ceiling was silently un-enforced. Pre-existing latent bug (the parallel `assert-clinic-bundle-budget.sh` was fixed by Plan 10-11 for the same root cause — see memory `reference_bundle_budget_hash_hyphen`).
- **Fix:** Widened the hash class to `[A-Za-z0-9_-]` and tightened the length to exactly 8 (`{8}`) to prevent false-positives across chunk prefixes (e.g. `clinic-` would otherwise greedy-match `clinic-invite-XXXXXXXX.js`).
- **Files modified:** `leanshot/scripts/assert-bundle-budget.sh`
- **Commit:** `e990329`

**2. [Rule 2 — Missing critical functionality] Install-prompt e2e race condition**
- **Found during:** Task 3 first e2e run (`e2e-1` failed: banner did not appear after `context.setOffline(true)`).
- **Issue:** App.tsx's PWA bootstrap useEffect chains 3 dynamic imports before `initializeOfflineStore()` installs window 'online'/'offline' listeners. Playwright's `setOffline()` raced ahead of that init, so the banner never re-rendered.
- **Fix:** Added a `window.__leanshot_pwa_ready` flag set inside the same useEffect AFTER all three modules initialize; e2e tests `waitForFunction(() => __leanshot_pwa_ready === true)` before invoking `setOffline()`. Documented inline as a TEST HOOK — not consumed by app code.
- **Files modified:** `leanshot/src/App.tsx`, `leanshot/e2e/pwa-offline.spec.ts`
- **Commit:** `c6a4818`

**3. [Rule 2 — Missing critical functionality] `recordDashboardVisit` wiring**
- **Found during:** Task 2 implementation (the install-prompt state machine has `recordDashboardVisit()` but the plan didn't specify a call site).
- **Issue:** Without a call site, the 3rd-dashboard-visit gate is dead code.
- **Fix:** Added a `useEffect` to `HomeTab.tsx` that dynamic-imports `@/lib/pwa/install-prompt` + `@/hooks/useInstallPrompt` and calls `recordDashboardVisit()` + `notifyInstallPromptTick()` on mount. The plan implicitly required this ("Dashboard-visit count is a separate localStorage key incremented by `recordDashboardVisit()` called from HomeTab mount").
- **Files modified:** `leanshot/src/components/dashboard/tabs/HomeTab.tsx`
- **Commit:** `e990329`

### Auth Gates

None.

### Pre-existing Issues (Out of Scope)

- **admin-shell chunk overage (105.50 kB gz vs 45 kB ceiling).** Verified present on `main` BEFORE this plan via `git stash` → check → `git stash pop`. Tracked in `leanshot/.planning/phases/42-v1-3-polish-closeout/deferred-items.md`. Phase 24 / a future debt-burn plan owns the remediation track.

## Known Stubs

None. Every component renders functionally; OfflineBanner self-gates on online state, InstallPromptCard self-gates on visits / state. No placeholder data or "coming soon" text.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| _none_ | — | All threat-model trust boundaries already covered by `<threat_model>` in the plan: T-42-04-01 (HIPAA URL allowlist in src/sw.ts), T-42-04-02 (3-state install machine in install-prompt.ts), T-42-04-03 (devOptions.enabled:false in vite.config.ts), T-42-04-04 (lazy import in App.tsx; index chunk verified 21.42 kB gz), T-42-04-SC (deps verified legitimate per RESEARCH §Package Legitimacy). |

## TDD Gate Compliance

- ✅ Test commit (`c3241f7`) precedes implementation commit (`e990329`) — RED → GREEN sequence visible in `git log`.
- ✅ All RED tests subsequently passed under the GREEN implementation.
- ✅ Per-task verify commands documented above all pass.

## Bundle Ceiling Impact

| Chunk | Ceiling (kB gz) | Before | After | Status |
|-------|----------------|--------|-------|--------|
| `index` | 50 | 21.06 | 21.42 | OK (+0.36 kB — the App.tsx useEffect adds the dynamic-import wrapper, but the workbox-window glue + components live in their own lazy chunks). |

PWA chunks emitted:
- `register-<hash>.js` (Pitfall 9 — workbox-window kept off the index chunk)
- `install-prompt-<hash>.js`
- `offline-store-<hash>.js`
- `OfflineBanner-<hash>.js`
- `InstallPromptCard-<hash>.js`
- `dist/sw.js` (24.67 kB / 8.12 kB gz) — service worker (separate from app bundle).

## Self-Check: PASSED

- ✅ All 16 plan-tracked files exist on disk.
- ✅ All 4 task commits present in `git log`: `cffc97f`, `c3241f7`, `e990329`, `c6a4818`.
