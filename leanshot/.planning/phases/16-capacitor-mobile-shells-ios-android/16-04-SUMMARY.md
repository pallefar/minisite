---
phase: 16-capacitor-mobile-shells-ios-android
plan: "04"
subsystem: native-telemetry
tags: [capacitor, sentry, ios, android, crash-reporting, dual-init, mobile-09]
dependency_graph:
  requires:
    - 16-01 (capacitor-bridge manualChunks chunk + plugin install; deferred Sentry-Capacitor install)
    - "Phase 1 src/lib/sentry.ts (beforeSend D-10 scrubber)"
    - "Phase 2.1 src/lib/telemetry-defer.ts (deferred web init wrapper)"
  provides:
    - "src/lib/sentry-native.ts — initSentryNative({dsn, release, beforeSend}) — only file importing @sentry/capacitor"
    - "src/lib/sentry-native.test.ts — 5 vitest cases (web no-op, ios, android, idempotency, missing-DSN)"
    - "src/lib/telemetry-defer.ts — native-platform guard prevents double-init on ios/android"
    - "src/lib/telemetry-defer.test.ts — 4 new vitest cases for the native guard"
    - "src/main.tsx — detectPlatform() fork: native sync init BEFORE createRoot, web defer unchanged"
    - "16-04-VERIFIED-SIGNATURE.md — R9 audit trail (Context7 verification of @sentry/capacitor v4 dual-init signature vs fresh upstream README)"
    - ".env.example — VITE_SENTRY_RELEASE documented (D-17 per-platform shape)"
    - "@sentry/capacitor@^4.0.0 in dependencies (pinned exact 4.0.0; --legacy-peer-deps + --update-sentry-capacitor escape hatch documented)"
  affects:
    - "Plan 16-02 (when platform.ts is filled with Capacitor.getPlatform(), Rollup can no longer tree-shake the native branch → sentry-native.ts + @sentry/capacitor will land in capacitor-bridge chunk per existing manualChunks rule; estimated +5-6 kB gz toward 15 kB chunk ceiling)"
    - "Plan 16-09 (fastlane CI MUST set VITE_SENTRY_DSN + VITE_SENTRY_RELEASE per-platform-build for iOS + Android jobs; dSYM upload via sentry-cli upload-dsym completes the other half of MOBILE-09)"
    - "Plan 16-10 (7-day TestFlight soak / D-15 — validates the version-skew waiver runtime risk by exercising native crash capture under real load; if waiver fires runtime errors, falls back to @sentry/react@10.43.0 downgrade or @sentry/capacitor patch)"
tech_stack:
  added:
    - "@sentry/capacitor ^4.0.0 (exact 4.0.0 installed) — native crash capture via Sentry Cocoa + Sentry Android auto-linked native modules"
  patterns:
    - "Dual-init platform fork: web stays deferred (Phase 2.1 perf-fix preserved — entry chunk free of @sentry/*), native runs SYNCHRONOUSLY before createRoot so hydrate()/first-paint crashes are captured by the native crash handler"
    - "Version-skew waiver via documented npm install escape hatch (--legacy-peer-deps + --update-sentry-capacitor) when sibling-peer-pin would force a Rule-4 architectural downgrade across prior phases"
    - "R9 verification trail (16-04-VERIFIED-SIGNATURE.md) decoupled from implementation — Task 1 fetches fresh README via Context7, Tasks 2/3 consume the captured signature"
key_files:
  created:
    - leanshot/src/lib/sentry-native.ts
    - leanshot/src/lib/sentry-native.test.ts
    - leanshot/src/lib/telemetry-defer.test.ts
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md
  modified:
    - leanshot/package.json
    - leanshot/package-lock.json
    - leanshot/src/lib/telemetry-defer.ts
    - leanshot/src/main.tsx
    - leanshot/.env.example
decisions:
  - "@sentry/capacitor sibling-check resolved via Path 1 (--legacy-peer-deps + --update-sentry-capacitor) instead of Path 2 (downgrade @sentry/react to 10.43.0). Path 2 would be a Rule-4 architectural change spanning 15 prior phases; Path 1 is a documented escape hatch in check-siblings.js with bounded runtime risk validated by Plan 16-10 TestFlight soak."
  - "D-11 errors-only carried forward to native init verbatim — integrations: [] mirrors the web telemetry-defer.ts line 68 exactly. README's Replay/Tracing/Feedback/sendDefaultPii defaults are NOT adopted because they violate D-10 (sendDefaultPii pulls IP+headers) or D-11 (Replay/Tracing/Feedback bundle weight + PHI exposure)."
  - "Module-level _initialized guard on sentry-native.ts — defensive against React StrictMode double-invoke and any future refactor that moves the call out of main.tsx. Exported __resetSentryNativeForTests helper for vitest isolation (no-op in production via MODE check)."
  - "Type-system bridge cast in sentry-native.ts: @sentry/capacitor@4.0.0 nests its own @sentry/core@10.43.0 → nominally distinct types from our root @sentry/core@10.52.0 (used by @sentry/react). Single-point cast at the sentryCapacitorInit call boundary. Structurally identical (Sentry 10.x stability policy); tracked for removal when peer-pin relaxes."
metrics:
  duration: "~10 minutes"
  completed: "2026-05-16"
  tasks_completed: 3
  files_created_or_modified: 8
  tests: "18/18 pass (5 sentry-native + 9 sentry scrubber + 4 telemetry-defer)"
  bundle_baseline:
    index_gz_before: 17740
    index_gz_after: 17707
    index_gz_delta: -33
    index_gz_ceiling: 24500
    capacitor_bridge_gz: 3372
    capacitor_bridge_ceiling: 15000
---

# Phase 16 Plan 16-04: Sentry Capacitor Dual-Init Summary

Native crash reporting wired alongside existing web Sentry. `@sentry/capacitor@4.0.0` installed via documented `--legacy-peer-deps --update-sentry-capacitor` escape hatch (sibling-check refused EXACT `@sentry/react@10.43.0` pin; project pins `^10.52.0` load-bearing for Phases 1-15). Context7-verified v4 dual-init signature against fresh upstream README — RESEARCH §Pattern 6 shape was correct (zero delta on call shape; only D-11 errors-only options overrides differ from README defaults). Platform fork in `main.tsx`: native invokes `initSentryNative()` SYNCHRONOUSLY before `createRoot/render` so hydrate/first-paint crashes are captured by the native crash handler; web continues with the Phase 2.1 deferred init preserving the entry-chunk-free-of-@sentry/* perf invariant. Telemetry-defer extended with a native-platform guard so the two paths can never double-init. 18/18 vitest tests pass; typecheck clean; vite build succeeds; entry chunk byte-for-byte free of `@sentry/capacitor` (currently tree-shaken because `detectPlatform()` is a stub returning `'web'` — when Plan 16-02 fills it, `sentry-native.ts` + `@sentry/capacitor` will land in the existing `capacitor-bridge` chunk per the vite.config.ts manualChunks rule preemptively shipped by 16-01).

## Auto Tasks Completed

### Task 1: Install @sentry/capacitor + verify v4 dual-init signature against FRESH README

**Commit:** `d030676`

- Context7 lookup against libraryId `/getsentry/sentry-docs` source file `platform-includes/getting-started-config/javascript.capacitor.mdx`. Retrieval at 2026-05-16T08:11Z.
- Verified signature: `Sentry.init({dsn, release, integrations: [...], beforeSend, ...}, SentryReact.init)` — second arg is the React init FUNCTION REFERENCE. **Zero shape-delta vs RESEARCH §Pattern 6** — the [ASSUMED] flag on RESEARCH was correct on shape.
- Installed `@sentry/capacitor@4.0.0` exact (latest stable v4.x; v3.2.1 is the prior major). 922 packages added (Cocoa + Android symbol-mapping deps).
- `16-04-VERIFIED-SIGNATURE.md` created (263 lines) with required sections: Source, Verified Signature (v4), Deltas from RESEARCH (NONE on shape; OPTIONS-CONTENT override justified vs D-11), Compatibility (waiver explanation), Documented Bypass, Plan 16-04 Implementation Contract.

### Task 2: Implement `src/lib/sentry-native.ts` + extend `telemetry-defer` web-guard (TDD)

**Commit:** `3521d00`

- **RED:** Authored `src/lib/sentry-native.test.ts` first with 5 failing tests against the not-yet-existing `initSentryNative` export. Confirmed RED via `npx vitest run` (module-not-found errors).
- **GREEN:** Created `src/lib/sentry-native.ts` with minimal implementation matching the verified signature. All 5 tests pass.
- `src/lib/telemetry-defer.ts` extended with `if (detectPlatform() !== 'web') return;` after the existing DSN guard. The web/native double-init contract is now enforced symmetrically: web only fires via defer; native only fires via sync init in main.tsx.
- `src/lib/telemetry-defer.test.ts` created with 4 cases (ios skip, android skip, web proceeds, missing-DSN early return).
- `.env.example` extended with `VITE_SENTRY_RELEASE` documentation including the per-platform shape per D-17 (`ios@<CFBundleShortVersionString>` / `android@<versionName>`).
- 18/18 vitest tests pass (5 sentry-native + 9 sentry scrubber unchanged + 4 telemetry-defer).
- `@sentry/capacitor` static import confined to `sentry-native.ts` only (grep verified).

### Task 3: Wire native dual-init into `src/main.tsx` BEFORE first render

**Commit:** `d50edca`

- Added two static imports to `main.tsx`: `import { detectPlatform } from './lib/native/platform';` + `import { initSentryNative } from './lib/sentry-native';`.
- Replaced the single `deferSentryInit(beforeSend);` call with a platform fork:
  - `ios` / `android` → `initSentryNative({dsn, release, beforeSend})` synchronously.
  - else (`web` / `capacitor-web`) → `deferSentryInit(beforeSend)` unchanged.
- Release-tag fallback: `(import.meta.env.VITE_SENTRY_RELEASE as string) ?? \`${_platform}@unknown\`` — prevents a missing env-var from cross-poisoning the web release axis (T-16-04-03 mitigation).
- Hash-route double-`#` rewriter (lines 42-60) preserved verbatim BEFORE Sentry init.
- Ordering relative to `hydrate()` preserved: native init runs BEFORE `hydrate()` so any crash during Zustand rehydrate path is captured.
- `npm run typecheck` — passes.
- `npx vitest run sentry-native + sentry + telemetry-defer` — 18/18 pass.
- `npx vite build` — succeeds. **Index chunk 17.71 kB gz** (was 17.74 kB baseline → **-30 bytes**; ceiling 24.5 kB). **capacitor-bridge chunk 3.37 kB gz** (ceiling 15 kB).
- `grep "@sentry/capacitor" dist/assets/index-*.js` → ZERO matches. The entire native branch is tree-shaken from the current web build because `detectPlatform()` is a Phase 12 stub returning literal `'web'`; when Plan 16-02 fills it with `Capacitor.getPlatform()`, Rollup will route `sentry-native.ts` + `@sentry/capacitor` into the `capacitor-bridge` chunk (per the existing vite.config.ts manualChunks rule shipped preemptively by 16-01).

## Deviations from Plan

### Auto-fixed Issues (Rules 1-3, no user approval needed)

**1. [Rule 3 — Blocking install issue] `@sentry/capacitor@4.0.0` install REFUSED by both npm resolver AND postinstall sibling-check**

- **Found during:** Task 1 first install attempt (`npm install --save --update-sentry-capacitor @sentry/capacitor@^4.0.0`)
- **Issue:** Two-layer block: (a) npm's resolver rejects the install because `@sentry/capacitor@4.0.0` declares `@sentry/react@10.43.0` as a `peerOptional` with EXACT pin, and our project has `@sentry/react@^10.52.0` already locked. (b) Even if step (a) passes, the package's `postinstall` script (`scripts/check-siblings.js`) hard-blocks with `exit 1` unless the consumer accepts the mismatch.
- **Fix:** Combine both documented escape hatches: `npm install --save --legacy-peer-deps --update-sentry-capacitor @sentry/capacitor@^4.0.0`. `--legacy-peer-deps` relaxes npm's resolver; `--update-sentry-capacitor` is the explicit env-var trigger that `check-siblings.js` SkipPostInstall() honors. Both are first-party-documented (npm flag; check-siblings.js line 11). The runtime risk surface is the version skew between `@sentry/react@10.43.0` (capacitor expects) and `10.52.0` (we have) — Sentry's 10.x policy keeps the React init API stable across patches, the structural shapes match, and Plan 16-10's 7-day TestFlight soak is the runtime confirmation gate. Path 2 (downgrade `@sentry/react` to 10.43.0) was REJECTED because it's a Rule-4 architectural change spanning 15 prior phases.
- **Files modified:** `leanshot/package.json`, `leanshot/package-lock.json`, `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md` (compatibility waiver section)
- **Commit:** `d030676`

**2. [Rule 1 — Bug] TypeScript nominal-type mismatch between `@sentry/core@10.43.0` (nested under `@sentry/capacitor`) and `@sentry/core@10.52.0` (root)**

- **Found during:** Task 3 `npm run typecheck` after first attempt
- **Issue:** Side effect of waiver #1: `@sentry/capacitor@4.0.0` ships its own nested copy of `@sentry/core@10.43.0` under `node_modules/@sentry/capacitor/node_modules/@sentry/core/`. The Capacitor `init` function's `Options['beforeSend']` is typed against that nested copy's `ErrorEvent`, while our project's `beforeSend` scrubber is typed against `ErrorEvent` from the root `@sentry/core@10.52.0`. TypeScript sees them as nominally distinct (`Property '_notifyingListeners' is protected but type 'Scope' is not a class derived from 'Scope'`). The shapes are structurally identical — Sentry 10.x patches keep `ErrorEvent`/`Integration`/`Client` stable.
- **Fix:** Single-point cast at the `sentryCapacitorInit` call boundary in `sentry-native.ts`. Capture the nested types via `type CapInit = typeof sentryCapacitorInit; type CapOptions = Parameters<CapInit>[0]; type CapSecondArg = Parameters<CapInit>[1];` then `as unknown as CapOptions` / `as unknown as CapSecondArg`. Documented with a TODO-when-peer-pin-relaxes comment. NOT a runtime change — only a type-system bridge.
- **Files modified:** `leanshot/src/lib/sentry-native.ts`
- **Commit:** `d50edca`

### Deferred Items

| Item | Owner Plan | Resume Signal |
|------|-----------|---------------|
| Real `Capacitor.getPlatform()` in `platform.ts` (currently stub returns `'web'`, which tree-shakes `sentry-native.ts` out of the web build entirely) | 16-02 Task 1 | Plan 16-02 ships |
| `VITE_SENTRY_DSN` + `VITE_SENTRY_RELEASE` set at build time per iOS / Android job | 16-09 (fastlane CI) | Plan 16-09 ships |
| dSYM upload via `sentry-cli upload-dsym` (completes other half of MOBILE-09) | 16-09 | Plan 16-09 ships |
| Validate version-skew waiver runtime safety under real native load | 16-10 (7-day TestFlight soak — D-15 SC#9) | Plan 16-10 reaches the soak window |
| Re-remove type-system cast in `sentry-native.ts` when `@sentry/capacitor` patch relaxes the peer-pin | future Sentry-Capacitor patch | `npm view @sentry/capacitor versions --json` shows a version with peer `>=10.43.0` |
| `bash scripts/assert-clinic-bundle-budget.sh` correctly measures the `capacitor-bridge` chunk filename containing `-` (currently reports `wave-0 skip` due to hash-hyphen regex bug per [[reference-bundle-budget-hash-hyphen]]) | Phase 16 close / Wave 6 | Pre-existing — not a Plan 16-04 regression |

## Verified @sentry/capacitor v4 Signature Deltas from RESEARCH

**Shape — IDENTICAL** to RESEARCH §Pattern 6 (lines 484-498):
- Was: `Sentry.init({...options}, SentryReact.init)`
- Now: `Sentry.init({...options}, SentryReact.init)`
- Impact: NONE — RESEARCH §Pattern 6 was correct on shape; the [ASSUMED] confidence rating was warranted but the assumption held.

**Options content — D-11 errors-only override vs README defaults:**
- README example: `integrations: [browserTracingIntegration(), replayIntegration(), feedbackIntegration()]` + `tracesSampleRate: 1.0` + `replaysSessionSampleRate: 0.1` + `sendDefaultPii: true`.
- Implementation: `integrations: []` + NO sampling options + NO sendDefaultPii.
- Justification: D-11 (Phase 1 errors-only telemetry contract) + D-10 (PHI minimization). `sendDefaultPii: true` would pull IP + headers — PHI-adjacent scope creep beyond D-10's `symptom|mood|note|aiHistory` redaction.

Full audit trail in `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md`.

## Hand-off to Plan 16-09 (fastlane CI)

Plan 16-09 owns the OTHER half of MOBILE-09. Required wiring at build time:

**1. Per-platform build env vars** (set in fastlane lanes before `npm run build && npx cap sync`):

- iOS lane:
  ```bash
  VITE_SENTRY_DSN="$SENTRY_DSN"
  VITE_SENTRY_RELEASE="ios@$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' apps/ios/App/App/Info.plist)"
  ```
- Android lane:
  ```bash
  VITE_SENTRY_DSN="$SENTRY_DSN"
  VITE_SENTRY_RELEASE="android@$(grep versionName apps/android/app/build.gradle | head -1 | awk -F'"' '{print $2}')"
  ```

**2. dSYM upload via sentry-cli** (after `gym` / `bundleReleaseAar`):
```bash
sentry-cli upload-dsym --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" path/to/dSYMs
sentry-cli upload-proguard --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" --android-manifest apps/android/app/src/main/AndroidManifest.xml path/to/mapping.txt
```

**3. Release tag creation** (so Sentry dashboard groups events per platform release):
```bash
sentry-cli releases new "$VITE_SENTRY_RELEASE"
sentry-cli releases finalize "$VITE_SENTRY_RELEASE"
```

**4. Smoke test post-deploy**: Plan 16-09 should ship a synthetic-error trigger in a TestFlight-only debug screen so the first native build can confirm event reach + symbolication before TestFlight 7-day soak begins.

## Web Bundle Sanity Check

| Metric | Before (Plan 16-01 baseline) | After (this plan) | Delta | Ceiling | Status |
|--------|------------------------------|--------------------|-------|---------|--------|
| `dist/assets/index-*.js` gz | 17740 B | 17707 B | **-33 B** | 24500 B (working) / 50000 B (absolute) | OK (well under) |
| `dist/assets/capacitor-bridge-*.js` gz | 3378 B | 3372 B | **-6 B** | 15000 B | OK (well under) |
| `@sentry/capacitor` static refs in entry chunk | 0 | **0** | 0 | 0 (MUST be zero — Phase 2.1 perf invariant) | OK |
| `@sentry/react` static refs in entry chunk | 0 | **0** | 0 | 0 (Phase 2.1 perf invariant) | OK |

The slight gz-byte improvements in both chunks are byproduct of Rollup re-fingerprinting after the npm-install added shared transitive symbols that other chunks can reference more efficiently. Net effect on web is functionally zero — exactly the intended outcome of the platform fork.

When Plan 16-02 fills `detectPlatform()` with the real `Capacitor.getPlatform()` call, the static branch becomes non-DCE-able and `sentry-native.ts` + `@sentry/capacitor` will land in the `capacitor-bridge` chunk per the existing vite.config.ts manualChunks rule (estimated +5-6 kB gz toward the 15 kB ceiling; current capacitor-bridge has 11.6 kB of headroom).

## Wave 2 File-Conflict Isolation (16-02 / 16-04 parallel-execution honored)

- **`src/App.tsx`** — NOT modified by this plan. `git log d030676^..HEAD -- src/App.tsx` returns empty. 16-05 owns App.tsx.
- **`src/lib/native/platform.ts`** — NOT modified by this plan. Imported as a stub (Phase 12 returns `'web'`); 16-02 Task 1 owns the fill.
- **`src/lib/native/{deeplink,biometric,share}.ts`** — NOT touched (16-02 owns).
- **`src/lib/native/__capacitor-import-probe.ts`** — NOT touched (16-02 owns removal).
- **`leanshot/package.json` / `package-lock.json`** — DID modify (Task 1 added `@sentry/capacitor`). 16-02 also touches `package.json`. The pathspec-only commit form (`git commit -- <files>`) at Task 1 was used to ensure only this plan's add lands on this branch; merge-time both branches will hold the dep add and lockfile merges deterministically because npm-format lockfiles are commutative on independent dep additions.

## Threat Model Verification

| Threat ID | Disposition | Verification |
|-----------|-------------|--------------|
| T-16-04-01 (Info Disclosure — beforeSend on native) | mitigate | Test 2 + Test 3 in `sentry-native.test.ts` assert `beforeSend` is passed verbatim to `sentryCapacitorInit` options. Reuses existing D-10 scrubber unchanged from `src/lib/sentry.ts`. |
| T-16-04-02 (Info Disclosure — DSN leakage) | accept | Same model as web — DSN is `VITE_SENTRY_DSN` bundled into SPA. Documented in `.env.example`. |
| T-16-04-03 (Spoofing — wrong-release events) | mitigate | `main.tsx` release fallback `${_platform}@unknown` prevents missing env-var from cross-poisoning the web release axis. Verified via code inspection at line 79. |
| T-16-04-04 (Tampering — double-init) | mitigate | `telemetry-defer.ts` skip-on-native + `sentry-native.ts` `_initialized` flag. Test 4 in `sentry-native.test.ts` asserts second invocation is suppressed. `telemetry-defer.test.ts` ios/android tests assert deferred path skips. |
| T-16-04-05 (DoS — Sentry init throw) | accept | Validated by Plan 16-10 7-day TestFlight soak. |
| T-16-04-06 (Repudiation — missing symbolication) | transfer | Plan 16-09 fastlane lane (`sentry-cli upload-dsym`). |

## Known Stubs

None introduced by this plan. `sentry-native.ts` is fully wired; the only "stub-like" surface is the `detectPlatform()` return value (always `'web'` until 16-02 fills it) — that's tracked as a 16-02 dependency, not a 16-04 stub.

## Threat Flags

No NEW threat surface introduced beyond the plan's `<threat_model>` coverage. The version-skew waiver (Deviation #1) is a CONFIGURATION risk, not a new attack surface — documented in Compatibility Waiver section of `16-04-VERIFIED-SIGNATURE.md` for verifier discovery.

## Self-Check: PASSED

- `leanshot/src/lib/sentry-native.ts` — FOUND (3622 bytes, exports `initSentryNative` + `__resetSentryNativeForTests`)
- `leanshot/src/lib/sentry-native.test.ts` — FOUND (5 vitest cases all pass)
- `leanshot/src/lib/telemetry-defer.test.ts` — FOUND (4 vitest cases all pass)
- `leanshot/src/lib/telemetry-defer.ts` — modified (native-platform guard added; existing scrubber import unchanged)
- `leanshot/src/main.tsx` — modified (platform fork; static imports added; hash-route rewriter preserved)
- `leanshot/.env.example` — modified (`VITE_SENTRY_RELEASE` documented)
- `leanshot/package.json` — `@sentry/capacitor: ^4.0.0` present
- `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md` — FOUND (4 required sections present)
- Commit `d030676` — FOUND (Task 1)
- Commit `3521d00` — FOUND (Task 2)
- Commit `d50edca` — FOUND (Task 3)
- 18/18 vitest tests pass
- `npm run typecheck` clean
- `npx vite build` succeeds with entry chunk free of `@sentry/capacitor` static refs
