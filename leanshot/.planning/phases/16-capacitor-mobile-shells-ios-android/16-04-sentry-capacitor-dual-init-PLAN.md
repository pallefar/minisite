---
phase: 16-capacitor-mobile-shells-ios-android
plan: 04
type: execute
wave: 2
depends_on: ["16-01"]
files_modified:
  - leanshot/src/lib/sentry.ts
  - leanshot/src/lib/telemetry-defer.ts
  - leanshot/src/main.tsx
  - leanshot/src/lib/sentry-native.ts
  - leanshot/src/lib/sentry-native.test.ts
  - leanshot/src/lib/sentry.test.ts
  - leanshot/package.json
  - leanshot/.env.example
autonomous: true
requirements: ["MOBILE-09"]
tags: ["capacitor", "sentry", "ios", "android", "crash-reporting"]

must_haves:
  truths:
    - "On `web` platform, telemetry-defer continues to drive `@sentry/react` init AFTER first paint (Phase 2.1 perf fix preserved — entry chunk does NOT statically import @sentry/*)."
    - "On `ios` / `android` platform, `@sentry/capacitor` is initialized SYNCHRONOUSLY in `src/main.tsx` BEFORE `createRoot(...).render(...)` so native crashes during boot/hydrate are captured."
    - "Native init reuses the same `VITE_SENTRY_DSN` from Phase 1 (D-17) and passes a per-platform `release` string of shape `ios@<appVersion>` or `android@<appVersion>` sourced from `VITE_SENTRY_RELEASE`."
    - "The `beforeSend` scrubber from `src/lib/sentry.ts` (existing — D-10 redaction of `symptom|mood|note|aiHistory`) is reused unchanged for native init."
    - "Sentry Capacitor v4 dual-init signature is verified against the FRESH README via Context7 in Task 1 BEFORE implementation; if v4 GA changed the signature, the implementation follows the verified signature, not the RESEARCH §Pattern 6 [ASSUMED] code."
    - "All tests pass: scrubber tests stay green; new native-init guard tests pass under both web and native platform mocks."
  artifacts:
    - path: leanshot/src/lib/sentry-native.ts
      provides: "Native-only Sentry dual-init entry point — calls `Sentry.init({...}, SentryReact.init)` from @sentry/capacitor + @sentry/react. NO-OP on web platform."
      contains: "initSentryNative"
    - path: leanshot/src/lib/sentry-native.test.ts
      provides: "Vitest unit test covering: (a) no-op on web, (b) called once with DSN+release+beforeSend on ios mock, (c) re-init guarded."
    - path: leanshot/src/main.tsx
      provides: "Native branch: invokes initSentryNative() BEFORE createRoot/render when detectPlatform() !== 'web'; otherwise the existing deferSentryInit() runs unchanged."
    - path: leanshot/package.json
      provides: "`@sentry/capacitor` added to dependencies (version pinned to ^4.x per R9 freshness)."
    - path: leanshot/.env.example
      provides: "Documents VITE_SENTRY_DSN + VITE_SENTRY_RELEASE for ios/android builds."
  key_links:
    - from: leanshot/src/main.tsx
      to: leanshot/src/lib/sentry-native.ts
      via: "static import + synchronous call when detectPlatform() !== 'web'"
      pattern: "initSentryNative\\("
    - from: leanshot/src/lib/sentry-native.ts
      to: "@sentry/capacitor + @sentry/react"
      via: "Sentry.init({...}, SentryReact.init) per R9-verified signature"
      pattern: "Sentry\\.init\\("
    - from: leanshot/src/lib/sentry-native.ts
      to: leanshot/src/lib/sentry.ts
      via: "imports `beforeSend` scrubber to preserve D-10 redaction policy on native crashes"
      pattern: "import.*beforeSend.*from.*['\"]\\./sentry['\"]"
    - from: leanshot/src/main.tsx
      to: leanshot/src/lib/native/platform.ts
      via: "import detectPlatform() to fork web vs native init path"
      pattern: "detectPlatform\\("
---

<objective>
Wire `@sentry/capacitor` v4 **dual-init** so native iOS + Android crashes (Sentry Cocoa SDK + Sentry Android SDK, auto-linked by the Capacitor plugin native module) reach the existing Sentry project from Phase 1, while preserving the Phase 2.1 perf fix that keeps `@sentry/react` OUT of the entry static graph for the WEB build.

**Why two init paths?** The web build's cold-load Lighthouse budget (SC#1 ≥0.90, currently held by `scheduleSyncInit` + `deferSentryInit`) cannot afford a static `@sentry/*` import in the entry chunk — that regressed Lighthouse to ~0.76 in Phase 2 (see `src/lib/telemetry-defer.ts` header comment). The native build's WKWebView/WebView host already loads the bundle from `webDir` and the cold-start budget is measured differently (D-15 7-day TestFlight + Sentry `app.start` p95 ≤10s — Plan 16-10) — so the entry-chunk weight tradeoff inverts: on native we MUST init Sentry synchronously before render so a crash in `hydrate()` or first paint is captured natively (the OS will kill the WebView before `requestIdleCallback` fires).

**Resolution:** Platform-fork in `main.tsx`. Web stays exactly as it is today (`deferSentryInit(beforeSend)` after first paint). Native runs a new `initSentryNative({ dsn, release, beforeSend })` synchronously before `createRoot`. The new file `src/lib/sentry-native.ts` is the ONLY place `@sentry/capacitor` is imported — keeps the firewall surface narrow and the codemod auditable.

**Purpose:** Half of MOBILE-09 (init path). The other half — Sentry release tagging via fastlane + native dSYM upload — lands in Plan 16-09. This plan ships the runtime; 16-09 ships the build-time symbol upload.

**Output:** A `src/lib/sentry-native.ts` module + a `main.tsx` platform fork + `@sentry/capacitor` dep. The web build is byte-for-byte equivalent in the entry chunk (no @sentry/* in the static graph). The iOS + Android builds boot with Sentry initialized before the first React render so native crashes are captured.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/PROJECT.md
@leanshot/.planning/ROADMAP.md
@leanshot/.planning/STATE.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md

# Existing telemetry plumbing — DO NOT regress
@leanshot/src/lib/telemetry-defer.ts
@leanshot/src/lib/sentry.ts
@leanshot/src/lib/sentry.test.ts
@leanshot/src/main.tsx

# Phase 16 dependency
# Plan 16-01 must have already installed @capacitor/core and @capacitor/cli + scaffolded apps/ios + apps/android.
# Plan 16-01 must have updated vite.config.ts manualChunks so @sentry/capacitor routes into the capacitor-bridge chunk (≤15 kB gz).
@leanshot/src/lib/native/platform.ts

<interfaces>
<!-- Reusable exports the executor MUST consume — do NOT re-implement. -->

From `leanshot/src/lib/sentry.ts`:
```typescript
import type { ErrorEvent } from '@sentry/react';

export const REDACT_KEYS: Set<string>; // 'symptom' | 'mood' | 'note' | 'aiHistory'

// Pure scrubber — D-10 redaction policy.
// MUST be passed to BOTH the web (deferred) init AND the native (synchronous) init
// so on-device crashes get the same PII redaction as web errors.
export function beforeSend(event: ErrorEvent): ErrorEvent;
```

From `leanshot/src/lib/telemetry-defer.ts`:
```typescript
import type { beforeSend as BeforeSendFn } from './sentry';

// Existing web-only path. Phase 16 EXTENDS this with a `skipIfNative` guard
// (Task 2) so the deferred web init is suppressed on ios/android (the native
// branch in main.tsx handles those platforms synchronously).
export function deferSentryInit(beforeSend: typeof BeforeSendFn): void;
export function deferAnalyticsInit(initFn: () => void): void;
```

From `leanshot/src/lib/native/platform.ts` (must exist after 16-01; if 16-02 has not yet shipped the FILL, the Phase 12 stub still returns `'web'` for every call and the native branch will not execute — that is the correct fallback behavior for Wave 2 ordering):
```typescript
export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';
export function detectPlatform(): Platform;
```

NEW exports this plan introduces (`leanshot/src/lib/sentry-native.ts`):
```typescript
import type { beforeSend as BeforeSendFn } from './sentry';

export interface InitSentryNativeArgs {
  dsn: string;
  release: string; // 'ios@<ver>' or 'android@<ver>' per D-17
  beforeSend: typeof BeforeSendFn;
}

/**
 * Native-only Sentry dual-init.
 * - No-op on web (caller in main.tsx already guards via detectPlatform()).
 * - Idempotent — re-call returns immediately if already initialized.
 * - Synchronous from caller's perspective (Sentry.init returns void; the
 *   actual native bridge call resolves async but the JS layer is set up
 *   before this function returns).
 */
export function initSentryNative(args: InitSentryNativeArgs): void;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install @sentry/capacitor + verify v4 dual-init signature against FRESH README</name>
  <files>leanshot/package.json, leanshot/package-lock.json, leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md</files>
  <read_first>
    - leanshot/package.json — confirm @sentry/react ^10.52.0 is already installed (RESEARCH Pattern 6, line 138 in 16-RESEARCH.md); pin @sentry/capacitor to a compatible major.
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md §Pattern 6 (lines 480–501) — RESEARCH flags this signature as [CONFIDENCE: MEDIUM, ASSUMED]. R9 demands fresh README verification at Wave 2 first task.
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md line 905 — assumption A1 explicitly says "verify against current @sentry/capacitor README; if signature changed in v4 GA, adjust."
  </read_first>
  <action>
    Verify the @sentry/capacitor v4 dual-init signature against the FRESH README via Context7 (the MCP server is configured per CLAUDE.md), then install the package and document the verified signature for Tasks 2 + 3.

    1. **Context7 verification (NOT a guess — fetch live docs):**
       - Call `mcp__context7__resolve-library-id` with the query `@sentry/capacitor` (or `sentry-capacitor`). Capture the resolved libraryId.
       - Call `mcp__context7__get-library-docs` with the resolved libraryId and the topic query `"capacitor react dual init"` (or `"capacitor react init"` if the first returns nothing). Request enough tokens to surface the canonical install snippet (~3000 tokens is sufficient).
       - If Context7 returns no React-specific snippet (the README's primary example is Angular per RESEARCH line 961), fall back to the Bash CLI: `npx --yes ctx7@latest library sentry-capacitor "capacitor react init"` then `npx --yes ctx7@latest docs <libraryId> "capacitor react init"`. If THAT also returns nothing, WebFetch `https://raw.githubusercontent.com/getsentry/sentry-capacitor/main/README.md` and grep for `Sentry.init`.
       - You are looking for THREE specific facts:
         (a) The exact second-argument shape — RESEARCH §Pattern 6 [ASSUMED] form is `Sentry.init(options, SentryReact.init)`. In v4 the second arg MAY have changed (e.g. to an object or to `SentryReact.captureReactException` — verify against the README).
         (b) Whether `release` is a top-level option or nested under `dist`/`environment`.
         (c) Whether v4 requires `@sentry/react` peer at ^10 (we're on ^10.52.0 — confirm compatibility).

    2. **Pin version:** Choose the latest stable v4.x at `^4.x.x` (RESEARCH line 137 cites 4.0.0 published 2026-05-01 as fresh). If Context7/npm-view shows a newer 4.x patch, pin to that. Avoid 5.x even if it exists — peer-compat with @sentry/react ^10 is the constraint, and 5.x bumps are not yet research-validated.

    3. **Install:** From the `leanshot/` working dir, run `npm install --save @sentry/capacitor@^4.x.x` (substitute the verified version). Commit BOTH `package.json` and `package-lock.json`. Per `feedback_parallel_executor_git_isolation.md`, use `git commit -- leanshot/package.json leanshot/package-lock.json` (pathspec form — do NOT `git add -A`, the wave has 16-05 + 16-06 also touching `package.json`).

    4. **Document the verified signature** at `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md` with exactly this structure (markdown):
       - Section "Source": Context7 libraryId + URL + retrieval timestamp.
       - Section "Verified Signature (v4)": fenced TypeScript block showing the EXACT init call shape the README demonstrates (including all required and optional options).
       - Section "Deltas from RESEARCH §Pattern 6": bulleted list. If signature is identical, write "Signature identical to RESEARCH §Pattern 6 [ASSUMED] — proceed as-documented." If different, list every delta with `- Was: <RESEARCH form>` / `- Now: <verified form>` / `- Impact: <which task adjusts>`.
       - Section "Compatibility": confirm @sentry/react ^10.52.0 peer satisfied. If not satisfied, HALT the plan and surface to orchestrator.

    5. **DO NOT modify any code files in this task.** Task 2 + Task 3 consume the verified signature from `16-04-VERIFIED-SIGNATURE.md`. Keeping verification separate from implementation makes the dual-init audit-trail explicit for security review (Sentry sees PII via stack-frame variable names — D-10 scrubber correctness depends on knowing exact event shape).

    PII safety: never paste a real DSN into `16-04-VERIFIED-SIGNATURE.md` — use placeholder `<dsn>`.
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; node -e "const p=require('./package.json'); if(!p.dependencies['@sentry/capacitor']) {console.error('FAIL: @sentry/capacitor not in dependencies'); process.exit(1);} if(!p.dependencies['@sentry/capacitor'].startsWith('^4.')) {console.error('FAIL: not pinned to ^4.x:', p.dependencies['@sentry/capacitor']); process.exit(1);} console.log('OK', p.dependencies['@sentry/capacitor']);" &amp;&amp; test -f .planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md &amp;&amp; grep -q "Verified Signature" .planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md &amp;&amp; grep -q "Deltas from RESEARCH" .planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md</automated>
  </verify>
  <done>
    `@sentry/capacitor@^4.x.x` is in `leanshot/package.json` dependencies and `leanshot/package-lock.json`; `16-04-VERIFIED-SIGNATURE.md` exists with all four required sections; the verified TypeScript snippet is captured verbatim from the v4 README; any delta from RESEARCH §Pattern 6 is enumerated with explicit impact statements; no code files modified yet.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement `src/lib/sentry-native.ts` + extend `telemetry-defer` web-guard</name>
  <files>leanshot/src/lib/sentry-native.ts, leanshot/src/lib/sentry-native.test.ts, leanshot/src/lib/telemetry-defer.ts, leanshot/src/lib/sentry.test.ts, leanshot/.env.example</files>
  <read_first>
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md — Task 1 output. The Sentry.init signature in `sentry-native.ts` MUST match this file exactly. If it diverges, the audit trail is broken.
    - leanshot/src/lib/telemetry-defer.ts (full file) — understand the existing pre-init buffer + `requestIdleCallback` schedule before extending. The web guard you add MUST preserve the existing buffer drain on web.
    - leanshot/src/lib/sentry.ts (full file) — `beforeSend` is the existing D-10 scrubber. Re-export shape; the native init imports it unchanged.
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md §"vi.mock for Capacitor plugins" (lines 696–712) — vitest mock convention you must follow for the test file.
    - leanshot/src/lib/sentry.test.ts — existing scrubber tests. After your changes, these must still pass (`beforeSend` API unchanged; you are adding a sibling module, not refactoring `sentry.ts`).
  </read_first>
  <behavior>
    Test cases the new `sentry-native.test.ts` MUST cover (write tests FIRST per `tdd="true"`):

    - **Test 1 (no-op on web):** With `@capacitor/core` mocked so `Capacitor.getPlatform()` returns `'web'`, calling `initSentryNative({ dsn: 'https://x@x.ingest.sentry.io/1', release: 'web@1.0.0', beforeSend })` must NOT call the mocked `Sentry.init` from `@sentry/capacitor`. (Native init is gated by the caller in main.tsx, but the function itself must also be defensive — double-guard. This protects against accidental web-side imports during refactors.)
    - **Test 2 (ios path):** With `@capacitor/core` mocked to return `'ios'`, calling `initSentryNative({...})` calls the mocked `Sentry.init` from `@sentry/capacitor` exactly once, with `dsn`, `release`, and `beforeSend` correctly propagated to the options arg, AND with the second arg being the mocked `SentryReact.init` from `@sentry/react` (per Task 1 verified signature — if the verified signature shape differs, the assertion shape follows the verified signature).
    - **Test 3 (android path):** Same as Test 2 but `'android'` — calls go through identically. (Confirms there is no per-platform code branch inside `initSentryNative`; the function treats ios and android as one.)
    - **Test 4 (idempotency):** Calling `initSentryNative({...})` twice on the same platform results in `Sentry.init` being called ONCE (module-level `_initialized` flag). This guards against React StrictMode double-invoke side effects if anyone moves the call out of main.tsx.
    - **Test 5 (missing DSN):** Calling `initSentryNative({ dsn: '', release: 'ios@1.0.0', beforeSend })` does NOT call `Sentry.init` — early return matches `telemetry-defer.ts` line 58 `if (!dsn) return;` behavior. Logs nothing (no console noise).

    Test scaffolding pattern (vi.mock at top of file, mirroring PATTERNS.md lines 698-712):
    ```typescript
    vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: vi.fn(() => 'web'), isNativePlatform: vi.fn(() => false) } }));
    vi.mock('@sentry/capacitor', () => ({ init: vi.fn() }));
    vi.mock('@sentry/react', () => ({ init: vi.fn() }));
    ```
    Use `beforeEach(() => { vi.clearAllMocks(); resetSentryNativeInitState(); })` — the production module MUST export a test-only reset helper named exactly `__resetSentryNativeForTests` (NOT exported from the public surface; gated behind a `if (import.meta.env.MODE === 'test')` check or a `__test__` namespace). Standard pattern used by `stripe-webhook` lazy-init.
  </behavior>
  <action>
    1. **Create `leanshot/src/lib/sentry-native.test.ts` FIRST** (RED). Author all five tests from `<behavior>` against the not-yet-existing `initSentryNative` export. Run `npx vitest run src/lib/sentry-native.test.ts` and confirm all five fail with "module not found" or "is not a function" — this is the RED phase.

    2. **Create `leanshot/src/lib/sentry-native.ts`** (GREEN). Minimal implementation:
       - File header comment: "Native-only Sentry dual-init entry point (Phase 16 — MOBILE-09 init half). The web build NEVER reaches this code path; `main.tsx` forks on `detectPlatform()` and the deferred web init in `telemetry-defer.ts` handles the SPA case. Keeping `@sentry/capacitor` imports isolated here keeps the entry chunk free of @sentry/* — only the native build's static graph pulls this module in (its `webDir` bundle is loaded by WKWebView/WebView; the entry-chunk budget gate is different from web's Lighthouse budget)."
       - Imports: `Capacitor` from `@capacitor/core`; `init as sentryCapacitorInit` (alias to avoid name collision) from `@sentry/capacitor`; `init as sentryReactInit` from `@sentry/react`; `beforeSend` TYPE from `./sentry` (type-only import — `import type { beforeSend as BeforeSendFn } from './sentry'`).
       - Export `interface InitSentryNativeArgs { dsn: string; release: string; beforeSend: typeof BeforeSendFn; }`.
       - Module-level `let _initialized = false;`.
       - Export `function initSentryNative(args: InitSentryNativeArgs): void`:
         - Early-return if already initialized.
         - Early-return if `!args.dsn`.
         - Compute `platform = Capacitor.getPlatform()`. Early-return if `platform !== 'ios' && platform !== 'android'`.
         - Call `sentryCapacitorInit({ dsn: args.dsn, release: args.release, beforeSend: args.beforeSend, /* integrations + tracesSampleRate per VERIFIED-SIGNATURE — copy verbatim */ }, sentryReactInit)` — **the exact options shape MUST match Task 1's `16-04-VERIFIED-SIGNATURE.md` § "Verified Signature (v4)" block**. If the verified signature includes `integrations: []` (mirroring D-11 errors-only from `telemetry-defer.ts` line 68), follow that. If the verified signature shows `tracesSampleRate: 0.1` as RESEARCH suggested, follow that. If verified signature OMITS integrations/tracesSampleRate (v4 defaults), follow that. DO NOT invent options.
         - Set `_initialized = true`.
       - Export `function __resetSentryNativeForTests(): void { _initialized = false; }` — guarded by `// istanbul ignore next` comment + a runtime check `if (import.meta.env.MODE !== 'test') return;` so a tree-shaker preserves it under vitest but the production native build no-ops if anyone tries to call it.
       - PII safety: NEVER log `args.dsn` to console. The DSN is a low-sensitivity secret but our convention (per `stripe-webhook/index.ts`) is to never echo secret args.
       - Run `npx vitest run src/lib/sentry-native.test.ts` — all 5 tests should pass (GREEN).

    3. **Extend `leanshot/src/lib/telemetry-defer.ts`** with a web-platform guard. Add at the top of `deferSentryInit` (right after the existing `if (!dsn) return;` at current line 58):
       ```
       // Phase 16 MOBILE-09: on native platforms, the synchronous dual-init in
       // `src/lib/sentry-native.ts` (called from main.tsx BEFORE first render)
       // owns Sentry init. The deferred web path stays no-op on ios/android so
       // we don't double-init and double-send events.
       ```
       Then conditionally import `detectPlatform` lazily to avoid pulling it into the deferred-chunk graph: use a dynamic import via `await import('./native/platform')` inside an async IIFE, OR — preferred for simplicity — a direct static `import { detectPlatform } from './native/platform';` at the top (the platform module is tiny, ~200 bytes gz, and 16-02 will fill it with the real Capacitor.getPlatform call). Guard: `if (detectPlatform() !== 'web') return;` immediately after the DSN check.
       - Add a new test case to `leanshot/src/lib/sentry.test.ts` OR a new file `leanshot/src/lib/telemetry-defer.test.ts` (create if it doesn't exist, mirroring the vitest config from PATTERNS.md §"Config pattern"). Test: "deferSentryInit is a no-op when detectPlatform() returns 'ios'" — mock `./native/platform` so `detectPlatform` returns `'ios'`, mock `@sentry/react` so `init` is a `vi.fn()`, call `deferSentryInit(beforeSend)`, advance timers past 100ms (or `requestIdleCallback` fake-time), assert `init` was NOT called.
       - The existing two scrubber tests in `sentry.test.ts` MUST continue to pass — verify with `npx vitest run src/lib/sentry.test.ts`.

    4. **Update `leanshot/.env.example`** to document the two env vars: append (if not present):
       ```
       # Sentry (Phase 1 web + Phase 16 native dual-init)
       VITE_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<projectId>
       # Per D-17: separate release strings per platform. Web build leaves blank
       # or uses 'web@<package-version>'. iOS build sets 'ios@<CFBundleShortVersionString>'.
       # Android build sets 'android@<versionName>'. Wired by fastlane in Plan 16-09.
       VITE_SENTRY_RELEASE=
       ```
       If `.env.example` doesn't exist, create it.

    PII safety: do NOT add any real DSN to `.env.example` — the value must remain a placeholder.

    Commit hygiene: per `feedback_parallel_executor_git_isolation.md`, use `git commit -- <pathspec>` listing each file explicitly. Files modified by THIS plan (do NOT include 16-05's or 16-06's files even if they appear in the working tree from a parallel executor): `leanshot/src/lib/sentry-native.ts`, `leanshot/src/lib/sentry-native.test.ts`, `leanshot/src/lib/telemetry-defer.ts`, `leanshot/src/lib/sentry.test.ts` (if modified) OR `leanshot/src/lib/telemetry-defer.test.ts` (if newly created), `leanshot/.env.example`.
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; npx vitest run src/lib/sentry-native.test.ts src/lib/sentry.test.ts &amp;&amp; grep -q "initSentryNative" src/lib/sentry-native.ts &amp;&amp; grep -q "detectPlatform" src/lib/telemetry-defer.ts &amp;&amp; grep -v '^#' src/lib/sentry-native.ts | grep -c "Sentry\\|sentryCapacitorInit\\|sentryReactInit" | awk '$1 &gt;= 2 {exit 0} {exit 1}' &amp;&amp; grep -q "VITE_SENTRY_DSN" .env.example</automated>
  </verify>
  <done>
    `src/lib/sentry-native.ts` exports `initSentryNative` + `InitSentryNativeArgs`; the implementation matches the verified signature from Task 1; the test file has 5 passing tests covering web no-op, ios path, android path, idempotency, missing-DSN; `telemetry-defer.ts` skips the deferred init on `ios`/`android`; existing `sentry.test.ts` scrubber tests still pass; `.env.example` documents both env vars; @sentry/capacitor is imported ONLY in `sentry-native.ts` (grep confirms no other file imports it).
  </done>
</task>

<task type="auto">
  <name>Task 3: Wire native dual-init into `src/main.tsx` BEFORE first render</name>
  <files>leanshot/src/main.tsx</files>
  <read_first>
    - leanshot/src/main.tsx (full file, all 112 lines) — understand the exact existing init sequence: (1) hash-route double-`#` rewriter, (2) `deferSentryInit(beforeSend)`, (3) `applyThemeToDOM`, (4) localStorage cleanup, (5) `hydrate()` + `createRoot` + `deferAnalyticsInit` + `scheduleSyncInit`. Your insertion point is BETWEEN step 2 (current line 65 `deferSentryInit(beforeSend);`) — convert it to a platform-fork. Web keeps `deferSentryInit`; native calls `initSentryNative` instead.
    - leanshot/src/lib/sentry-native.ts (just-created in Task 2) — confirm the export name `initSentryNative` and its argument shape.
    - leanshot/src/lib/native/platform.ts — confirm `detectPlatform()` is callable synchronously (it is — `Capacitor.getPlatform()` is a sync read of a JS-bridge-injected window property).
    - leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-VERIFIED-SIGNATURE.md — confirm release-tag wiring matches the verified signature.
  </read_first>
  <action>
    Replace the existing `deferSentryInit(beforeSend);` call (current `src/main.tsx` line 65) with a platform fork. The web path stays bit-identical to today's behavior; the native path runs SYNCHRONOUSLY before the existing `hydrate().then(...)` block (which currently sits at line 92).

    Precise diff intent (do NOT inline code in this action; the executor authors the edit):

    1. Add import (alongside existing `import { beforeSend } from './lib/sentry';` at line 7): `import { initSentryNative } from './lib/sentry-native';` and `import { detectPlatform } from './lib/native/platform';`.

    2. Replace the current single-line call `deferSentryInit(beforeSend);` (with the surrounding Phase 2.1 comment block intact — preserve lines 57–64 verbatim, that comment explains the WEB perf-fix rationale) with a platform fork. Add a NEW comment block ABOVE the existing Phase 2.1 block explaining the fork:
       ```
       // Phase 16 MOBILE-09: native-platform Sentry init runs SYNCHRONOUSLY here,
       // BEFORE createRoot below, so a crash during hydrate()/first-paint is
       // captured by Sentry Cocoa / Sentry Android (native crash handler is
       // armed once Sentry.init resolves the bridge). The web path's deferred
       // init stays unchanged (Phase 2.1 perf fix below).
       //
       // VITE_SENTRY_RELEASE is set per-platform by fastlane in Plan 16-09:
       // - iOS:     'ios@${CFBundleShortVersionString}'
       // - Android: 'android@${versionName}'
       // The DSN is the SAME Phase 1 project (D-17 — one project, separate
       // releases for symbolication routing).
       ```
       Then the fork:
       - Read `const platform = detectPlatform();`
       - If `platform === 'ios' || platform === 'android'`: call `initSentryNative({ dsn: import.meta.env.VITE_SENTRY_DSN as string ?? '', release: (import.meta.env.VITE_SENTRY_RELEASE as string) ?? `${platform}@unknown`, beforeSend });`. The `?? '${platform}@unknown'` fallback prevents a missing-env-var from crashing on boot; Sentry's release field accepts any string and "unknown" is a known sentinel value.
       - Else (web / capacitor-web): call `deferSentryInit(beforeSend);` (existing call, unchanged).

    3. Confirm the ordering relative to `applyThemeToDOM` (current line 78) is intentional: theme is applied AFTER Sentry init so a theme-application crash is captured. Do not change that ordering.

    4. Confirm the ordering relative to `hydrate()` (current line 92): native init MUST happen before `hydrate()` so any crash during the Zustand rehydrate path is captured natively. The fork insertion as specified (replacing the existing line 65) preserves this ordering.

    5. Do NOT touch the hash-route double-`#` rewriter (lines 37–55) — that block must stay BEFORE Sentry init because supabase-js's URL parse error has its own surfacing path and Sentry-init failures must not be triggered by malformed boot URLs.

    Web-build sanity check: after the edit, the web build's entry chunk MUST still be free of `@sentry/capacitor` and `@sentry/react` static imports. The `initSentryNative` symbol IS imported statically here, but tree-shaking elides the body on web because `detectPlatform() === 'web'` is statically inferrable in `Capacitor.getPlatform()` when `@capacitor/core` is loaded (the Capacitor JS bundle is also in `capacitor-bridge` chunk per D-12 / Plan 16-01 vite manualChunks). The audit guard: `npx vite build` then `grep -l "sentry-capacitor\\|@sentry/react" dist/assets/index-*.js` should return ZERO matches (Sentry vendor code lives in `capacitor-bridge-*.js` or its own chunk; the entry chunk only has the `initSentryNative` symbol reference which resolves at runtime).

    Commit hygiene: this task touches ONLY `leanshot/src/main.tsx`. Per `feedback_parallel_executor_git_isolation.md`, commit with `git commit -- leanshot/src/main.tsx`. Do NOT `git add -A`.
  </action>
  <verify>
    <automated>cd leanshot &amp;&amp; npm run typecheck &amp;&amp; npx vitest run src/lib/sentry-native.test.ts src/lib/sentry.test.ts &amp;&amp; grep -q "initSentryNative" src/main.tsx &amp;&amp; grep -q "detectPlatform" src/main.tsx &amp;&amp; grep -v '^[[:space:]]*//\\|^[[:space:]]*\\*' src/main.tsx | grep -c "deferSentryInit\\|initSentryNative" | awk '$1 &gt;= 2 {exit 0} {exit 1}' &amp;&amp; npx vite build &amp;&amp; ! grep -l "@sentry/capacitor" dist/assets/index-*.js 2&gt;/dev/null</automated>
  </verify>
  <done>
    `src/main.tsx` imports `initSentryNative` from `./lib/sentry-native` and `detectPlatform` from `./lib/native/platform`; the platform-fork replaces the single `deferSentryInit(beforeSend)` call with an `if/else` that calls `initSentryNative` on ios/android and `deferSentryInit` on web; typecheck passes; vitest tests still pass; `vite build` succeeds; the entry chunk `dist/assets/index-*.js` contains NO `@sentry/capacitor` static reference (Sentry code is confined to lazily-loaded or capacitor-bridge chunks); the existing hash-route double-`#` rewriter and `hydrate().then(...)` boot order are preserved.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Native crash handler → Sentry SaaS | Native crashes (Cocoa/Android) flow to Sentry over HTTPS via the SDK; DSN is the auth bearer. |
| WebView JS → @sentry/capacitor JS bridge | JS errors on native are forwarded to the native SDK via Capacitor's plugin bridge then to Sentry SaaS. |
| Build pipeline (Plan 16-09) → Sentry release tagging | `VITE_SENTRY_RELEASE` env var is set at build time by fastlane; the value forms the release-tag axis on the Sentry org dashboard. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-04-01 | Information Disclosure | `beforeSend` scrubber on native crashes | mitigate | Reuse the existing `beforeSend` from `src/lib/sentry.ts` unchanged (D-10 redacts `symptom|mood|note|aiHistory`); Task 2 Test 2/Test 3 assert it is wired into the native init call. This guarantees on-device crash payloads get the same PII redaction as web errors. |
| T-16-04-02 | Information Disclosure | DSN leakage via build artifacts | accept | DSN is embedded in `import.meta.env.VITE_SENTRY_DSN` at build time and bundled into the SPA — same threat model as the web build (which has shipped this way since Phase 1). DSN is low-sensitivity (Sentry's own model: DSN is a "send-only" credential; cannot be used to read events). No additional mitigation. |
| T-16-04-03 | Spoofing | Wrong-release events poison the wrong release dashboard | mitigate | Task 3 wires `release: '${platform}@unknown'` as fallback when `VITE_SENTRY_RELEASE` is missing — events still go to the correct project but to a sentinel release. Plan 16-09's fastlane lane sets the real release at build time. The fallback prevents an unset env var from cross-poisoning the web release. |
| T-16-04-04 | Tampering | Double-init (one from web defer, one from native sync) causes duplicate events | mitigate | Task 2 extends `telemetry-defer.ts` to early-return on `ios`/`android`. `initSentryNative` is idempotent (`_initialized` flag) so even if main.tsx were edited later to call it twice, only one init fires. Task 2 Test 4 covers this. |
| T-16-04-05 | Denial of Service | Sentry SDK init throw crashes app boot | accept | Sentry SDK init is wrapped by its own try/catch internally; v4 README does NOT document a synchronous throw path. If the SDK does throw, the WebView dies → native crash handler captures → next launch is clean. Re-evaluate if this fires in Plan 16-10 7-day TestFlight soak. |
| T-16-04-06 | Repudiation | Native crash captured but lacks the source-map symbolication | transfer | dSYM upload is Plan 16-09's responsibility (fastlane `gym` → `sentry-cli upload-dsym`). This plan only ships the runtime init; symbolication is build-pipeline scope. |
</threat_model>

<verification>
Phase-level checks for this plan:

1. **No double-init on native:** `npx vitest run src/lib/sentry-native.test.ts` — Test 4 (idempotency) passes.
2. **No double-init across paths:** `npx vitest run` over the deferred-init test (Task 2 step 3) confirms `deferSentryInit` is a no-op when platform is `'ios'` or `'android'`.
3. **Web Lighthouse budget preserved:** `npx vite build` then `grep -l "@sentry/capacitor\|@sentry/react" dist/assets/index-*.js` — must return ZERO matches (entry chunk free of @sentry/*). The bundle-budget CI gate from Plan 12-01 (extended in Plan 16-01) enforces this automatically on PR.
4. **Scrubber wiring:** grep `src/lib/sentry-native.ts` for `beforeSend` — must appear in the import block AND in the `sentryCapacitorInit({ ..., beforeSend })` options. Test 2 + Test 3 assertions cover this.
5. **R9 audit trail:** `16-04-VERIFIED-SIGNATURE.md` exists and matches the verified signature used in `sentry-native.ts` line-for-line.
6. **Cross-plan-isolation (Wave 2 file-conflict guard):** This plan does NOT modify `src/App.tsx`. `git log --name-only HEAD -- leanshot/src/App.tsx | head -5` should NOT show any commits from this plan's executor. (16-05 owns App.tsx.)
</verification>

<success_criteria>
- [ ] `@sentry/capacitor@^4.x.x` installed; signature verified against fresh README; `16-04-VERIFIED-SIGNATURE.md` documents the verified call shape with explicit deltas-vs-RESEARCH section.
- [ ] `src/lib/sentry-native.ts` exists, exports `initSentryNative`, is the ONLY file importing `@sentry/capacitor`, has 5 passing vitest cases (web no-op, ios, android, idempotency, missing-DSN).
- [ ] `src/lib/telemetry-defer.ts` early-returns on `ios`/`android` platforms — no double-init.
- [ ] `src/main.tsx` forks on `detectPlatform()`: native calls `initSentryNative(...)` synchronously BEFORE `createRoot/render`; web calls `deferSentryInit(beforeSend)` as today.
- [ ] `npm run typecheck` passes; `npx vitest run` (full suite) passes; `npx vite build` succeeds.
- [ ] Entry chunk `dist/assets/index-*.js` does NOT statically reference `@sentry/capacitor` or `@sentry/react` (vendor code is in `capacitor-bridge` or its own chunk).
- [ ] `.env.example` documents `VITE_SENTRY_DSN` and `VITE_SENTRY_RELEASE` with per-platform usage notes.
- [ ] No edits to `src/App.tsx` (16-05 owns); no edits to Podfile/build.gradle (the @sentry/capacitor plugin auto-links Sentry Cocoa + Sentry Android via Capacitor 8 plugin spec — no manual Podfile edit needed at this plan's level; if 16-01's SPM audit found a CocoaPods fallback case, that adjustment lives in 16-01, not here).
- [ ] dSYM upload + release-tag wiring deferred to Plan 16-09 (explicit handoff, NOT a silent omission — completes the other half of MOBILE-09).
</success_criteria>

<output>
After completion, create `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-04-SUMMARY.md` with:
- Verified @sentry/capacitor v4 signature deltas from RESEARCH (paste/reference `16-04-VERIFIED-SIGNATURE.md`)
- Exact pinned version of @sentry/capacitor in package.json
- Hand-off note to Plan 16-09 listing the two env vars fastlane MUST set per build (`VITE_SENTRY_DSN`, `VITE_SENTRY_RELEASE`) and the dSYM upload step that completes MOBILE-09
- Confirmation that web entry chunk byte-count is unchanged (or delta if any — should be ~0 bytes since the new symbol references are tree-shaken on web)
- Confirmation that `src/App.tsx` was NOT modified (Wave 2 file-conflict isolation honored)
</output>
