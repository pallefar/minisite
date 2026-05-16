---
phase: 16-capacitor-mobile-shells-ios-android
plan: "02"
subsystem: native-bridge
tags: [capacitor, native-bridge, deeplink, biometric, share, ios, android]
dependency_graph:
  requires:
    - 16-00 (Wave-0 harness — vitest-mobile.config.ts + __mocks__/* manual mocks)
    - 16-01 (Capacitor scaffold + plugin install — @capacitor/core, @capacitor/app, @capacitor/share, @capgo/capacitor-native-biometric)
  provides:
    - src/lib/native/platform.ts — detectPlatform() real implementation via Capacitor.getPlatform() + isNativePlatform()
    - src/lib/native/deeplink.ts — installDeepLinkHandler() with PATHNAME + HASH dispatcher (4 D-11 categories)
    - src/lib/native/biometric.ts (NEW) — checkBiometric / authenticateWithBiometric wrappers around @capgo/capacitor-native-biometric
    - src/lib/native/share.ts (NEW) — nativeShare with @capacitor/share native path + navigator.share + clipboard fallback
    - src/components/BiometricGate.tsx (NEW) — full-screen overlay UI-SPEC Surface 2b/2c
    - src/App.tsx wiring — installDeepLinkHandler() boot useEffect + BiometricGate early-return wrap
    - vitest-mobile.config.ts — extended with @vitejs/plugin-react + setupFiles for jsdom matchMedia + include BiometricGate.test.tsx
    - leanshot_biometric_enabled localStorage flag — TEMPORARY hook for downstream Zustand-slice migration
  affects:
    - Plan 16-03 (AASA + assetlinks) — confirms PATHNAME vs HASH route map for the OS-side allowlist
    - Plan 16-05 (IAP fork) — detectPlatform() now returns real 'ios'/'android' so RevenueCat fork can be gated correctly
    - Plan 16-06 (RevenueCat webhook tier flip) — same detectPlatform() reliance
    - SettingsPage downstream executor — Surface 2d "Keep Biometrics" / "Disable Biometrics" labels documented in BiometricGate.tsx header comment for re-use
    - Future plan owning Zustand slice migration — replaces leanshot_biometric_enabled localStorage with signedIn.user.biometricEnabled slice + wires onPasswordSubmit to real supabase signInWithPassword
tech_stack:
  added:
    - "@vitejs/plugin-react (referenced from vitest-mobile.config.ts; already a project devDep)"
  patterns:
    - "Atomic-swap pattern: deleting a transitional probe file + replacing the real implementation in the SAME commit so vendor-chunk routing stays anchored (Plan 16-01 → 16-02 handoff)"
    - "Idempotency guard for async listener registration — module-level _installed + _installing flags set AFTER addListener resolves so a synchronous double-call (StrictMode dev double-mount) still de-dupes"
    - "Web/native short-circuit pattern — native bridge files (biometric, share) call detectPlatform() FIRST and return safe defaults on 'web' / 'capacitor-web' so jsdom + npx cap serve never hit unresolved native bindings"
    - "Module-level CTA label constants (LABEL_USE_FACE_ID, LABEL_USE_FINGERPRINT, LABEL_USE_PASSWORD, LABEL_UNLOCK_APP) — grep-discoverable from a UI-SPEC enforcement gate; readers see noun-qualification at file top"
key_files:
  created:
    - leanshot/src/lib/native/platform.test.ts (54 lines)
    - leanshot/src/lib/native/deeplink.test.ts (162 lines)
    - leanshot/src/lib/native/biometric.ts (43 lines)
    - leanshot/src/lib/native/biometric.test.ts (118 lines)
    - leanshot/src/lib/native/share.ts (47 lines)
    - leanshot/src/lib/native/share.test.ts (103 lines)
    - leanshot/src/components/BiometricGate.tsx (150 lines)
    - leanshot/src/components/BiometricGate.test.tsx (108 lines)
    - leanshot/src/lib/native/__mocks__/vitest-mobile-setup.ts (matchMedia jsdom stub)
  modified:
    - leanshot/src/lib/native/platform.ts (overwritten — Phase 12 stub → real Capacitor.getPlatform implementation)
    - leanshot/src/lib/native/deeplink.ts (overwritten — Phase 12 stub → installDeepLinkHandler dispatcher; DeepLinkRoute + handleDeepLink removed)
    - leanshot/src/main.tsx (-5 lines — probe side-effect import removed)
    - leanshot/src/App.tsx (+59 lines — BiometricGate import + installDeepLinkHandler import + new useEffect + biometricUnlocked state + early-return wrap)
    - leanshot/vitest-mobile.config.ts (+react plugin + setupFiles + include BiometricGate.test.tsx)
  deleted:
    - leanshot/src/lib/native/__capacitor-import-probe.ts (atomic-swap with platform.ts fill — 16-01 → 16-02 handoff)
decisions:
  - "Idempotency guard uses BOTH _installed AND _installing flags so a synchronous double-call within ONE tick (real StrictMode behavior) de-dupes without an awkward microtask boundary. Set _installed AFTER App.addListener resolves (not before) so re-entrant calls during the await window also de-dupe correctly."
  - "Module-level CTA label constants (LABEL_USE_FACE_ID etc.) — grep gate in plan asserts the 4 noun-qualified labels appear as quoted strings in BiometricGate.tsx. JSX text children ('Use Password') don't satisfy the gate; lifting to const literals does + improves readability."
  - "Web/capacitor-web short-circuit in biometric.ts AND share.ts — saves jsdom unit tests from needing to mock the native plugins on web cases (they're never called) + makes the npx cap serve dev harness usable for non-biometric flows."
  - "BiometricGate eager (non-lazy) import in App.tsx — UI-SPEC Surface 2b requires pre-paint render to avoid a flash of app content. Component is small (<3 kB gz expected, measured ~1.7 kB contribution to index gz delta) and stays within both the 24.5 kB working ceiling and 50 kB absolute index ceiling."
  - "leanshot_biometric_enabled localStorage flag is TEMPORARY — the production wire-up should put a biometricEnabled boolean on the signedIn.user slice in Zustand and clear it on SIGNED_OUT. This plan stays self-contained (no slice migration) to preserve single-writer-on-App.tsx + scope discipline."
  - "onPasswordSubmit prop stub throws — downstream plan (16-05 or follow-up) wires real Supabase signInWithPassword. Stub is explicit + thrown error includes the deferred-to-Phase-16-follow-up message so a developer who hits it knows exactly where to look."
  - "vitest-mobile.config.ts gains @vitejs/plugin-react + matchMedia setupFile — load-bearing for any future component test under this config (every project component transitively uses HeroOrbital or another useReducedMotion consumer). Future Plan 16-04+ component tests inherit this without further config edits."
metrics:
  duration: "~45 minutes"
  completed: "2026-05-16"
  tasks_completed: 5
  tasks_skipped: 0
  files_created: 9
  files_modified: 5
  files_deleted: 1
  test_cases_added: 33
  test_cases_passing: 33
  commits: 5
  bundle_delta:
    index_gz_before: 17740
    index_gz_after: 19385
    index_gz_delta: 1645
    capacitor_bridge_gz_before: 3378
    capacitor_bridge_gz_after: 5029
    capacitor_bridge_gz_delta: 1651
    biometric_ts_raw_bytes: 1761
    share_ts_raw_bytes: 1652
    biometricgate_tsx_raw_bytes: 6482
---

# Phase 16 Plan 16-02: Native bridge fills (platform / deeplink / biometric / share) Summary

Phase 12 throw-stubs replaced with real Capacitor 8 implementations. `detectPlatform()` now returns `'ios' | 'android' | 'capacitor-web' | 'web'` via `Capacitor.getPlatform() + isNativePlatform()`. `installDeepLinkHandler()` registers a single idempotent `App.addListener('appUrlOpen', …)` with the RESEARCH Pattern 2 PATHNAME + HASH dispatcher handling all four D-11 categories. New `biometric.ts` and `share.ts` wrap `@capgo/capacitor-native-biometric` + `@capacitor/share` with web short-circuits + error-swallowing fire-and-forget semantics. New `<BiometricGate>` full-screen overlay (UI-SPEC Surface 2b/2c) gates app content before first paint when biometric is enabled, with noun-qualified CTA labels (`'Use Face ID'` / `'Use Fingerprint'` / `'Use Password'` / `'Unlock App'`). App.tsx wired via top-mount useEffect + early-return wrap. Phase 12 ESLint two-tunnel firewall preserved byte-identical (zero new zones).

## Auto Tasks Completed

### Task 1: Fill platform.ts + atomic-swap probe

**Commit:** `e98435d`

- `src/lib/native/platform.ts` — overwritten. Imports `Capacitor` from `@capacitor/core` (sole legitimate `@capacitor/core` import site in `src/lib/native/*`, asserted by grep). Branches `getPlatform()` on `'ios'` / `'android'`, falls through to `isNativePlatform() ? 'capacitor-web' : 'web'`. The `Platform` type union is preserved byte-identical — downstream forks depend on it.
- `src/lib/native/__capacitor-import-probe.ts` — DELETED.
- `src/main.tsx` — removed the `import './lib/native/__capacitor-import-probe';` side-effect line + its preceding 4-line comment block.
- Atomic-swap: all three changes land in ONE commit so the capacitor-bridge chunk routing stays anchored — when the probe is removed, `Capacitor.getPlatform()` inside the new `platform.ts` immediately becomes the static-graph anchor for the chunk. Bundle measurement post-swap: capacitor-bridge gz held strong at 5029 bytes (15000 ceiling).
- `platform.test.ts` — 4 cases (ios / android / capacitor-web / web) green under `vitest-mobile.config.ts`. Uses `vi.resetModules() + await import('@capacitor/core') + await import('./platform')` per case so each test sees a fresh `Capacitor` mock instance that `platform.ts` captures on its own re-import.

### Task 2: Fill deeplink.ts with PATHNAME + HASH dispatcher

**Commit:** `2385b21`

- `src/lib/native/deeplink.ts` — overwritten. Phase 12 `handleDeepLink` throw-stub + `DeepLinkRoute` type both removed (verified zero hits via `grep -rn "handleDeepLink\|DeepLinkRoute" src/`).
- `installDeepLinkHandler(): void` registers `App.addListener('appUrlOpen', …)` with the RESEARCH Pattern 2 dispatcher:
  - `PATHNAME_PREFIXES = ['/clinic', '/pricing', '/faq', '/r/', '/share/']` → `pushState + dispatchEvent('popstate')`
  - `HASH_PREFIXES = ['/auth/', '/legal/']` → `window.location.hash = '#' + path + search`
  - Fallback: `pushState('/')` + popstate
  - Malformed URL → swallowed silently (mitigates T-16-02-01)
- Idempotency guard: module-level `_installed` + `_installing` flags so a synchronous double-call (StrictMode dev double-mount) de-dupes correctly. Flag set AFTER `App.addListener` resolves so re-entrant calls during the await window also de-dupe.
- `deeplink.test.ts` — 10 cases green: 4 D-11 categories (auth / share / clinic / marketing) + /faq + /r/ + / fallback + idempotency guard + malformed URL. Test helper captures the registered handler via `App.addListener.mock.calls[0][1]` after awaiting two microtasks for the async addListener to resolve.

### Task 3: New biometric.ts + share.ts + tests

**Commit:** `baefe9c`

- `src/lib/native/biometric.ts` (NEW) — `checkBiometric(): 'available' | 'unavailable' | 'permission-denied'` wraps `NativeBiometric.isAvailable()`; case-insensitive `/permission/i` regex maps thrown PermissionError → `'permission-denied'`. `authenticateWithBiometric(reason)` wraps `NativeBiometric.verifyIdentity({reason, title, subtitle, description})` with the 4-property prompt config from RESEARCH Pattern 5 verbatim; resolves `true` on success, `false` on any throw. Web + capacitor-web short-circuit (no native call).
- `src/lib/native/share.ts` (NEW) — `nativeShare({title, text, url})` calls `Share.share()` on iOS/Android, falls back to `navigator.share` then `navigator.clipboard.writeText(url)` on web. All errors swallowed (fire-and-forget per UI-SPEC Surface 3 — `@capacitor/share`'s user-cancel is a thrown error that must be absorbed).
- 13 test cases green (6 biometric + 5 share + 2 web-short-circuit).
- Phase 12 firewall unchanged: `grep -nE "target:.*biometric|target:.*share" eslint.config.js` returns zero hits.

### Task 4: BiometricGate component (UI-SPEC Surface 2b/2c)

**Commit:** `c77810a`

- `src/components/BiometricGate.tsx` (NEW) — full-screen `role="dialog" aria-modal="true"` overlay (fixed inset-0 z-[100], `--color-bg`, safe-area insets via `env(safe-area-inset-{top,bottom})`).
- HeroOrbital logo (48px, `staticOnly`) + `'Unlock LeanShot'` heading (`--text-xl` weight 700).
- On mount: immediately invokes `authenticateWithBiometric('Unlock LeanShot')` (UI-SPEC: "Immediately triggers OS biometric prompt on render"). On success → `onUnlock()`. On failure → manual CTA appears.
- Biometric mode CTA label per `detectPlatform()`: `'Use Face ID'` (iOS / capacitor-web / web default) or `'Use Fingerprint'` (Android). Plus a `'Use Password'` text link (min-h-44 touch target) that flips to password mode.
- After 3 consecutive biometric failures auto-switches to password mode (Sub-surface 2c) — `setAttemptCount` callback reads next count inline.
- Password mode: auto-focused `<Input type="password" label="Password">` + `'Unlock App'` submit `<Button>` with `aria-busy={loading}`. Inline error message under input on wrong password (`--color-danger`).
- All CTA labels exported as module-level string constants (`LABEL_USE_FACE_ID` etc.) so the plan's gate grep finds all 4 verbatim.
- `jsx-a11y/no-autofocus` disabled inline with UI-SPEC §Surface 2c rationale (Focal point: Auto-focused password input field).
- Test infra additions: vitest-mobile.config.ts gains `@vitejs/plugin-react` for TSX + `setupFiles` for jsdom matchMedia polyfill + extended `include` for `src/components/BiometricGate.test.tsx`.
- 6 component-test cases green: auto-success on mount, 3-failure password-flip, Android label, noun-qualified CTAs only, password submit invokes callback + onUnlock, role/aria-modal a11y invariant.

### Task 5: Wire installDeepLinkHandler + BiometricGate into App.tsx

**Commit:** `d29e9db`

- Direct (non-lazy) `import { BiometricGate } from '@/components/BiometricGate'` — must render BEFORE first paint of dashboard content; component is small (<3 kB gz expected; measured +1.65 kB gz contribution to index chunk).
- Import of `installDeepLinkHandler` from `@/lib/native/deeplink` placed alphabetically between `@/lib/analytics` and `@/lib/storage`.
- New top-of-App `useEffect(() => { installDeepLinkHandler(); }, [])` placed ABOVE the existing view-recompute useEffect.
- New `biometricUnlocked` `useState(false)` + `biometricGateActive` inline derivation (reads `localStorage['leanshot_biometric_enabled'] === '1'` per render; cheap; bypasses sessionStorage staleness).
- Early-return wrap: when `biometricGateActive`, render ONLY `<BiometricGate onUnlock={() => setBiometricUnlocked(true)} onPasswordSubmit={stub}>`. Otherwise normal view branches render unchanged.
- `onPasswordSubmit` is a stub that throws — Supabase `signInWithPassword` wiring deferred to downstream plan (see Carry-over follow-ups).
- Single-writer rule preserved: +59 lines added, ZERO removed. `eslint.config.js` NOT in diff (Phase 12 firewall byte-identical). `selectView` / `selectViewLogged` / `onAuthStateChange` useEffect unchanged.

## Deviations from Plan

### Auto-fixed Issues (Rules 1-3, no user approval needed)

**1. [Rule 3 — Blocking infra] Worktree had no `node_modules` (Vite/Node resolved up to root, failed)**

- **Found during:** Task 1 RED (first `npx vitest run` after writing platform.test.ts)
- **Issue:** Worktree at `.claude/worktrees/agent-a2a105057fa248d1f/leanshot/` was created via `git worktree add` with no `npm install`. Vite chose the nearest `node_modules` (the worktree root, which has only a partial set), then failed to resolve `vitest` because the real install lives at `/Users/karstenhaldan/minisite/leanshot/node_modules/`.
- **Fix:** `ln -s /Users/karstenhaldan/minisite/leanshot/node_modules node_modules` inside the worktree's `leanshot/` directory. Symlink-borrow from the main repo. This is consistent with the existing project pattern of [[reference_supabase_worktree_temp_state]] copying state from main into worktrees.
- **Files modified:** none (symlink is untracked + gitignored via `?? leanshot/node_modules` in git status)
- **Commit:** not committed (untracked file). Documented here for the next executor.

**2. [Rule 3 — Worktree path drift] First Write to `/Users/karstenhaldan/minisite/leanshot/...` landed in MAIN repo**

- **Found during:** Task 1 (immediately after writing platform.test.ts via absolute path)
- **Issue:** A Write tool call with the absolute path `/Users/karstenhaldan/minisite/leanshot/src/lib/native/platform.test.ts` resolved to the MAIN repo (not the worktree) — exactly the [[reference-worktree-base-drift-recovery]] failure mode. The orchestrator-injected `<files_to_read>` block mixed worktree-rooted and absolute paths; copy-paste from the read list led to the wrong write target.
- **Fix:** Copy back to worktree (`cp main-path worktree-path`) + delete from main (`rm main-path`). After recovery, ALL subsequent Write calls use worktree-rooted absolute paths only.
- **Files modified:** none (recovered cleanly; file landed in correct worktree location pre-commit)
- **Commit:** not committed (recovery happened before staging). Documented for the SUMMARY trace + reinforces the project rule to use worktree-relative or worktree-rooted absolute paths only.

**3. [Rule 1 — Test infra] vitest-mobile.config.ts needed @vitejs/plugin-react + jsdom matchMedia polyfill for TSX**

- **Found during:** Task 4 (first run of BiometricGate.test.tsx)
- **Issue:** Plan 16-00 scaffolded `vitest-mobile.config.ts` for `.ts` native-bridge unit tests only — no React plugin and no jsdom polyfill. Adding the BiometricGate component test surfaced two related failures: (a) `React is not defined` because vitest's default ESBuild transform doesn't inject the React.createElement / jsx-runtime calls without the plugin; (b) `window.matchMedia is not a function` because HeroOrbital → useReducedMotion calls it during render and jsdom doesn't ship it by default.
- **Fix:** Add `import react from '@vitejs/plugin-react'` + `plugins: [react()]` to vitest-mobile.config.ts. Add `setupFiles: ['./src/lib/native/__mocks__/vitest-mobile-setup.ts']` and create the setup file with a matchMedia stub. Both are infrastructure additions that future component tests under this config inherit without re-config.
- **Files modified:** `leanshot/vitest-mobile.config.ts`, `leanshot/src/lib/native/__mocks__/vitest-mobile-setup.ts` (new)
- **Commit:** `c77810a` (bundled with Task 4 BiometricGate addition since both are required for Task 4 to be green)

**4. [Rule 1 — Lint regression in BiometricGate.tsx] `jsx-a11y/no-autofocus` + unused state variable**

- **Found during:** Task 4 first lint pass
- **Issue:** (a) UI-SPEC Surface 2c requires "Auto-focused password input field" — verbatim; `jsx-a11y/no-autofocus` flags it as an error. (b) `attemptCount` state value was only read inside the `setAttemptCount` callback, never destructured — `@typescript-eslint/no-unused-vars` flagged it.
- **Fix:** (a) Inline `// eslint-disable-next-line jsx-a11y/no-autofocus` with a 4-line comment citing UI-SPEC §Surface 2c. (b) Change `const [attemptCount, setAttemptCount] = useState(0)` to `const [, setAttemptCount] = useState(0)` — preserves state semantics, silences the rule.
- **Files modified:** `leanshot/src/components/BiometricGate.tsx`
- **Commit:** `c77810a`

**5. [Rule 1 — Gate-grep false positive on comment text] `'Cancel'/'Disable'/'Unlock'/'Submit'` comment violated bare-CTA grep**

- **Found during:** Task 4 first verify pass (bare-CTA grep returned exit 0, matched comment line)
- **Issue:** The BiometricGate.tsx header comment originally listed banned bare CTAs in single quotes for clarity (`Bare 'Cancel'/'Disable'/'Unlock'/'Submit'/'OK'/'Save' are BANNED here.`). The plan's done-criteria grep is content-blind — it matched the comment.
- **Fix:** Reword the comment using bracketed forms (`[Cancel]`, `[Disable]`) so the comment still teaches the intent but doesn't trip the grep.
- **Files modified:** `leanshot/src/components/BiometricGate.tsx`
- **Commit:** `c77810a`

**6. [Rule 1 — Gate-grep on JSX text children] noun-qualified labels were rendered as JSX text not string literals**

- **Found during:** Task 4 done-criteria gate
- **Issue:** The plan's gate `grep -cE "'Use Face ID'|'Use Fingerprint'|'Use Password'|'Unlock App'" src/components/BiometricGate.tsx | wc -l ≥ 4` requires all four labels as quoted strings. JSX text children (`<button>Use Password</button>`) don't satisfy a single-quote grep. Initial implementation rendered `Use Password` and `Unlock App` as JSX text → only 2 labels found.
- **Fix:** Lift all 4 CTA labels to module-level `const LABEL_USE_FACE_ID = 'Use Face ID'` etc. Reference them via `{LABEL_*}` in JSX. Improves readability + satisfies the grep.
- **Files modified:** `leanshot/src/components/BiometricGate.tsx`
- **Commit:** `c77810a`

## Bundle Measurement Delta

| Chunk | Gz before (16-01) | Gz after (16-02) | Delta | Ceiling | Headroom |
|-------|------|------|-------|---------|----------|
| `index-FxNNwSBx.js` | 17740 B | 19385 B | +1645 B | 24500 B (working) / 50000 B (absolute) | 5115 / 30615 B |
| `capacitor-bridge-DuOokzL9.js` | 3378 B | 5029 B | +1651 B | 15000 B | 9971 B |

**Source file sizes (raw bytes, pre-bundle):**

| File | Raw bytes | Comment |
|------|-----------|---------|
| `src/lib/native/platform.ts` | 1148 | replaced; minimal real implementation |
| `src/lib/native/deeplink.ts` | 2654 | replaced; ~50 lines of dispatcher + idempotency |
| `src/lib/native/biometric.ts` | 1761 | NEW |
| `src/lib/native/share.ts` | 1652 | NEW |
| `src/components/BiometricGate.tsx` | 6482 | NEW; full overlay + password fallback |

**Bundle math** (per 16-01 forward baseline of "16-02 adds ~3 kB plugin wrappers"): actual +1.65 kB gz delta in capacitor-bridge is BELOW the 3 kB projection. Index +1.65 kB gz delta is the BiometricGate eager import. Projected close-of-phase capacitor-bridge ≈ 13-14 kB (still within 15 kB ceiling) holds with this measurement.

## D-11 Deep-Link Category Routing (cross-check for 16-03 AASA + 16-10 UAT)

| Category | Example URL | Branch | Resulting in-app navigation |
|----------|-------------|--------|------------------------------|
| auth | `https://leanshot.app/auth/verify-email?token=xyz` | HASH | `window.location.hash = '#/auth/verify-email?token=xyz'` |
| share | `https://leanshot.app/share/abc123?ref=email` | PATHNAME | `pushState({}, '', '/share/abc123?ref=email')` + popstate |
| clinic | `https://leanshot.app/clinic/acme-clinic` | PATHNAME | `pushState({}, '', '/clinic/acme-clinic')` + popstate |
| clinic-invite | `https://leanshot.app/clinic-invite/<token>` | PATHNAME (via `/clinic` prefix) | `pushState({}, '', '/clinic-invite/<token>')` + popstate |
| marketing — root | `https://leanshot.app/` | PATHNAME (fallback) | `pushState({}, '', '/')` + popstate |
| marketing — pricing | `https://leanshot.app/pricing` | PATHNAME | `pushState({}, '', '/pricing')` + popstate |
| marketing — faq | `https://leanshot.app/faq` | PATHNAME | `pushState({}, '', '/faq')` + popstate |
| affiliate referral | `https://leanshot.app/r/<code>` | PATHNAME | `pushState({}, '', '/r/<code>')` + popstate |
| legal | `https://leanshot.app/legal/privacy` | HASH | `window.location.hash = '#/legal/privacy'` |
| malformed | `not-a-url` | swallowed | no-op (T-16-02-01 mitigation) |

Note: `/clinic-invite/<token>` is caught by the `/clinic` PATHNAME_PREFIXES entry (which uses `path.startsWith('/clinic')`), so a single prefix covers both `/clinic/...` and `/clinic-invite/...` paths. If 16-03 needs to allowlist these in AASA, both share the `/clinic*` umbrella.

## Carry-over Follow-ups

| Item | Owner Plan | Resume signal |
|------|-----------|---------------|
| Migrate `leanshot_biometric_enabled` localStorage flag → Zustand slice on `signedIn.user.biometricEnabled` | 16-05 or dedicated follow-up | when SettingsPage gains Surface 2d toggle |
| Wire `BiometricGate.onPasswordSubmit` to real Supabase `signInWithPassword` (currently stub throws) | 16-05 or dedicated follow-up | when biometric is being end-to-end UAT'd; current stub explicitly errors so a developer hitting it knows where to look |
| Surface 2d Settings toggle row (Face ID / Biometric Unlock + Disable Biometrics destructive confirmation) | SettingsPage executor — likely deferred to v1.2 closeout | when biometric enrollment UX is needed (only matters once Phase 16 ships on App Store and a real user toggles it) |
| Surface 2a First-time enable screen ("Unlock LeanShot faster" Sheet) | SettingsPage executor or onboarding flow | same as above |
| `node_modules` install in worktree (currently symlinked to main repo) | infra | when worktree is regenerated; consider adding `(cd leanshot && npm ci)` to the worktree-create hook |
| Bundle-budget script hash-hyphen bug (per [[reference_bundle_budget_hash_hyphen]]) | Phase 16 close | does NOT block 16-02 — affects per-chunk ceilings; the capacitor-bridge measurement is honored correctly here because the hash `DuOokzL9` has no hyphen |

## Threat Flags

No new threat surface introduced beyond the plan's `<threat_model>` coverage. T-16-02-01 through T-16-02-09 dispositions are all honored:

- T-16-02-01 (Spoofing UL dispatch) → `new URL()` throws on malformed; allowlist prefix matching enforced
- T-16-02-02 (Tampering PATHNAME_PREFIXES) → module-level `const` arrays, no runtime config
- T-16-02-03 (Password input ID disclosure) → `<input type="password">`, no Sentry capture of value, fixed error string
- T-16-02-04 (Share URL leak) → user-initiated, OS confirms recipient
- T-16-02-05 (Deep-link audit trail) → accepted; no v1.2 requirement
- T-16-02-06 (DoS biometric prompt) → 3-failure → password fallback in BiometricGate; OS Face ID lockout above
- T-16-02-07 (EoP stolen device) → BiometricGate pre-paint gate when enabled; Supabase JWT still required server-side
- T-16-02-08 (Idempotency bypass) → JS-scoped flag; attacker with JS execution already has full access
- T-16-02-09 (URL search string forwarding) → string concat into hash, no eval/innerHTML

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `onPasswordSubmit` prop default in App.tsx | `leanshot/src/App.tsx` | ~1038 | throws `'password fallback not yet wired — see Phase 16 follow-up'`; real Supabase signInWithPassword hookup deferred (see Carry-over follow-ups). Intentional to keep this plan self-contained while making the missing wire explicit. |
| `leanshot_biometric_enabled` localStorage flag (no UI to set it) | runtime localStorage | n/a | No way to enable biometric yet — Surface 2a/2d Settings toggle is deferred. End users will never see BiometricGate from this plan alone; full UX requires the SettingsPage executor's Surface 2d toggle. |

## Self-Check: PASSED

- `leanshot/src/lib/native/platform.ts` — FOUND, real Capacitor.getPlatform() implementation, `Platform` type union preserved
- `leanshot/src/lib/native/deeplink.ts` — FOUND, `installDeepLinkHandler()` + PATHNAME/HASH prefix arrays + idempotency guard
- `leanshot/src/lib/native/biometric.ts` — FOUND, `checkBiometric()` + `authenticateWithBiometric()` + `BiometricAvailability` type
- `leanshot/src/lib/native/share.ts` — FOUND, `nativeShare()` + `ShareOptions` interface
- `leanshot/src/components/BiometricGate.tsx` — FOUND, role=dialog + aria-modal=true + 4 noun-qualified CTA labels
- `leanshot/src/lib/native/__capacitor-import-probe.ts` — CONFIRMED DELETED (atomic-swap)
- `leanshot/src/main.tsx` — probe side-effect import line removed
- `leanshot/src/App.tsx` — `installDeepLinkHandler` + `<BiometricGate ` both present (grep `wc -l` ≥ 2)
- `leanshot/eslint.config.js` — NOT in diff (Phase 12 firewall byte-identical)
- All 5 test files present and green (33/33 tests)
- Commit `e98435d` — FOUND (Task 1: platform.ts fill + probe swap)
- Commit `2385b21` — FOUND (Task 2: deeplink.ts fill)
- Commit `baefe9c` — FOUND (Task 3: biometric.ts + share.ts new + tests)
- Commit `c77810a` — FOUND (Task 4: BiometricGate component + test infra)
- Commit `d29e9db` — FOUND (Task 5: App.tsx wiring)
- `dist/assets/capacitor-bridge-DuOokzL9.js` — emitted at 5029 B gz (under 15000 ceiling)
- `dist/assets/index-FxNNwSBx.js` — emitted at 19385 B gz (under both 24500 working + 50000 absolute ceilings)
- Bundle budget script PASS; firewall regression test PASS (artificial health→ads import correctly blocked by ESLint zone 1); bare-CTA grep PASS (no matches); noun-qualified label grep PASS (4 labels present as quoted strings); stub-identifier grep PASS (zero `handleDeepLink|DeepLinkRoute` matches)
