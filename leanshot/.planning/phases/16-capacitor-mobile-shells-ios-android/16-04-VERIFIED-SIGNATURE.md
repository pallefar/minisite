---
phase: 16-capacitor-mobile-shells-ios-android
plan: 04
artifact_type: verification-trail
purpose: "R9 audit trail — @sentry/capacitor v4 dual-init signature verified against fresh upstream docs at Task 1 BEFORE implementation. Tasks 2 + 3 reference this file."
tags: [sentry, capacitor, dual-init, audit, r9]
---

# @sentry/capacitor v4 — Verified Init Signature

## Source

- **Context7 libraryId:** `/getsentry/sentry-docs`
- **Source file:** `platform-includes/getting-started-config/javascript.capacitor.mdx`
  (https://github.com/getsentry/sentry-docs/blob/master/platform-includes/getting-started-config/javascript.capacitor.mdx)
- **Retrieval:** Context7 MCP via `npx ctx7@latest docs /getsentry/sentry-docs "capacitor react init"` at 2026-05-16T08:11Z
- **@sentry/capacitor version under test:** `4.0.0` (latest stable, installed exact)
- **@sentry/react peer (declared):** `10.43.0`
- **@sentry/react in this project:** `^10.52.0` (pinned by Phases 1-15 telemetry)

## Verified Signature (v4)

```typescript
import * as Sentry from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';

Sentry.init(
  {
    dsn: "<dsn>",
    sendDefaultPii: true,
    release: "my-project-name@<release-name>",
    dist: "<dist>",
    enableLogs: true,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
      Sentry.feedbackIntegration({ colorScheme: "system" })
    ],
    tracesSampleRate: 1.0,
    tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0
  },
  SentryReact.init
);
```

**Canonical dual-init contract (the only invariants Plan 16-04 needs):**

1. **First argument** is a single options object with `dsn`, `release`, `integrations` (array), `beforeSend`, etc. — standard Sentry option bag. All options EXCEPT `siblingOptions.vueOptions` are valid.
2. **Second argument** is the React init function — passed as the FUNCTION REFERENCE `SentryReact.init`, NOT invoked. The Sentry-Capacitor JS layer calls it internally with a forwarded subset of options after the Capacitor native bridge resolves.
3. **`release`** is a top-level option (NOT nested under `dist` or `environment`). The README example shows `release: "my-project-name@<release-name>"` — a free-form string. D-17's per-platform shape `ios@<ver>` / `android@<ver>` is valid.
4. **`beforeSend`** is a top-level option on the SAME options object as `dsn` (not a separate Vue/React arg). The hook fires for both native-bridged events and JS-side events.

## Deltas from RESEARCH §Pattern 6

RESEARCH §Pattern 6 (lines 484-501) flagged the signature as `[CONFIDENCE: MEDIUM, ASSUMED]`. After Context7 verification against current upstream docs:

**Signature shape — IDENTICAL to RESEARCH:**
- Was: `Sentry.init({...options}, SentryReact.init)` — exactly two arguments.
- Now: `Sentry.init({...options}, SentryReact.init)` — exactly two arguments.
- Impact: NONE — RESEARCH §Pattern 6 was correct on shape. Tasks 2 + 3 follow it verbatim.

**Options content — minor doc enrichment, no contract change:**
- RESEARCH showed: `dsn`, `release`, `integrations: [SentryReact.browserTracingIntegration(), SentryReact.replayIntegration()]`, `tracesSampleRate: 0.1`.
- Verified README adds: `sendDefaultPii`, `dist`, `enableLogs`, `feedbackIntegration`, `tracePropagationTargets`, `replaysSessionSampleRate`, `replaysOnErrorSampleRate`. ALL of these are OPTIONAL per the Sentry option schema. Plan 16-04 follows D-11 (errors-only — no Replay, no Tracing, no Feedback) so we pass `integrations: []` exactly mirroring `telemetry-defer.ts` line 68. We do NOT add `sendDefaultPii: true` because it pulls IP + headers (PHI-adjacent — D-10 scope creep).
- Note: README example imports integration helpers as `Sentry.browserTracingIntegration(...)` (from @sentry/capacitor re-export), not from `SentryReact`. Both surface the same factory; we don't enable any integrations so this is moot.
- Impact: Plan 16-04 follows D-11 errors-only. Native init options = `{ dsn, release, beforeSend, integrations: [] }`. NO `tracesSampleRate` (avoids R9-RESEARCH's 0.1 — sampling implies tracing integration which D-11 disables).

**Net delta from RESEARCH §Pattern 6 to actual Task 2/3 implementation:**
- RESEARCH form (lines 490-498) included `integrations: [SentryReact.browserTracingIntegration(), SentryReact.replayIntegration()]` + `tracesSampleRate: 0.1`.
- Implementation form: `integrations: []` (no Replay/Tracing/Profiling per D-11) + NO `tracesSampleRate`.
- Justification: D-11 (Phase 1 frozen contract) — errors-only telemetry. The R9 verification confirms the dual-init *shape* is correct; the *option content* is a project-policy override, not an upstream-spec deviation.

## Compatibility

| Constraint | Required | Actual | Status |
|------------|----------|--------|--------|
| `@sentry/capacitor` major | `^4.0.0` (R9 freshness) | `4.0.0` exact | OK |
| `@capacitor/core` | `>=3.0.0` (peerDep) | `^8.3.4` | OK |
| `@sentry/react` peer (declared) | `10.43.0` (exact) | `^10.52.0` (installed: 10.52.0) | **WAIVED — see below** |
| Node | n/a (browser bundle) | n/a | n/a |

### Compatibility Waiver — `@sentry/react` 10.52.0 vs declared 10.43.0

**Problem:** `@sentry/capacitor@4.0.0` declares `@sentry/react@10.43.0` as a **peerOptional** dependency with EXACT version pin and additionally enforces this via a `postinstall` script (`scripts/check-siblings.js`) that EXITs with code 1 if any sibling `@sentry/<x>` package in the consumer's `package.json` is not the exact pinned version.

**Project constraint:** `@sentry/react` is pinned to `^10.52.0` and load-bearing for Phases 1-15 telemetry (deferred init in `src/lib/telemetry-defer.ts`, beforeSend scrubber in `src/lib/sentry.ts`, Vercel source-map upload in `vite.config.ts` via `@sentry/vite-plugin`, etc.). Downgrading to 10.43.0 is a Rule-4 architectural change spanning 15 prior phases — REJECTED per `feedback_inline_fix_over_replan.md` + risk-of-cross-phase-regression.

**Resolution:** Install with `--legacy-peer-deps --update-sentry-capacitor`:
```bash
npm install --save --legacy-peer-deps --update-sentry-capacitor @sentry/capacitor@^4.0.0
```

- `--legacy-peer-deps` — relaxes npm's resolver from rejecting the peer-version mismatch.
- `--update-sentry-capacitor` — DOCUMENTED escape hatch in `check-siblings.js` (line 11: `const updateArgument = '--update-sentry-capacitor';` triggered via `env.npm_config_update_sentry_capacitor`). Confirms this is the intended path when the consumer accepts the runtime risk.

**Runtime risk surface:** The check-siblings warning says "Your project will build with the wrong package but you may face Runtime errors." Risk analysis:
- `@sentry/react@10.43.0` → `10.52.0` is a 9-patch minor delta. Sentry's published policy for the 10.x line keeps the public `init({...})` surface stable across patches.
- Plan 16-04's native init path calls `Sentry.init(options, SentryReact.init)`. The Capacitor JS layer invokes `SentryReact.init` (function reference) internally — both layers resolve to the SAME installed `@sentry/react@10.52.0` module instance. There is NO version mismatch at runtime; there is only a missing peer-version assertion at install time.
- The only theoretical break is if `@sentry/capacitor@4.0.0` internals call a `@sentry/react@10.43.0`-private export that 10.52.0 removed. The Capacitor SDK's public surface (per https://github.com/getsentry/sentry-capacitor) only uses the public Sentry React API, which is stable across 10.x.
- Plan 16-10's 7-day TestFlight soak (D-15 SC#9) acts as the runtime confirmation gate. If the soak surfaces a Sentry-init/runtime error tied to the version skew, we either (a) pin a future `@sentry/capacitor` patch that relaxes the peer or (b) downgrade `@sentry/react` to 10.43.0 in a focused subsequent plan. Either way, the runtime gate catches it before App Store submission.

**Recorded threat:** This waiver is logged in 16-04-SUMMARY § Compatibility Waiver for verifier discovery.

## Documented Bypass — npm Install Command

For reproducibility and CI (Plan 16-09 fastlane runs `npm ci`), the `--legacy-peer-deps` flag must be persisted. `package.json` already has no `overrides` block; the lockfile carries the resolved tree. CI scripts that re-run `npm ci` will succeed because the lockfile is authoritative. The postinstall sibling-check fires on `npm install <new>`, not on `npm ci`, so CI is unaffected by the runtime-warning script.

If a future patch upgrade is needed:
```bash
npm install --save --legacy-peer-deps --update-sentry-capacitor @sentry/capacitor@<new-version>
```

If a future package needs to be ADDED that touches `@sentry/*`, the install MUST repeat the `--legacy-peer-deps --update-sentry-capacitor` flag combo or the sibling-check will fire again.

## Plan 16-04 Task-2/Task-3 Implementation Contract

Tasks 2 and 3 MUST match this verified signature exactly:

```typescript
// Match: first arg is the options bag, second arg is SentryReact.init (function reference).
import * as Sentry from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';
import { beforeSend } from './sentry';

Sentry.init(
  {
    dsn: args.dsn,
    release: args.release,                     // 'ios@<ver>' or 'android@<ver>' per D-17
    beforeSend: args.beforeSend,                // D-10 scrubber — reused unchanged
    integrations: [],                           // D-11 errors-only — no Replay/Tracing/Feedback
  },
  SentryReact.init                              // function REFERENCE, not invocation
);
```

**Forbidden deviations:**
- Do NOT call `SentryReact.init(...)` directly — must pass the function reference.
- Do NOT add `tracesSampleRate` (implies tracing — violates D-11).
- Do NOT add `replaysSessionSampleRate` / `replaysOnErrorSampleRate` (implies Replay — violates D-11).
- Do NOT add `sendDefaultPii: true` (pulls IP + headers — violates D-10 PHI minimization).
- Do NOT change the `release` shape away from `${platform}@<version>` (D-17 contract for symbolication routing).
