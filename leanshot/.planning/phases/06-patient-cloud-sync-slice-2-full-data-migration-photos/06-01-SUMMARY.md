---
phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos
plan: 01
subsystem: build-tooling
tags: [bundle-size, sync-defer, prefers-reduced-motion, CI, D-12]
requires:
  - "@/lib/telemetry-defer.ts (Phase 2.1 — pattern source)"
  - "@/lib/sync (Phase 5 — dynamically imported)"
  - "@/lib/auth-migration (Phase 5 — dynamically imported)"
  - "@/lib/supabase (Phase 4/5 — dynamically imported)"
  - "scripts/assert-vendor-react-size.sh (Phase 2.1 — CI guard)"
provides:
  - "@/lib/sync-defer (deferred-init wrapper + FIFO buffer)"
  - "Toast.durationMs?: number extension (UI-CHECK N4)"
  - "Skeleton prefers-reduced-motion class hook (UI-CHECK N5)"
  - "MedLevelChart null-user guard (06-CONTEXT D-12 #3)"
affects:
  - "src/App.tsx (rewired to sync-defer)"
  - "src/main.tsx (scheduleSyncInit post-render)"
  - "src/lib/store.ts (signOut dyn-import + deferFlush)"
  - "src/components/auth/EmailVerificationBanner.tsx (dyn-import resendVerification)"
tech-stack:
  added: []
  patterns:
    - "Pattern 6 (sync-defer) mirrors src/lib/telemetry-defer.ts: FIFO pre-init buffer (cap 64) + window.requestIdleCallback (setTimeout fallback)"
    - "Type-only namespace import (`import type * as Module from '@/lib/...'`) for compile-time-erased type references to dynamically-imported modules"
key-files:
  created:
    - path: "src/lib/sync-defer.ts"
      purpose: "Phase 6 D-12 CI hardening — FIFO pre-init buffer + idle-scheduled dynamic-import of @/lib/sync + @/lib/auth-migration; exposes deferOnSignedIn/Out/Flush/SetLastWasAnon + scheduleSyncInit + subscribeAuthStateChanges + autoMintAnonSessionIfMissing + _resetForTests."
    - path: "src/lib/sync-defer.test.ts"
      purpose: "6 vitest cases locking buffer/drain semantics + idle-vs-setTimeout fallback + _resetForTests isolation."
  modified:
    - path: "src/App.tsx"
      change: "Drop eager imports of @/lib/sync, @/lib/auth-migration, @/lib/supabase. Route INITIAL_SESSION / SIGNED_IN / SIGNED_OUT / online-listener / auto-anon-mint through sync-defer wrappers."
    - path: "src/main.tsx"
      change: "Add `scheduleSyncInit()` after `createRoot.render()` (adjacent to deferSentryInit + deferAnalyticsInit)."
    - path: "src/lib/store.ts"
      change: "Drop eager imports of @/lib/auth + @/lib/sync. signOut action dyn-imports @/lib/auth; addInjection / editInjection / removeInjection route fire-and-forget flush through deferFlush(). Toast state shape gains durationMs?: number; showToast action signature adds optional 3rd arg."
    - path: "src/lib/store.test.ts"
      change: "Add 3 vitest cases for showToast durationMs (writes-through, undefined back-compat, positional 2-arg back-compat)."
    - path: "src/components/ui/Toast.tsx"
      change: "setTimeout honors `toast.durationMs ?? 2400` (UI-CHECK N4)."
    - path: "src/components/ui/Skeleton.tsx"
      change: "Add `skeleton-shimmer` className to root so the global reduced-motion rule can target it (UI-CHECK N5)."
    - path: "src/index.css"
      change: "Append `.skeleton-shimmer { animation: none !important; }` inside the existing @media (prefers-reduced-motion: reduce) block (UI-CHECK N5)."
    - path: "src/components/dashboard/charts/MedLevelChart.tsx"
      change: "Replace `useStore((s) => s.user!)` with nullable selector + useMemo short-circuit + post-hook `if (!u) return null;` (06-CONTEXT D-12 #3 / Rules of Hooks compliant)."
    - path: "src/components/auth/EmailVerificationBanner.tsx"
      change: "Dyn-import `resendVerification` inside onResend handler so AppShell's eager mount of this banner does NOT pull @/lib/auth onto the entry static graph."
decisions:
  - "Pattern A (subscribeAuthStateChanges helper) chosen over Pattern B (Supabase type-only import in App.tsx). Cleaner: sync-defer.ts owns ALL supabase-touching code paths, matching 06-RESEARCH §Pattern 6."
  - "store.ts had to be deferred too. Plan listed only App.tsx, main.tsx + 06-CONTEXT items, but the actual bundle measurement showed store.ts (transitive import of @/lib/auth and @/lib/sync) was a load-bearing source of the static-graph leak. Deviation (Rule 3) auto-fixed inline."
  - "EmailVerificationBanner.tsx was a second hidden eager-load path (AppShell mounts it eagerly; static `import { resendVerification } from '@/lib/auth'` leaked supabase back onto the entry graph). Deviation (Rule 3) auto-fixed."
  - "Type-only namespace imports (`import type * as SyncModule from '@/lib/sync'`) preferred over `typeof import(...)` to satisfy @typescript-eslint/consistent-type-imports. Type-imports are erased under verbatimModuleSyntax, so the module graph is unchanged."
metrics:
  duration_minutes: 14
  completed: "2026-05-12T05:08:58Z"
  tasks_completed: 4
  files_created: 2
  files_modified: 9
  commits: 4
  tests_added: 9
  tests_total_passing: 323
---

# Phase 6 Plan 01: D-12 CI Hardening (sync-defer + Toast/Skeleton/MedLevelChart fold-ins) Summary

**One-liner:** Inverts App.tsx → sync/auth-migration/supabase dependency via an idle-scheduled FIFO-buffer wrapper (modeled on Phase 2.1's telemetry-defer) so the entry chunk gzip drops from 72.6 kB to 18.1 kB (well under the 50 kB Phase 2.1 CI ceiling); folds in three latent fixes (Toast durationMs, Skeleton reduced-motion, MedLevelChart null-guard).

## What Was Built

### Task 1 — `src/lib/sync-defer.ts` (NEW)

The new module mirrors `src/lib/telemetry-defer.ts` (Phase 2.1 proven pattern):

- **FIFO pre-init buffer**, cap 64. Overflow drops the oldest with `console.warn('sync-defer buffer full; dropping oldest')`.
- **Discriminated union of 4 call kinds**: `onSignedIn` (pull + subscribe + flush + anon-promotion + enqueue-local), `onSignedOut` (unsubscribe), `flush` (flushSyncQueue), `setLastWasAnon` (anon-promotion hint).
- **Idle scheduler**: `window.requestIdleCallback(startLoad, { timeout: 2000 })` with `setTimeout(startLoad, 100)` fallback for Safari<17/Firefox.
- **Idempotent**: `scheduleSyncInit()` is a no-op if `loadedApi` is non-null OR `loadingPromise` is in flight.
- **Two extra dyn-import wrappers** (`subscribeAuthStateChanges`, `autoMintAnonSessionIfMissing`) so App.tsx can stay completely off `@/lib/supabase`.
- **Type-only** namespace imports of `@/lib/sync` + `@/lib/auth-migration` so sync-defer itself stays off the eager graph.

6 vitest cases in `src/lib/sync-defer.test.ts` lock all six behavior contracts.

### Task 2 — App.tsx + main.tsx + store.ts rewire

- `src/App.tsx`: removed eager imports of `@/lib/sync`, `@/lib/auth-migration`, `@/lib/supabase`. Auth handlers route through `deferOnSignedIn` / `deferOnSignedOut` / `deferSetLastWasAnon`; online listener uses `deferFlush`; auto-anon-mint uses `autoMintAnonSessionIfMissing`. Auth subscription wrapped by `subscribeAuthStateChanges` (with StrictMode-safe `cancelled` flag for cleanup before the dyn-import resolves).
- `src/main.tsx`: added `scheduleSyncInit()` after `createRoot.render()`, adjacent to `deferSentryInit` + `deferAnalyticsInit`.
- `src/lib/store.ts`: dropped eager imports of `@/lib/auth` and `@/lib/sync`. `signOut` action dyn-imports `@/lib/auth`; `addInjection` / `editInjection` / `removeInjection` route fire-and-forget flush through `deferFlush()`.
- `src/components/auth/EmailVerificationBanner.tsx`: dyn-imports `resendVerification` inside the `onResend` handler (AppShell mounts this banner eagerly — static import would re-pull supabase-js).

### Task 3 — Three latent fixes folded in

- **Toast `durationMs?: number`** (UI-CHECK N4): store toast shape and showToast action signature extended; Toast.tsx setTimeout honors `toast.durationMs ?? 2400`. 3 vitest cases lock writes-through + undefined back-compat + positional 2-arg back-compat.
- **Skeleton prefers-reduced-motion** (UI-CHECK N5): added `skeleton-shimmer` className to the Skeleton root; appended `.skeleton-shimmer { animation: none !important; }` rule inside the existing reduced-motion @media block in index.css.
- **MedLevelChart null-guard** (06-CONTEXT D-12 #3): replaced `useStore((s) => s.user!)` with nullable selector + useMemo short-circuit + post-hook `if (!u || !config) return null` (Rules of Hooks compliant — all hooks run before the early-return).

### Task 4 — Format pass + lint fixes

- `npm run format --write` across the 14 files Phase 5 left red on `format:check`. No logic changes; mechanical Prettier reformatting.
- Two lint-rule fixes in sync-defer.ts: `typeof import('@/lib/sync')` → `typeof SyncModule` (with `import type * as SyncModule from '@/lib/sync'`); inline `import('@supabase/supabase-js').AuthChangeEvent` → `AuthChangeEvent` from a top-level `import type` line. Type imports are compile-time erased under verbatimModuleSyntax, so the dependency graph is unchanged.

## Verification — CI gates GREEN

| Gate | Phase 5 baseline | Plan 06-01 post-fix | Pass |
|------|-------|-------|-------|
| `npm run format:check` | FAIL (18 files dirty) | exit 0 (clean) | yes |
| `npm run typecheck` | exit 0 | exit 0 | yes |
| `npm run lint` | 0 errors, 5 warnings | 0 errors, 5 warnings (same baseline) | yes |
| `npm run build` | exit 0 | exit 0 | yes |
| `bash scripts/assert-vendor-react-size.sh` | FAIL (`index gz 72,635 > 50,000`) | exit 0 (`index gz 18,123`) | yes |
| `npm run test:unit` | 314 tests | 323 tests (314 + 6 sync-defer + 3 toast durationMs) | yes |
| M1–M4 storage ordering contract | pass | pass (preserved) | yes |
| Phase 5 D-13 acknowledgedDisclaimer survives sign-out | pass | pass (preserved) | yes |

### Bundle topology (post-fix)

| Chunk | Phase 5 ship | Plan 06-01 post-fix | Delta |
|-------|-------|-------|-------|
| `dist/assets/index-*.js` (gzipped) | **72,635 B** (broke 50 kB CI ceiling) | **18,123 B** | **−54,512 B (−75 %)** |
| `dist/assets/supabase-*.js` (NEW chunk, gzipped) | — | 53,569 B | (loaded post-idle, not on critical path) |
| `dist/assets/vendor-react-*.js` (gzipped) | 60,540 B | 60,491 B | (unchanged) |

The `IDX_CEILING=50000` guard is the load-bearing one for D-12. Pre-fix margin: **−22,635 B (FAIL)**. Post-fix margin: **+31,877 B (PASS, 63 % under ceiling)**.

## Pattern Choice — Task 2 step 4

**Pattern A (preferred)** was chosen over Pattern B: a new exported helper `subscribeAuthStateChanges(handler)` in `src/lib/sync-defer.ts` that dyn-imports `@/lib/supabase` and returns the subscription handle. App.tsx awaits it inside `useEffect` and tracks a `cancelled` flag so StrictMode double-mount cleanup before resolution tears the freshly-resolved subscription down. This keeps `@/lib/supabase` entirely off App.tsx's static graph and matches 06-RESEARCH §Pattern 6's "sync-defer owns ALL supabase-touching code paths" rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] store.ts eager import of @/lib/sync + @/lib/auth blocked the bundle ceiling**
- **Found during:** Task 2 verification (`npm run build` showed index gz still 73,173 B after the App.tsx + main.tsx changes).
- **Issue:** Plan only listed App.tsx, main.tsx (and Task 3's six files) as modified. Actual bundle measurement showed `src/lib/store.ts` had eager `import { signOut as authSignOut } from '@/lib/auth'` and `import { flushSyncQueue } from '@/lib/sync'` — both transitively pulled supabase-js back onto the entry chunk because store.ts is reachable from main.tsx via `hydrate()`.
- **Fix:** Made `signOut` action dyn-import `@/lib/auth` inside its body; replaced the 3 `void flushSyncQueue()` calls inside addInjection/editInjection/removeInjection with `deferFlush()` from sync-defer.ts.
- **Files modified:** `src/lib/store.ts`
- **Commit:** 8733aed (folded into the Task 2 commit; rationale documented in commit message).
- **Plan checkpoint guidance confirmed:** This was the exact failure mode the plan's `<checkpoint_handling>` block predicted ("investigate which other module is keeping supabase-js on the static graph — likely a `from '@/lib/supabase'` import somewhere in a static-graph file").

**2. [Rule 3 — Blocking] EmailVerificationBanner eager import of @/lib/auth re-leaked supabase-js**
- **Found during:** Task 2 verification (after fixing store.ts, build succeeded — but verifying I traced the full eager-graph chain found AppShell.tsx → EmailVerificationBanner.tsx → @/lib/auth → @/lib/supabase).
- **Issue:** AppShell mounts `<EmailVerificationBanner />` eagerly, so the banner's static `import { resendVerification } from '@/lib/auth'` would keep auth-js on the entry graph. The build numbers were green because the banner happened to be small, but the topology was still wrong (a future banner addition could push it back over).
- **Fix:** Dynamic-import `resendVerification` inside the `onResend` handler. The banner renders eagerly; the heavy import only fires when the user clicks "Resend".
- **Files modified:** `src/components/auth/EmailVerificationBanner.tsx`
- **Commit:** 8733aed (Task 2)

**3. [Rule 1 — Bug] Three lint errors from `typeof import(...)` + inline `import(...).Type` annotations**
- **Found during:** Task 4 `npm run lint`.
- **Issue:** `@typescript-eslint/consistent-type-imports` forbids `import()` type annotations. sync-defer.ts had three: `typeof import('@/lib/sync')`, `typeof import('@/lib/auth-migration')`, and `import('@supabase/supabase-js').AuthChangeEvent` inside `subscribeAuthStateChanges`.
- **Fix:** Replaced with `import type * as SyncModule from '@/lib/sync'` (and similar for auth-migration) at the top of the file; pulled `AuthChangeEvent` into the existing top-level `import type {...} from '@supabase/supabase-js'`.
- **Files modified:** `src/lib/sync-defer.ts`, `src/lib/sync-defer.test.ts` (import order)
- **Commit:** fc4565d (Task 4)
- **Bundle impact:** zero — type imports are erased at compile time under verbatimModuleSyntax.

## Threat Flags

None. This plan is UI-side bundle topology + 3 small fixes. No new network surfaces, no new auth paths, no new RLS-relevant code. The two threat IDs in `<threat_model>` (T-06-01-02 buffer DoS / T-06-01-03 durationMs info-disclosure) are accounted for: BUFFER_CAP=64 + drop-oldest + console.warn mitigates T-06-01-02; durationMs is caller-controlled, not user-controlled (accepted disposition).

## Phase 5 Contract Preservation

- **M1 (multi-account regression)**: pass — `setActiveStorageUserId(null)` + `removeUserNamespace(prevUserId)` still fire on SIGNED_OUT.
- **M2 (Realtime INSERT routes to namespaced key)**: pass — sync-defer's onSignedIn drain still calls `subscribeInjections(userId)` after `setActiveStorageUserId(uid)` + `renameStorageNamespace(uid)` complete.
- **M3 (anon writes still land in universal STORAGE_KEY)**: pass — no `setActiveStorageUserId` call → adapter routes to universal key.
- **M4 (anon-promotion ordering contract)**: **pass** — `setActiveStorageUserId(uid)` is awaited BEFORE `renameStorageNamespace(uid)` in App.tsx's `INITIAL_SESSION` and `SIGNED_IN` branches. The `deferOnSignedIn(uid, session)` call happens AFTER both, mirroring the Phase 5 sequence exactly. Verified via `npx vitest run src/lib/store.test.ts -t "G2 closure"` (M1–M4 + CONF-2 + CONF-3 all green).
- **CONF-3 (acknowledgedDisclaimer survives sign-out)**: pass — `clearUserDataSlices` unchanged, still preserves `acknowledgedDisclaimer`.

## Self-Check: PASSED

- `src/lib/sync-defer.ts` exists (created in commit 8514254).
- `src/lib/sync-defer.test.ts` exists (created in commit 8514254).
- `src/App.tsx` modified (commit 8733aed): grep for eager heavy imports = 0; grep for defer* calls = 9.
- `src/main.tsx` modified (commit 8733aed): grep for `scheduleSyncInit` = 2.
- `src/lib/store.ts` modified (commits 8733aed + b48b8cf + fc4565d): grep for `durationMs` = 5; signOut + addInjection/editInjection/removeInjection rewired.
- `src/lib/store.test.ts` modified (commit b48b8cf): 3 new toast durationMs cases.
- `src/components/ui/Toast.tsx` modified (commit b48b8cf): grep for `toast.durationMs ?? 2400` = 1.
- `src/components/ui/Skeleton.tsx` modified (commit b48b8cf): grep for `skeleton-shimmer` = 2.
- `src/index.css` modified (commit b48b8cf): grep for `skeleton-shimmer` = 2.
- `src/components/dashboard/charts/MedLevelChart.tsx` modified (commit b48b8cf): grep for `s.user!` = 0; grep for `s.user)` = 1.
- `src/components/auth/EmailVerificationBanner.tsx` modified (commit 8733aed): dyn-import in onResend.
- All 4 task commits present in git log.
- All CI gates green (format:check, typecheck, lint, build, bundle guard, test:unit).
