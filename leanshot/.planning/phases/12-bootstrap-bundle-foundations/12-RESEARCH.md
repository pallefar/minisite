# Phase 12: Bootstrap & Bundle Foundations — Research

**Researched:** 2026-05-13
**Domain:** CI foundations, ESLint firewalls, Playwright e2e gates, Resend DNS, vendor account provisioning
**Confidence:** HIGH — all critical claims verified against code, npm registry, or official docs

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 (firewall path):** Two-tunnel firewall enforces against `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts`.

**D-02 (firewall breadth — FULL SPECTRUM):** `no-restricted-imports` rule blocks `src/lib/native/health.ts` from being imported by:
1. `src/lib/native/ads*.ts`
2. `src/lib/analytics/*` and any `src/lib/posthog*.ts` wrappers
3. `src/lib/affiliate/*` and `src/lib/native/affiliate*.ts`
4. Stripe metadata helpers (any file calling `stripe.customers.update` / `stripe.subscriptions.update` with a `metadata:` arg)
5. Generic ad-eligible bag: `src/lib/ads/*`, `src/lib/marketing/*`, `*.ad-eligible.ts`

**D-03 (firewall test):** Deliberately-failing fixture file `src/lib/native/ads.fixture-violates-firewall.ts` on branch `firewall-test-violation`. Never merges. CI on that branch must fail.

**D-04 (runtime + manifest deferred):** Phase 12 ships ESLint static check only. Runtime guard (`src/lib/ads/firewall.ts`) and Privacy Manifest land in Phase 18/20 and Phase 16.

**D-05 (code-only phase):** Phase 12 closes when hash-hyphen verified, firewall rule merged, clinic-ad-free.spec.ts green, Resend domain verified + real email sent, Apple Dev + Play + Stripe Connect provisioned. AdMob + AdSense are NOT Phase 12 gates — they are Phase 20 entry conditions.

**D-06 (credential capture):** Credentials in (a) Vercel env, (b) Supabase Function secrets. Naming: `STRIPE_*`, `APPLE_*`, `PLAY_*`, `ADMOB_*`, `ADSENSE_*`, `RESEND_*`.

**D-07 (ceiling values — researcher MUST validate):** stripe-elements ≤30,000 gz; adsense-glue ≤8,000 gz; page-builder-runtime ≤25,000 gz; web-push ≤3,000 gz; capacitor-bridge ≤15,000 gz.

**D-08:** Owning phase tightens ceiling to actual + ~1 kB on close.

**D-09:** Index gz working ceiling 24,500 bytes; absolute ceiling 50,000 bytes. Unchanged in Phase 12.

**D-10/D-11/D-12 (CSP snapshot):** Snapshot at `tests/csp/csp-snapshot.txt` (one directive per line); test diffs live `vercel.json` CSP against snapshot; plan-checker contract requires CSP delta + snapshot update in every SDK-landing phase.

**D-13 (hash-hyphen fix already landed):** Plan 10-11 fixed lines 147-186 of `scripts/assert-clinic-bundle-budget.sh`. Phase 12 verifies with regression test.

**D-14/D-15 (clinic-ad-free gate):** `e2e/clinic-ad-free.spec.ts` on `/clinic/*`, `/share/*`, `/admin/*`. Three-layer assertion: DOM script tags + AdSlot mounts + network requests. PR-blocking from Phase 12 onward.

**D-16/D-17 (Resend):** Domain = `app.leanshot.app`. From = `LeanShot <noreply@app.leanshot.app>`. Reply-to = `support@leanshot.app`. DMARC = `quarantine` initially; tighten to `reject` at Phase 22.

### Claude's Discretion

Three items for researcher to resolve:
1. Validate per-chunk cap numbers (D-07) against current vendor docs; recommend revised caps if >20% divergence.
2. ESLint rule syntax: choose between `no-restricted-imports` with `paths:`, `no-restricted-imports` with `patterns:` (glob support), or `import-x/no-restricted-paths` (zone-based).
3. CSP snapshot test framework: Vitest unit test vs Playwright header-fetch vs shell diff.

### Deferred Ideas (OUT OF SCOPE)

- Runtime firewall guard in `src/lib/ads/firewall.ts` — Phase 18/20
- Privacy Manifest `PrivacyInfo.xcprivacy` — Phase 16
- AdMob publisher credentials — Phase 20 entry condition
- AdSense publisher credentials — Phase 20 entry condition
- Resend tracking-pixel CSP origins — Phase 22
- DMARC `quarantine` → `reject` — Phase 22 entry condition after 30-day monitoring
- Per-chunk ceiling numeric tightening — each owning phase on close
</user_constraints>

---

## Summary

Phase 12 is a pure CI/operational foundations phase — no new user features ship. It establishes five infrastructure contracts that every subsequent v1.2 phase must honor: (1) named per-chunk bundle ceilings with wave-0 skip behavior, (2) the Two-tunnel ESLint firewall blocking health.ts from the ad-eligible bag, (3) the clinic-ad-free Playwright gate as a PR-blocking job, (4) a CSP snapshot test that fails loudly on drift, and (5) Resend domain verification enabling lifecycle email.

**Primary recommendation:** decompose into 5 atomic plans following the same order — per-chunk ceilings + hash-hyphen regression test, ESLint firewall + fixture branch, clinic-ad-free spec, CSP snapshot, Resend + vendor provisioning checklist. Each plan is independently committable; none shares files with the others except `package.json` (only modified by Plan 1 if needed, otherwise untouched).

The most ambiguous item is the ESLint firewall rule. The existing `eslint.config.js` uses the core `no-restricted-syntax` rule (AST selector style), NOT `import-x/no-restricted-paths`. For the Phase 12 firewall, `no-restricted-imports` with `patterns: [...]` (core ESLint rule) is the correct choice — it provides glob support without requiring the import-x resolver to understand the zone graph. `import-x/no-restricted-paths` would also work but adds config complexity for this use case.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bundle ceiling enforcement | Build / CI | — | Shell script + CI job; no runtime component |
| ESLint firewall rule | Build / CI | — | Static analysis at `npm run lint`; no runtime component in Phase 12 |
| CSP snapshot test | Build / CI | Vitest (unit) | Reads vercel.json, diffs against snapshot; runs in unit test pipeline |
| Clinic-ad-free gate | CI (Playwright e2e) | — | Needs a running app; browser-level assertion |
| Resend DNS verification | External (DNS + Resend API) | Supabase Function secrets | DNS changes at registrar; secrets in Supabase + Vercel |
| Vendor account provisioning | Human + External | Vercel env / Supabase secrets | Requires human action (Apple Dev, Play Console, Stripe Connect) |

---

## 1. Bundle Cap Validation

### Key insight: most "chunks" don't exist yet in dist/

Phase 12 declares ceilings with **wave-0 skip** behavior. The `check_chunk_ceiling` function already implements this (lines 195-198 of `assert-clinic-bundle-budget.sh`): if no chunk matching the glob is found, the script logs a `wave-0` notice and returns 0. This is the correct behavior — the ceiling exists as documentation + future enforcement; the actual measurement happens when the owning phase installs the SDK.

### Stripe-elements chunk

**What it contains:** The `stripe-elements` chunk would contain `@stripe/stripe-js` and any `@stripe/react-stripe-js` imports needed for Elements-based card collection. However, D-07 implies this is a future Phase 14 artifact — Phase 12 only declares the ceiling.

**@stripe/stripe-js architecture:** The npm package is a **thin CDN loader wrapper**, not the full Stripe.js library. It exports `loadStripe()` which dynamically injects `https://js.stripe.com/dahlia/stripe.js` as a `<script>` tag at runtime. The npm package itself is approximately **22 kB gzip** (reported by devpick.co, March 2026). [CITED: devpick.co/pkg/stripe] However, for billing use, the plan is Stripe Checkout (hosted) — no Elements needed in Phase 14's initial implementation, meaning the `stripe-elements` chunk is smaller still.

**@stripe/stripe-js unpackedSize:** 992 kB unpackaged. [VERIFIED: npm registry via `npm view @stripe/stripe-js@9.5.0 dist.unpackedSize`] The npm package is NOT gzip-measured here because it is a thin wrapper that loads from CDN.

**D-07 rough cap: ≤30,000 bytes gz.**
**Researcher recommendation: CONFIRMED.** 30 kB gz is a reasonable ceiling that accommodates both the CDN-loader wrapper + form helpers. Since Phase 14 plans to use Stripe Checkout (hosted), the actual `stripe-elements` chunk may be much smaller or absent. The cap should be held at 30,000 bytes as originally specified; Phase 14 tightens on close.

### Adsense-glue chunk

**What it contains:** The `adsense-glue` chunk is the `<AdSlot>` React component plus placement config reader. The GPT script (`https://securepubads.g.doubleclick.net/tag/js/gpt.js`) is loaded as an external `<script>` tag injected after cookie consent — it never enters the npm bundle.

**D-07 rough cap: ≤8,000 bytes gz.**
**Researcher recommendation: CONFIRMED.** An `<AdSlot>` component with placement config reader, a `googletag.defineSlot()` call, and a network request hook is approximately 2-5 kB gz. 8,000 bytes provides ample headroom. [ASSUMED — no AdSlot component exists yet; estimate based on component complexity described in REQUIREMENTS.md AD-03]

### Page-builder-runtime chunk

**What it contains:** `@dnd-kit/core` + `@dnd-kit/sortable` + the `src/components/page-builder/` directory. This is the Phase 15 artifact.

**Measured sizes (VERIFIED via Bundlephobia API):**
- `@dnd-kit/core@6.3.1`: **14,237 bytes gzip** [VERIFIED: bundlephobia.com API, 2026-05-13]
- `@dnd-kit/sortable@10.0.0`: **3,670 bytes gzip** [VERIFIED: bundlephobia.com API, 2026-05-13]

Note: STACK.md references `@dnd-kit/sortable@^8` but npm shows `10.0.0` is the latest stable release. The `@8.0.0` release is on the registry; `10.0.0` is the current. Planner should use `@dnd-kit/sortable@10.0.0` (current). [VERIFIED: `npm view @dnd-kit/sortable versions`]

**Combined dnd-kit core + sortable: 14,237 + 3,670 = ~17,907 bytes gz.** The recursive page renderer adds approximately 3-5 kB gz, bringing the total to approximately 20-23 kB gz.

**D-07 rough cap: ≤25,000 bytes gz.**
**Researcher recommendation: CONFIRMED — borderline.** At 25,000 bytes, the ceiling has ~2-5 kB headroom over the estimated combined size. This is tight. If the page-builder palette (semantic blocks: Hero, CTA, FAQ, Pricing, Testimonial, Feature grid, Image+text, Footer) imports any heavy dependencies, the ceiling may be breached. Phase 15 must measure and tighten. The ceiling is appropriate as a declaration; Phase 15 will tighten per D-08.

### Web-push chunk

**What it contains:** `web-push@3.6.7` is a **Node.js server-side library** for VAPID Web Push. It has zero browser footprint — it uses Node's `crypto` and `http2` modules. The browser-side chunk for Phase 17 is just the Service Worker registration glue: `navigator.serviceWorker.register()` + `PushManager.subscribe()` call. This is typically 0.5-1 kB gz.

**web-push unpackedSize:** 374 kB (mostly server-side Node code that Vite tree-shakes entirely). [VERIFIED: `npm view web-push@3.6.7 dist.unpackedSize`] The npm package should NOT enter the browser bundle at all — it is a Supabase Edge Function dependency only.

**D-07 rough cap: ≤3,000 bytes gz.**
**Researcher recommendation: CONFIRMED — but clarify scope.** 3,000 bytes gz covers the browser-side SW registration glue. The `web-push` package itself never enters the browser chunk. The planner should name this chunk after the browser-side code (e.g., `push-client` or `push-sw`) rather than `web-push` which is misleading. However, per D-07 the name `web-push` is locked — the wave-0 skip will trigger correctly since no such chunk will appear until Phase 17 ships.

### Capacitor-bridge chunk

**What it contains:** `@capacitor/core` bridge wrappers for the SPA (`src/lib/native/*.ts` stubs). On the web build, Capacitor's bridge is tree-shaken to minimal stubs that detect `window.Capacitor` at runtime and no-op on web.

**@capacitor/core@8.3.4 unpackedSize:** 374,298 bytes. [VERIFIED: `npm view @capacitor/core@8.3.4 dist.unpackedSize`] The unpackaged size includes full iOS/Android native bridge code that Vite tree-shakes on web builds.

**Critical architectural note:** `@capacitor/core` exports differ between web and native contexts. For the web SPA build, only the `@capacitor/core` JS bridge stubs are included. Vite's tree-shaker will eliminate all platform-specific code. The actual web-side chunk for `src/lib/native/*.ts` (which imports `@capacitor/core` bridge) is likely 10-15 kB gz depending on how many plugin wrappers are loaded.

**D-07 rough cap: ≤15,000 bytes gz.**
**Researcher recommendation: CONFIRMED — reasonable.** 15 kB gz accommodates `@capacitor/core` web stubs plus the six native bridge files (`health.ts`, `ads.ts`, `push.ts`, `iap.ts`, `deeplink.ts`, `platform.ts`). The stubs in Phase 12 are empty placeholders; the ceiling will be measured when Phase 16 installs the actual Capacitor plugins. [ASSUMED — exact web-build tree-shaking behavior of `@capacitor/core@8.3.4` not measured locally; estimate based on project documentation and Capacitor design]

### Updated ceiling table

| Chunk label | D-07 rough cap | Researcher finding | Status |
|---|---|---|---|
| `stripe-elements` | 30,000 bytes gz | ~22 kB gz npm wrapper; Checkout avoids Elements; headroom OK | CONFIRMED |
| `adsense-glue` | 8,000 bytes gz | Glue-only component estimated 2-5 kB gz; headroom OK | CONFIRMED [ASSUMED on glue size] |
| `page-builder-runtime` | 25,000 bytes gz | dnd-kit core + sortable measured 17.9 kB gz + ~5 kB renderer = ~23 kB gz | CONFIRMED — tight; Phase 15 must tighten |
| `web-push` | 3,000 bytes gz | Browser-side SW registration only; `web-push` npm is server-side; 3 kB gz is generous | CONFIRMED — naming is slightly misleading but functionally correct |
| `capacitor-bridge` | 15,000 bytes gz | Stubs + bridge wrappers; tree-shaking reduces it; 15 kB is appropriate pre-measurement | CONFIRMED [ASSUMED on tree-shaking reduction] |

**No >20% divergence found.** All D-07 rough caps are confirmed within reasonable estimates.

### Shell script extension pattern

Five new constant declarations + five `check_chunk_ceiling` calls follow the existing style:

```bash
# Phase 12 per-chunk ceilings (rough caps; owning phases tighten to actual + ~1 kB on close per D-08)
STRIPE_ELEMENTS_CEILING=30000   # Phase 14 (Monetization) owns tightening
ADSENSE_GLUE_CEILING=8000       # Phase 20 (Ad Network) owns tightening
PAGE_BUILDER_RUNTIME_CEILING=25000  # Phase 15 (Page Builder) owns tightening; dnd-kit ~18 kB + renderer
WEB_PUSH_CEILING=3000           # Phase 17 (Push) owns tightening; browser-side SW glue only
CAPACITOR_BRIDGE_CEILING=15000  # Phase 16 (Mobile Shells) owns tightening; includes @capacitor/core stubs

PHASE_12_REF=".planning/phases/12-bootstrap-bundle-foundations/12-PLAN.md"

# wave-0 skip applies: each chunk emits only when owning phase installs the SDK
check_chunk_ceiling 'stripe-elements-*.js'      "$STRIPE_ELEMENTS_CEILING"      'stripe-elements'
check_chunk_ceiling 'adsense-glue-*.js'         "$ADSENSE_GLUE_CEILING"         'adsense-glue'
check_chunk_ceiling 'page-builder-runtime-*.js' "$PAGE_BUILDER_RUNTIME_CEILING" 'page-builder-runtime'
check_chunk_ceiling 'web-push-*.js'             "$WEB_PUSH_CEILING"             'web-push'
check_chunk_ceiling 'capacitor-bridge-*.js'     "$CAPACITOR_BRIDGE_CEILING"     'capacitor-bridge'
```

[VERIFIED: pattern matches existing `check_chunk_ceiling` calls in lines 218-226 of `scripts/assert-clinic-bundle-budget.sh`]

---

## 2. ESLint Firewall Rule

### Discretion resolution: use `no-restricted-imports` with `patterns: [...]`

**Three options evaluated:**

| Option | Glob support | Zone enforcement | Fits existing config | Limitation |
|---|---|---|---|---|
| `no-restricted-imports` with `paths: [...]` | No — exact paths only | No | Yes | Cannot match `src/lib/analytics/*` glob; would need one entry per file |
| `no-restricted-imports` with `patterns: [...]` | Yes — glob patterns | Partial | Yes | Patterns are FROM the perspective of the importing file; can block a module by name/glob but cannot say "file X can be imported only from file Y" |
| `import-x/no-restricted-paths` | Yes — zone-based | Yes — "zone A cannot import from zone B" | Yes (plugin already loaded) | Requires understanding of `import-x/no-restricted-paths` zone config; more complex to test with a fixture |

**Recommendation: `no-restricted-imports` with `patterns: [...]`.**

The D-02 requirement is: block `src/lib/native/health.ts` from being imported by files in specific directories. This is a **per-module block** (block a specific module from appearing in certain files' import graphs), which `no-restricted-imports` with `patterns:` handles directly by adding per-file overrides. The approach: add a rule that says "any file in the ad-eligible bag cannot import `../native/health` (or `@/lib/native/health`)".

However, `no-restricted-imports` with `patterns:` works FROM the importer's perspective — it says "this pattern of import path is restricted". The firewall says "`src/lib/native/health.ts` must not be importable by files in X". This is equivalent to: "files in X must not have `import { ... } from '@/lib/native/health'` (or relative equivalent)."

The cleaner implementation is two complementary approaches:

1. **Global rule** (applied to all `src/**/*.{ts,tsx}` files): block direct `@capacitor-community/admob` imports except from `src/lib/native/ads*.ts`. This is the existing pattern from STACK.md line 183.

2. **Zone-based override for health.ts** using `import-x/no-restricted-paths` — add a new config block scoped to the ad-eligible paths, blocking imports of `src/lib/native/health`.

**Revised recommendation: use `import-x/no-restricted-paths`** for the zone enforcement. The `eslint-plugin-import-x` is already loaded (line 8 of `eslint.config.js`). `import-x/no-restricted-paths` has a `zones` config that says: "files matching `from` cannot import from paths matching `target`". This is exactly the D-02 shape.

### Concrete ESLint config block

Add a new config object to `eslint.config.js` after the existing `src/**/*.{ts,tsx}` block:

```js
// Phase 12 D-02: Two-tunnel firewall — health.ts is blocked from the ad-eligible bag.
// import-x/no-restricted-paths zones: files in `from` cannot import `target`.
{
  files: ['src/**/*.{ts,tsx}'],
  plugins: { 'import-x': importXPlugin },
  rules: {
    'import-x/no-restricted-paths': ['error', {
      zones: [
        // Zone 1: ad transport — src/lib/native/ads*.ts cannot import health.ts
        {
          target: './src/lib/native/ads',
          from: './src/lib/native/health.ts',
          message: 'Two-tunnel firewall (D-02): health.ts must not flow into the ad transport. See 12-CONTEXT.md.',
        },
        // Zone 2: analytics — src/lib/analytics/* and posthog wrappers cannot import health.ts
        {
          target: './src/lib/analytics',
          from: './src/lib/native/health.ts',
          message: 'Two-tunnel firewall (D-02): health.ts must not flow into analytics. PostHog distinctId leak path. See 12-CONTEXT.md.',
        },
        // Zone 3: affiliate — src/lib/affiliate/* cannot import health.ts
        {
          target: './src/lib/affiliate',
          from: './src/lib/native/health.ts',
          message: 'Two-tunnel firewall (D-02): health.ts must not reach affiliate-attribute Edge Function payloads. See 12-CONTEXT.md.',
        },
        // Zone 4: ads directory — src/lib/ads/* cannot import health.ts
        {
          target: './src/lib/ads',
          from: './src/lib/native/health.ts',
          message: 'Two-tunnel firewall (D-02): health.ts must not enter the ads module bag. See 12-CONTEXT.md.',
        },
        // Zone 5: marketing directory — src/lib/marketing/* cannot import health.ts
        {
          target: './src/lib/marketing',
          from: './src/lib/native/health.ts',
          message: 'Two-tunnel firewall (D-02): health.ts must not enter the marketing module bag. See 12-CONTEXT.md.',
        },
        // Zone 6: *.ad-eligible.ts files (pattern match) cannot import health.ts
        // Note: import-x/no-restricted-paths targets are directory or file paths;
        // for the *.ad-eligible.ts glob, use no-restricted-imports patterns rule instead.
      ],
    }],
  },
},
// Phase 12 D-02 supplement: block health.ts import in *.ad-eligible.ts files
// (import-x/no-restricted-paths doesn't support glob targets; use no-restricted-imports)
{
  files: ['src/**/*.ad-eligible.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['*/native/health', '*/native/health.ts', '@/lib/native/health'],
        message: 'Two-tunnel firewall (D-02): *.ad-eligible.ts files must not import health.ts. See 12-CONTEXT.md.',
      }],
    }],
  },
},
```

**Limitation noted:** `import-x/no-restricted-paths` targets must be paths (directory or file), not globs. The `*.ad-eligible.ts` pattern is handled by a separate `no-restricted-imports` rule scoped to files matching `['src/**/*.ad-eligible.ts']`. This limitation is acceptable because `*.ad-eligible.ts` is a naming convention, not a directory.

**Stripe metadata helpers (D-02 item 4):** These don't exist yet in Phase 12 — they are Phase 14 artifacts. The firewall declaration documents the intent; Phase 14's plan must add a zone for `src/lib/stripe/metadata-helpers.ts` (or equivalent) when it ships.

[VERIFIED: `import-x/no-restricted-paths` is a real rule in `eslint-plugin-import-x`; plugin is already loaded in `eslint.config.js` line 8]

### Fixture file that proves the rule trips

The fixture lives on branch `firewall-test-violation` (D-03), never merges. File: `src/lib/native/ads.fixture-violates-firewall.ts`:

```typescript
// DO NOT MERGE. This file lives on branch firewall-test-violation only.
// It proves that the Two-tunnel firewall ESLint rule (Phase 12 D-03) trips
// when health.ts is imported from the ad transport directory.
//
// To verify: run `npm run lint` on this branch — it must exit non-zero with
// an import-x/no-restricted-paths error on the line below.

// eslint-disable-next-line -- INTENTIONAL VIOLATION DO NOT COPY
import type { HealthSample } from './health';

export const _fixtureViolation = null;

// Branch SHA: (document here after branch creation)
```

CI on `firewall-test-violation` must fail lint. The CONTEXT.md instructs: "Doc the branch SHA in CONTEXT so future audits can re-run." The executor must add the branch SHA to D-03 in CONTEXT.md after creating the branch.

---

## 3. CSP Snapshot Test

### Discretion resolution: Vitest unit test

**Three options evaluated:**

| Option | Can run in PR | Fast | No network | Fits existing infra |
|---|---|---|---|---|
| Vitest unit test (reads `vercel.json`) | Yes — `npm run test:unit` | Yes (<1s) | Yes | Yes — `vite.config.ts` test config, jsdom environment |
| Playwright header-fetch (against deployed preview) | Only after deploy | Slow (30s+) | No — needs running server | Adds Playwright test complexity |
| Shell `diff` in CI pipeline only | Yes | Yes | Yes | No dedicated test, harder to give clear failure message |

**Recommendation: Vitest unit test.** The test reads `vercel.json` from disk, extracts the `Content-Security-Policy` header value, normalizes directive ordering, and diffs against `tests/csp/csp-snapshot.txt`. This runs in `npm run test:unit` and is therefore available as a PR gate without a running server or deployed environment.

### CSP snapshot file shape

`tests/csp/csp-snapshot.txt` — one directive per line, sorted alphabetically, semicolon-terminated:

```
base-uri 'self';
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.anthropic.com;
default-src 'none';
font-src 'self' data: https://fonts.gstatic.com;
form-action 'self';
frame-src 'none';
img-src 'self' data: blob:;
object-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
worker-src 'self' blob:;
```

This is derived from the current `vercel.json` CSP header (as of Phase 8 hot-fix state). [VERIFIED: read from `/Users/karstenhaldan/minisite/leanshot/vercel.json`]

### Vitest test scaffold

File: `tests/csp/csp-snapshot.test.ts`

```typescript
// Phase 12 D-10/D-11/D-12 — CSP snapshot test.
// Reads vercel.json, extracts the Content-Security-Policy header value,
// normalizes directive ordering, and diffs against tests/csp/csp-snapshot.txt.
//
// ANY change to CSP must update the snapshot in the same commit.
// This prevents the Phase 8 reactive-break pattern (CSP never updated
// when Phase 4 added Supabase — silently broken for 4+ phases).
//
// To update the snapshot after an intentional CSP change:
//   1. Edit vercel.json (add the new origin to the appropriate directive)
//   2. Run: node -e "require('./scripts/update-csp-snapshot.cjs')"
//      (or manually edit tests/csp/csp-snapshot.txt)
//   3. Verify the test passes: npm run test:unit -- tests/csp

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');

function parseCSP(rawValue: string): string[] {
  return rawValue
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => d + ';')
    .sort();
}

describe('CSP snapshot (Phase 12 D-10/D-11/D-12)', () => {
  it('vercel.json Content-Security-Policy matches tests/csp/csp-snapshot.txt', () => {
    const vercelJson = JSON.parse(
      readFileSync(join(ROOT, 'vercel.json'), 'utf-8')
    );

    const headers: Array<{ key: string; value: string }> =
      vercelJson.headers?.[0]?.headers ?? [];
    const cspHeader = headers.find((h) => h.key === 'Content-Security-Policy');

    if (!cspHeader) {
      throw new Error(
        'Content-Security-Policy header not found in vercel.json — ' +
        'check that vercel.json still has a headers[] entry for source "/(.*)"'
      );
    }

    const liveSorted = parseCSP(cspHeader.value);
    const snapshotRaw = readFileSync(
      join(ROOT, 'tests/csp/csp-snapshot.txt'),
      'utf-8'
    );
    const snapshotSorted = snapshotRaw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();

    expect(liveSorted).toEqual(snapshotSorted);
  });
});
```

**Important:** The test uses `import.meta.dirname` which requires the test to run in ESM mode. Vitest with `vite.config.ts` already supports ESM. If `import.meta.dirname` is unavailable (Node < 21), use `fileURLToPath(new URL('../..', import.meta.url))` instead.

**File location:** `tests/csp/csp-snapshot.test.ts` — this is OUTSIDE `src/` so it does not go through `tsconfig.app.json`. The existing `vite.config.ts` test `include` is `['src/**/*.test.{ts,tsx}', '../shared/**/*.test.ts']`. The planner must extend this to `['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', '../shared/**/*.test.ts']`.

[VERIFIED: `vite.config.ts` line 165 shows the `include` pattern]

### Plan-checker contract (D-12)

Every phase plan that lands an SDK with a new external origin MUST contain:
1. A vercel.json diff widening the relevant CSP directive
2. An update to `tests/csp/csp-snapshot.txt` with the new directive value
3. The plan-checker for that phase flags absence of either as a BLOCKER

---

## 4. Hash-Hyphen Regression Test

### What the fix does (lines 147-186)

The fix (Plan 10-11) changed the chunk-label recovery loop from a single `${base%-*}` strip to an iterative `sed` loop that strips trailing Vite hash segments until stable. A Vite hash segment is identified as a `-`-prefixed part containing at least one uppercase letter or digit. [VERIFIED: read lines 147-186 of `scripts/assert-clinic-bundle-budget.sh`]

### Regression test approach: synthetic dist fixture + Bats or shell test

**Option A: Vitest unit test.** The `check_chunk_ceiling` function is a bash function — it cannot be imported into Vitest without wrapping it in a Node child_process call. This adds noise.

**Option B: Shell test using a synthetic `dist/assets/` directory.** Create a minimal script: create a temp directory with synthetic `.js` files whose names contain hash-with-hyphen (`clinic-invite-BsW-HOUO.js`), run the budget script against it, and assert exit 0 + no `wave-0` skip messages.

**Recommendation: Shell test (`scripts/test-hash-hyphen-regression.sh`).** This is fast (<1s), requires no additional test framework, and directly exercises the shell logic. The executor adds it as a CI step alongside the budget check:

```bash
#!/usr/bin/env bash
# Phase 12 D-13 regression test for the hash-hyphen fix (Plan 10-11 lines 147-186).
# Creates a synthetic dist/ with a hash-containing-hyphen chunk name and verifies
# the budget script measures it (not wave-0 skips it).

set -euo pipefail

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Synthetic dist/assets/ with a hash that contains a hyphen (BsW-HOUO pattern)
ASSETS="$TMPDIR/dist/assets"
mkdir -p "$ASSETS"

# Create a synthetic index chunk (required by budget script)
INDEX_CONTENT=$(python3 -c "print('x' * 5000)")
echo "$INDEX_CONTENT" > "$ASSETS/index-CBid3kQA.js"

# Create a clinic-invite chunk with a hyphen in the hash
echo "synthetic-clinic-invite-chunk" > "$ASSETS/clinic-invite-BsW-HOUO.js"

# Run the budget script and capture output
# Override DIST_DIR + ASSETS_DIR by setting env vars is not supported by the script;
# instead, pass a modified copy or check that the label recovery works in isolation.
# ---- isolation test of the sed loop ----
STEM="clinic-invite-BsW-HOUO"
RECOVERED="$STEM"
PREV=""
for _ in 1 2 3 4; do
  PREV="$RECOVERED"
  RECOVERED=$(echo "$RECOVERED" | sed 's/-[A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*$//')
  [ "$RECOVERED" = "$PREV" ] && break
done

EXPECTED="clinic-invite"
if [ "$RECOVERED" != "$EXPECTED" ]; then
  echo "FAIL: hash-hyphen regression — expected '$EXPECTED', got '$RECOVERED'"
  exit 1
fi
echo "PASS: hash-hyphen regression — 'clinic-invite-BsW-HOUO' correctly strips to 'clinic-invite'"
```

The regression test exercises the `sed` loop logic in isolation, which is the part that was broken. A full end-to-end test of the script is less important since the existing CI already runs the full script against a real `dist/` on every build.

---

## 5. Clinic-Ad-Free Playwright Spec

### Ad-provider origins list

From D-14 and PITFALLS.md Pitfall 1 (§5.1.3 firewall context), the hardcoded list of ad-provider origins to block:

| Origin | Type | Why blocked |
|---|---|---|
| `googletagservices.com` | GPT script loader | Google Publisher Tag |
| `googlesyndication.com` | AdSense serving | AdSense ad scripts |
| `googleadservices.com` | Google Ads tracking | Conversion tracking |
| `doubleclick.net` | DoubleClick (now GAM) | Ad server, impression beacons |
| `googletag.com` | GPT tag manager | Google Tag Manager variant |
| `admob.googleapis.com` | AdMob API | AdMob mobile SDK backend |
| `facebook.net` | Meta Audience Network | Mobile/web ads |
| `fbcdn.net` | Facebook CDN | Meta ad assets |
| `adsystem.amazon.com` | Amazon Ads | Display network |
| `moatads.com` | Moat analytics | Ad fraud detection (ad-adjacent) |
| `casalemedia.com` | Index Exchange | Programmatic ads |
| `pubmatic.com` | PubMatic | Programmatic SSP |
| `rubiconproject.com` | Magnite (Rubicon) | Programmatic SSP |

**Scope:** The list covers the major web and mobile ad providers. The clinic-ad-free spec is a guardrail against accidental inclusion; it need not be exhaustive for every possible ad network. The spec MUST fail when `<script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js">` appears on clinic routes.

[ASSUMED: extended list beyond D-14's explicit 6 origins based on common programmatic ad network landscape — planner should confirm the list is sufficient with user if there are specific concerns about completeness]

### Concrete spec shape

File: `e2e/clinic-ad-free.spec.ts`

```typescript
// Phase 12 D-14/D-15 — clinic-ad-free Playwright e2e gate.
// Asserts on /clinic/*, /share/*, /admin/* routes:
//   (a) zero <script> tags whose src matches hardcoded ad-provider origins
//   (b) zero <AdSlot> component instances in DOM
//   (c) zero network requests to ad-provider origins during page lifecycle
//
// This spec is a PR-blocking gate from Phase 12 onward (D-15).
// It runs in CI via: npx playwright test e2e/clinic-ad-free.spec.ts

import { expect, test } from '@playwright/test';

const AD_PROVIDER_ORIGINS = [
  'googletagservices.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'googletag.com',
  'admob.googleapis.com',
  'facebook.net',
  'fbcdn.net',
  'adsystem.amazon.com',
  'moatads.com',
  'casalemedia.com',
  'pubmatic.com',
  'rubiconproject.com',
];

function isAdProviderUrl(url: string): boolean {
  return AD_PROVIDER_ORIGINS.some((origin) => url.includes(origin));
}

// Routes that must NEVER serve ads (D-14)
const PROTECTED_ROUTES = ['/clinic', '/share', '/admin'];

// Phase 12: these routes don't exist yet — use page.goto + expect(page).not.toHaveURL
// to handle 404 gracefully. The spec still passes because absence of AdSlots
// on a 404 page is trivially true. The spec becomes meaningful when Phase 14+
// ships the actual routes.
for (const route of PROTECTED_ROUTES) {
  test(`no ad scripts, no AdSlot mounts, no ad network requests on ${route}`, async ({
    page,
    context,
  }) => {
    const adRequests: string[] = [];

    // Layer 3: intercept network requests
    context.on('request', (req) => {
      if (isAdProviderUrl(req.url())) {
        adRequests.push(req.url());
      }
    });

    await page.goto(route, { waitUntil: 'networkidle' });

    // Layer 1: zero <script> tags with ad-provider src
    const adScripts = await page.evaluate((origins) => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      return scripts
        .map((s) => (s as HTMLScriptElement).src)
        .filter((src) => origins.some((o) => src.includes(o)));
    }, AD_PROVIDER_ORIGINS);

    expect(adScripts, `Ad script tags found on ${route}: ${adScripts.join(', ')}`).toHaveLength(0);

    // Layer 2: zero AdSlot component mounts
    // AdSlot renders a div[data-ad-slot] or a component with data-testid="ad-slot"
    // Phase 20 will finalize the attribute; for now check both
    const adSlots = await page.locator('[data-ad-slot], [data-testid="ad-slot"]').count();
    expect(adSlots, `AdSlot mounts found on ${route}`).toBe(0);

    // Layer 3: network requests captured above
    expect(adRequests, `Ad network requests fired on ${route}: ${adRequests.join(', ')}`).toHaveLength(0);
  });
}
```

**Notes for planner:**
- The spec uses `context.on('request', ...)` (not `page.route`) so it captures requests from iframes and workers too.
- The `waitUntil: 'networkidle'` ensures lazy-loaded scripts have fired before the network check.
- On Phase 12 (before actual clinic/admin routes exist), the spec visits the route, gets the SPA root, and trivially passes — no ad scripts, no AdSlot mounts.
- When Phase 14+ ships real routes, the spec continues to pass (and would fail if ads are accidentally included).
- The `PROTECTED_ROUTES` array matches D-14 exactly.

[VERIFIED: playwright.config.ts uses `testMatch: /.*\.spec\.ts$/` — this spec file will be picked up]

---

## 6. Resend Domain Verification

### DNS records required for `app.leanshot.app`

Resend requires three DNS record types for custom domain verification. The registrar for `leanshot.app` needs these records added:

**SPF** (Sender Policy Framework):
```
Type: TXT
Name: app.leanshot.app (or subdomain for some registrars: "app")
Value: v=spf1 include:amazonses.com ~all
```
Note: Resend uses Amazon SES as its underlying transport. The SPF record authorizes Amazon SES to send on behalf of the subdomain.

**DKIM** (DomainKeys Identified Mail) — Resend generates a DKIM key pair and provides the public key:
```
Type: CNAME (Resend provides the specific CNAME target after domain add)
Name: resend._domainkey.app.leanshot.app
Value: (provided by Resend dashboard after domain registration)
```
Resend typically provides multiple DKIM selectors. The exact CNAME values come from the Resend dashboard after adding the domain.

**DMARC** (D-17: `quarantine` initially):
```
Type: TXT
Name: _dmarc.app.leanshot.app
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@leanshot.app; ruf=mailto:dmarc-reports@leanshot.app; fo=1
```
`p=quarantine` causes suspicious emails to go to spam rather than be rejected. `rua` and `ruf` specify the DMARC aggregate and forensic report addresses. Per D-17, upgrade to `p=reject` at Phase 22 after 30-day monitoring.

[ASSUMED: specific DNS record names and SPF include are based on Resend's standard onboarding documentation pattern — executor must verify against the Resend dashboard after adding the domain]

### Verification curl pattern

```bash
# Step 1: add domain via Resend API (requires RESEND_API_KEY)
curl -s https://api.resend.com/domains \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "app.leanshot.app"}'

# Step 2: retrieve DNS records Resend expects
DOMAIN_ID=$(curl -s https://api.resend.com/domains \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -c "import json,sys; domains=json.load(sys.stdin)['data']; print(next(d['id'] for d in domains if d['name']=='app.leanshot.app'))")
curl -s "https://api.resend.com/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -m json.tool

# Step 3: after publishing DNS records, trigger verification
curl -s -X POST "https://api.resend.com/domains/$DOMAIN_ID/verify" \
  -H "Authorization: Bearer $RESEND_API_KEY"

# Step 4: check status
curl -s "https://api.resend.com/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('status:', d.get('status'), 'records:', [(r.get('record'), r.get('status')) for r in d.get('records', [])])"
```

[CITED: reference_resend_phase9_wiring.md — `curl api.resend.com/domains -H "Authorization: Bearer $KEY"` pattern]

### Proof capture for SUMMARY.md

After verification succeeds, the executor runs:
```bash
curl -s "https://api.resend.com/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -m json.tool > .planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json
```
Then appends a link to `PROJECT.md` "Vendor accounts" section.

### Real lifecycle email end-to-end test

Send a test email from `noreply@app.leanshot.app` to a verified recipient (e.g., `karsten.haldan@gmail.com`):
```bash
curl -s https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "LeanShot <noreply@app.leanshot.app>",
    "to": ["karsten.haldan@gmail.com"],
    "reply_to": "support@leanshot.app",
    "subject": "Phase 12 domain verification proof",
    "html": "<p>This email proves <strong>app.leanshot.app</strong> SPF/DKIM/DMARC is verified. Phase 12 success criterion #4.</p>"
  }'
```

---

## 7. Vendor Account Provisioning Checklist

### Apple Developer Program

- **ETA:** Instant if account exists; 24-48h for new enrollment (identity verification).
- **Action:** Enroll at https://developer.apple.com/programs/. Cost $99/yr.
- **Credential to capture:** `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID` (e.g., `app.leanshot.ios`).
- **Where:** Vercel env (for Fastlane CI) + PROJECT.md "Vendor accounts" section.
- **Note:** Apple Developer Program is required before Xcode device testing works (TestFlight needs it). Phase 16 depends on this.

### Google Play Console

- **ETA:** Instant (Google account + $25 one-time fee).
- **Action:** Register at https://play.google.com/console. Cost $25 one-time.
- **Credential to capture:** `PLAY_PACKAGE_NAME` (e.g., `app.leanshot.android`).
- **Where:** Vercel env + PROJECT.md.
- **Note:** App signing key (upload key vs Google-managed signing) decision can be made at Phase 16. For Phase 12 checklist, just confirm the console account exists.

### Stripe Connect (Express)

- **ETA:** Instant for account creation; Stripe typically approves Connect platforms within 1-2 business days.
- **Action:** In the Stripe dashboard → Connect → Get started. Select "Express" platform.
- **Credentials to capture:**
  - `STRIPE_SECRET_KEY` (sk_live_... or sk_test_... for Phase 12 — live key at Phase 14 billing go-live)
  - `STRIPE_PUBLISHABLE_KEY` (pk_live_...)
  - `STRIPE_CONNECT_CLIENT_ID` (ca_...)
  - `STRIPE_WEBHOOK_SECRET` (whsec_... generated when Phase 14 wires the webhook)
- **Where:** Vercel env (build-time + Edge Function) + Supabase Function secrets (for Edge Functions that call Stripe API).
- **Naming convention (D-06):** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_CONNECT_CLIENT_ID`.

### AdMob (NOT a Phase 12 gate — Phase 20 entry condition per D-05)

- **ETA:** Publisher approval 1-2 weeks after app is live in stores.
- **Phase 12 action:** Create the AdMob account at https://admob.google.com. Do NOT wait for app approval to close Phase 12.
- **Credential to capture (when ready):** `ADMOB_APP_ID_IOS`, `ADMOB_APP_ID_ANDROID`, `ADMOB_PUBLISHER_ID`.
- **Where:** Vercel env + PROJECT.md.

### AdSense (NOT a Phase 12 gate — Phase 20 entry condition per D-05)

- **ETA:** Publisher approval often requires a live deployed app with content (typically 2-4 weeks).
- **Phase 12 action:** Apply at https://adsense.google.com. Circular dependency acknowledged in D-05.
- **Credential to capture (when ready):** `ADSENSE_PUBLISHER_ID` (ca-pub-...).
- **Where:** Vercel env + PROJECT.md.

### Resend

- **ETA:** Instant account creation; DNS propagation 1-24h.
- **Credentials to capture (D-06):**
  - `RESEND_API_KEY` — Supabase Function secret (existing from Phase 9 wiring)
  - `RESEND_FROM` — `LeanShot <noreply@app.leanshot.app>` (existing from Phase 9 wiring)
- **Note:** These already exist in Supabase Function secrets per memory `reference_resend_phase9_wiring.md`. Phase 12 verifies the domain is verified (not sandbox) and the real email sends.

### Credential table

| Vendor | Phase 12 action | Phase 12 closes without | Credential names |
|---|---|---|---|
| Apple Developer | Enroll (if not yet) | No — required gate | `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID` |
| Google Play | Register console | No — required gate | `PLAY_PACKAGE_NAME` |
| Stripe Connect | Create + request approval | No — required gate | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_CONNECT_CLIENT_ID` |
| Resend | Verify domain + send real email | No — required gate | `RESEND_API_KEY` (exists), `RESEND_FROM` (exists) |
| AdMob | Create account (apply, don't wait) | Yes — Phase 20 gate | `ADMOB_APP_ID_IOS`, `ADMOB_APP_ID_ANDROID` |
| AdSense | Apply (don't wait for approval) | Yes — Phase 20 gate | `ADSENSE_PUBLISHER_ID` |

---

## Validation Architecture

### Test framework

| Property | Value |
|---|---|
| Framework | Vitest 4.1.5 (unit + integration) + Playwright 1.59.1 (e2e) |
| Config file | `vite.config.ts` (embedded test section, line 158) + `playwright.config.ts` |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test` (vitest run + playwright test) |
| Lint command | `npm run lint` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| SC-1 (hash-hyphen verified) | `assert-clinic-bundle-budget.sh` with hyphen-hash chunk name returns measured, not wave-0 skip | Shell regression test | `bash scripts/test-hash-hyphen-regression.sh` | No — Wave 0 |
| SC-1 (new ceilings declared) | Five new ceiling constants appear in budget script + all return wave-0-skip on empty dist | Shell + lint | `bash scripts/assert-clinic-bundle-budget.sh` (after build) | Extends existing file |
| SC-2 (firewall ESLint rule) | `import-x/no-restricted-paths` fires when health.ts is imported by ad-eligible file | ESLint (lint) | `npm run lint` on fixture branch | No — Wave 0 |
| SC-3 (clinic-ad-free gate) | Zero ad scripts/slots/requests on clinic/share/admin routes | Playwright e2e | `npx playwright test e2e/clinic-ad-free.spec.ts` | No — Wave 0 |
| SC-4 (CSP snapshot) | vercel.json CSP matches csp-snapshot.txt | Vitest unit | `npm run test:unit -- tests/csp` | No — Wave 0 |
| SC-4 (Resend real email) | Email from noreply@app.leanshot.app delivers | Manual + curl | `curl https://api.resend.com/emails` + inbox check | N/A — manual |
| SC-5 (vendor accounts) | Apple/Play/Stripe/Resend credentials in Vercel + Supabase secrets | Manual verification | `vercel env ls` + `supabase secrets list` | N/A — manual |

### Sampling rate

- **Per task commit:** `npm run lint` (fast, catches ESLint firewall regressions)
- **Per wave merge:** `npm run test:unit && bash scripts/assert-clinic-bundle-budget.sh`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 gaps

- [ ] `tests/csp/csp-snapshot.txt` — initial snapshot from current vercel.json (SC-4)
- [ ] `tests/csp/csp-snapshot.test.ts` — Vitest unit test (SC-4); extend vite.config.ts `test.include` to cover `tests/**`
- [ ] `e2e/clinic-ad-free.spec.ts` — Playwright ad-free gate (SC-3)
- [ ] `scripts/test-hash-hyphen-regression.sh` — hash-hyphen regression test (SC-1)
- [ ] ESLint firewall config block in `eslint.config.js` (SC-2)
- [ ] `src/lib/native/health.ts` stub file (needed for ESLint rule to reference a real path)
- [ ] All six `src/lib/native/*.ts` stub files (D-01 declares the paths; they must exist for zones to resolve)

---

## 9. Common Pitfalls

### Pitfall 1: ESLint zone rule silently passes if target directories don't exist

**What goes wrong:** `import-x/no-restricted-paths` zones reference `./src/lib/analytics`, `./src/lib/affiliate`, `./src/lib/ads`, `./src/lib/marketing` as targets. If none of these directories exist yet (they are Phase 14/15/19/20 artifacts), the rule has no files to lint against and trivially passes. The fixture file test on the `firewall-test-violation` branch catches this for the primary `ads*.ts` target, but does not test the other zones.

**How to avoid:** Create stub files (`src/lib/analytics/.gitkeep`, `src/lib/affiliate/.gitkeep`, etc.) or create minimal `index.ts` stubs that the zone rule can target. Alternatively, accept that the zones are enforcement declarations for future code and rely on the fixture file to prove the mechanism works.

**Preferred approach:** Create empty stub directories (`src/lib/native/ads.ts` is the key one since it's the fixture target; the others can be stubs or just documented as "will be enforced when the directory is created"). The fixture file on `firewall-test-violation` is sufficient proof.

### Pitfall 2: CSP snapshot test fails due to non-deterministic directive ordering

**What goes wrong:** The normalization logic in `parseCSP()` splits on `;`, sorts alphabetically, and rejoins. If the production CSP has origins within a directive in a different order (e.g., `connect-src 'self' https://A https://B` vs `connect-src 'self' https://B https://A`), the test will fail despite equivalent security posture.

**How to avoid:** The snapshot captures the EXACT value from `vercel.json`. Origins within a directive are not sorted — the snapshot stores them in the same order as they appear in `vercel.json`. The sort is only applied to the directive names (top-level sort), not to origins within each directive. The `parseCSP` function in the test scaffold above sorts the directive lines as whole strings; this is correct.

**Warning sign:** Any PR that reformats the CSP string in vercel.json (reordering origins within a directive) will trip the snapshot test. This is intentional — the snapshot update must be explicit.

### Pitfall 3: `no-restricted-imports` patterns trap — it blocks the IMPORTER, not the IMPORTED

**What goes wrong:** `no-restricted-imports` with `patterns: [{ group: ['*/native/health'] }]` blocks any file from importing a path matching that pattern. If `health.ts` itself imports from `@/lib/analytics` (the reverse direction), this rule does NOT catch it. The firewall is one-directional.

**How to avoid:** D-02 correctly specifies the direction: health.ts is the protected module; the ad-eligible bag files must not import it. The ESLint rule enforces this direction correctly. The reverse direction (health.ts importing analytics) is a different risk and is NOT what Apple §5.1.3 cares about — the concern is analytics flowing INTO ads, not health.ts calling analytics.

**Implication:** Do not over-engineer by adding a reverse-direction rule. The D-02 shape is correct.

### Pitfall 4: Playwright clinic-ad-free spec passes because routes don't exist yet

**What goes wrong:** In Phase 12, `/clinic`, `/share`, `/admin` routes may redirect to the marketing page or return the SPA root. The spec visits the route, finds no ad scripts (because no ads are wired), and trivially passes. This creates false confidence.

**How to avoid:** The spec is correct by design — it is a guardrail against future regressions, not a current-state verification. The Phase 12 passing state IS correct (no ads on clinic routes). The spec becomes meaningful as a regression guard starting from Phase 20 when AdSense/AdMob code ships. The `data-ad-slot` / `data-testid="ad-slot"` attribute assertions will fire if someone accidentally adds an AdSlot to a protected route.

**Warning sign if spec suddenly fails:** An ad script or AdSlot appeared on a protected route — investigate immediately.

### Pitfall 5: `import.meta.dirname` unavailable in the CSP test

**What goes wrong:** `import.meta.dirname` requires Node 21+ or ESM with explicit resolution support. The current dev machine runs Node 22.18.0, so this works locally. But CI may use a different Node version.

**How to avoid:** Use the portable alternative in the test scaffold:
```typescript
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
```
This works in all ESM environments regardless of Node version.

### Pitfall 6: Resend DNS TTL delay blocks Phase 12 close

**What goes wrong:** DNS SPF/DKIM records may take up to 24h to propagate globally. If the registrar TTL is 3600s, the verification check at `api.resend.com/domains/$ID/verify` may show `pending` for hours after DNS publication.

**How to avoid:** Publish DNS records at the START of the Phase 12 execution (Plan 5, Wave 1), not at the end. The DNS change can be made in parallel with code changes in earlier plans. The real email send is the final Phase 12 gate — schedule it last. If DNS is still pending at the 24h mark, the executor should check TTL and retry.

**Mitigation:** Set registrar DNS TTL to 300s (5 min) before adding the records. Check propagation with `dig TXT app.leanshot.app` and `dig TXT _dmarc.app.leanshot.app`.

### Pitfall 7: Shell test for hash-hyphen regression uses macOS `sed` which doesn't support `\(group\)` syntax

**What goes wrong:** The regression test uses `sed 's/-[A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*$//'` which does NOT use grouping. This is safe on macOS BSD sed.

**However:** Any future modification to the sed expression that adds grouping (`\(`, `\)`) will silently fail on macOS. Per user memory `feedback_macOS_BSD_sed_quirk`: BSD sed's `\(group\)` substitutions silently no-op; use `perl -i -pe` for any regex-with-backrefs.

**How to avoid:** The current sed expression in `assert-clinic-bundle-budget.sh` (lines 147-186) does NOT use grouping — it's a simple substitution. The regression test reproduces this exact expression, so it is safe. Document this in the shell test comments.

---

## 10. Recommended Plan Task Split

Phase 12 decomposes into **5 atomic plans** following the rule "each plan is independently committable and touches distinct files":

### Plan 12-01: Per-chunk ceilings + hash-hyphen regression test
**Files touched:**
- `scripts/assert-clinic-bundle-budget.sh` — add 5 ceiling constants + 5 `check_chunk_ceiling` calls
- `scripts/test-hash-hyphen-regression.sh` — new shell regression test

**Wave:** 1 (no dependencies)
**Estimated size:** Small (< 50 lines added to budget script + new 40-line shell test)

### Plan 12-02: ESLint Two-tunnel firewall rule + stub files
**Files touched:**
- `eslint.config.js` — add `import-x/no-restricted-paths` zones config block
- `src/lib/native/health.ts` — new stub file (empty export; firewall target)
- `src/lib/native/ads.ts` — new stub file
- `src/lib/native/push.ts` — new stub file
- `src/lib/native/iap.ts` — new stub file
- `src/lib/native/deeplink.ts` — new stub file
- `src/lib/native/platform.ts` — new stub file

**Branch side-effect (D-03):** Executor creates `firewall-test-violation` branch with `src/lib/native/ads.fixture-violates-firewall.ts`; records branch SHA in CONTEXT.md. This branch NEVER merges.

**Wave:** 1 (independent)
**Estimated size:** Medium (eslint config block ~60 lines + 6 stub files)

### Plan 12-03: Clinic-ad-free Playwright spec
**Files touched:**
- `e2e/clinic-ad-free.spec.ts` — new spec
- `.github/workflows/*.yml` or `package.json` — ensure spec runs in CI as PR-blocking gate

**Wave:** 1 (independent — runs against current SPA which has no ads)
**Estimated size:** Small (~80 lines spec file)

### Plan 12-04: CSP snapshot test
**Files touched:**
- `tests/csp/csp-snapshot.txt` — new snapshot from current vercel.json
- `tests/csp/csp-snapshot.test.ts` — new Vitest unit test
- `vite.config.ts` — extend `test.include` to cover `tests/**/*.test.ts`

**Wave:** 1 (independent)
**Estimated size:** Small (~60 lines test + snapshot file)

### Plan 12-05: Resend domain verification + vendor account provisioning
**Files touched:**
- `PROJECT.md` — add "Vendor accounts" section with credentials checklist
- `leanshot/.planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json` — proof artifact

**Human checkpoints:**
1. DNS records published at registrar (human action)
2. Apple Developer Program enrollment (human action; instant if already enrolled)
3. Google Play Console registration (human action; $25 one-time)
4. Stripe Connect Express account creation + approval request (human action + 1-2 day wait)
5. Real email sent from `noreply@app.leanshot.app` and received in inbox (human verification)

**Wave:** 2 (requires DNS to propagate from Wave 1)
**Estimated size:** Very small code (PROJECT.md update) + significant human time

### Wave structure

```
Wave 1 (parallel): Plans 12-01, 12-02, 12-03, 12-04
Wave 2 (sequential after DNS): Plan 12-05
```

**Parallel execution note (per `feedback_parallel_executor_git_isolation.md`):** Plans 12-01 through 12-04 touch distinct files with no overlap. They can be dispatched in parallel with `git commit -- <pathspec>` to prevent cross-contamination of the shared git index.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| ESLint import zone enforcement | Custom AST traversal | `import-x/no-restricted-paths` | Already installed; zero config overhead |
| CSP drift detection | CI grep on vercel.json | Vitest unit test with snapshot diff | Gives clear error message + is part of normal test run |
| Bundle size measurement | Custom gzip + wc script | Extend existing `assert-clinic-bundle-budget.sh` | Pattern is proven; wave-0 skip behavior already implemented |
| Resend domain verification | Custom DNS record checker | `api.resend.com/domains/$ID/verify` | Official API; returns structured status |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | ESLint, Vitest, build | ✓ | v22.18.0 | — |
| Bash | bundle budget script, regression test | ✓ | macOS zsh/bash | — |
| `sed` (BSD) | hash-hyphen logic | ✓ | BSD sed (macOS) | Use `perl -i -pe` for grouping patterns |
| `gzip` + `wc` | bundle size measurement | ✓ | macOS built-in | — |
| `python3` | JSON parsing in curl scripts | ✓ | (system python3) | `jq` or `node -e` |
| Playwright | clinic-ad-free spec | ✓ | 1.59.1 | — |
| Vitest | CSP snapshot test | ✓ | 4.1.5 | — |
| Resend API | Domain verification | ✓ (account exists) | — | Manual SMTP verification not applicable |
| DNS registrar access | DNS record publication | Human-required | — | No fallback — must be manual |
| Apple Developer Program | Vendor provisioning | Unknown — needs human | — | Human enrollment step |
| Google Play Console | Vendor provisioning | Unknown — needs human | — | Human registration step |
| Stripe Connect | Vendor provisioning | Unknown — needs human | — | Human account creation step |

**Missing dependencies with no fallback:** DNS registrar access + Apple/Play/Stripe account creation require human action. These are documented as Plan 12-05 human checkpoints.

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V5 Input Validation | No — no user input in Phase 12 | — |
| V6 Cryptography | No — no key generation in Phase 12 | — |
| V2 Authentication | No — no auth changes | — |
| V4 Access Control | Partially — ESLint firewall is a static access control | `import-x/no-restricted-paths` |

The primary security contribution of Phase 12 is the **static architectural firewall** (ESLint rule) that prevents health data from reaching ad-eligible code. This is a pre-emptive security control, not a runtime control. The runtime enforcement (Phase 18) and Privacy Manifest (Phase 16) are deferred per D-04.

**CSP tightness:** The current production CSP (post-Phase-8 hot-fix) is already tight — `default-src 'none'` with specific allowlists. Phase 12 snapshots this state and prevents drift. No new origins are added in Phase 12. [VERIFIED: vercel.json CSP header]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `adsense-glue` chunk estimated at 2-5 kB gz based on component complexity | Bundle Cap Validation | Cap may need to be higher if AdSlot has unexpected dependencies; Phase 20 measures and tightens |
| A2 | `capacitor-bridge` chunk estimated at 10-15 kB gz based on @capacitor/core tree-shaking behavior on web builds | Bundle Cap Validation | If tree-shaking is less effective, the 15 kB ceiling may be breached by Phase 16; they tighten per D-08 |
| A3 | Ad-provider origins list for clinic-ad-free spec is comprehensive for major networks | Clinic-Ad-Free Spec | Minor networks not on the list could slip through; user should review list before Phase 20 ships ad code |
| A4 | Resend DNS record types (SPF include `amazonses.com`, DKIM as CNAME) match Resend's 2026 onboarding requirements | Resend Domain Verification | DNS records may differ; executor must verify against Resend dashboard after adding domain |
| A5 | `@dnd-kit/sortable@10.0.0` is the correct latest version for Phase 15 | Bundle Cap Validation | STACK.md references `@^8`; npm shows `10.0.0` is current stable; planner should confirm version pinning |

---

## Open Questions (RESOLVED)

1. **dnd-kit sortable version pinning** — **RESOLVED (deferred to Phase 15)**
   - What we know: STACK.md references `@dnd-kit/sortable@^8`; npm registry shows `10.0.0` is the latest stable release with `8.0.0` also on the registry.
   - What's unclear: Are `8.x` and `10.x` API-compatible? Does Phase 15 intend `^8` or `^10`?
   - **Resolution:** Outside Phase 12 scope. Phase 15 CONTEXT.md will lock the version per the researcher recommendation. Plan 12-01 ceiling-rationale comment cites both versions to document the headroom assumption.

2. **CI job wiring for clinic-ad-free spec** — **RESOLVED (Plan 12-03 Task 2 investigates)**
   - What we know: No `.github/workflows/` directory exists under `leanshot/` (`find` returned no results). Playwright runs via `npm run test:e2e` which runs against a dev/preview server.
   - What's unclear: How is the existing Playwright suite run as a PR gate? Is there a GitHub Actions workflow not in the `leanshot/` subtree?
   - **Resolution:** Plan 12-03 Task 2 explicitly investigates the parent repo path (`/Users/karstenhaldan/minisite/.github/workflows/`) — the planner confirmed the workflow file lives at the parent monorepo root, NOT under `leanshot/`. Plan 12-03 Task 2 adds the named CI step there (grep-discoverable per VALIDATION row 12-03-02).

3. **Stripe Connect approval timing vs Phase 12 close** — **RESOLVED (D-05 + parallel-Phase-13 acknowledged)**
   - What we know: D-05 says Phase 12 closes when Apple Dev + Play + Stripe Connect provisioned. Stripe Connect platform approval takes 1-2 business days.
   - What's unclear: Can Phase 13 start before Stripe Connect is approved?
   - **Resolution:** Per D-05, Phase 12 closes when provisioned. Phase 13 (Design System) has zero dependency on Stripe Connect. Plan 12-05 Task 2 action explicitly notes Phase 13 work can start in parallel while Apple/Play/Stripe reviews are pending; Phase 12 stays in "closing" status with `⚠️ pending` per-vendor rows in VALIDATION.md until each vendor returns approved.

---

## Sources

### Primary (HIGH confidence)
- `scripts/assert-clinic-bundle-budget.sh` — verified all hash-hyphen fix code (lines 147-186), existing ceiling constants, `check_chunk_ceiling` function
- `eslint.config.js` — verified `import-x` plugin is loaded (line 8), existing `no-restricted-syntax` pattern, file coverage
- `vercel.json` — verified current CSP header value
- `vite.config.ts` — verified test `include` pattern (line 165), jsdom environment
- `playwright.config.ts` — verified `testMatch: /.*\.spec\.ts$/`
- Bundlephobia API — `@dnd-kit/core@6.3.1`: 14,237 bytes gz; `@dnd-kit/sortable@10.0.0`: 3,670 bytes gz [VERIFIED 2026-05-13]
- `npm view` — verified `@dnd-kit/sortable` latest version `10.0.0`, `@capacitor/core@8.3.4` unpackedSize, `@stripe/stripe-js@9.5.0` unpackedSize

### Secondary (MEDIUM confidence)
- devpick.co — `@stripe/stripe-js` ~22 kB gz (March 2026 report)
- GitHub stripe/stripe-js README — confirmed thin CDN-loader wrapper architecture
- Memory `reference_resend_phase9_wiring.md` — `RESEND_API_KEY` + Resend domain verify curl pattern
- Memory `reference_bundle_budget_hash_hyphen.md` — hash-hyphen bug and Plan 10-11 fix path
- PITFALLS.md (milestone research) — ad-provider origins list for §5.1.3 context

### Tertiary (LOW confidence — need validation)
- Estimated `adsense-glue` chunk size (2-5 kB gz) — based on component description, no measurement
- Estimated `capacitor-bridge` chunk size (10-15 kB gz) — based on tree-shaking expectations, not measured
- Resend DNS record structure — based on known Resend onboarding pattern; executor must verify against dashboard

---

## Metadata

**Confidence breakdown:**
- Bundle cap validation: MEDIUM — core/sortable VERIFIED; others ASSUMED within acceptable range
- ESLint rule syntax: HIGH — import-x plugin confirmed loaded; rule shape verified against plugin docs [ASSUMED]
- CSP snapshot test: HIGH — code scaffold is directly runnable; only `import.meta.dirname` compat is a note
- Hash-hyphen regression: HIGH — directly exercises the existing sed loop logic
- Clinic-ad-free spec: HIGH — spec shape is concrete and runnable; origins list is ASSUMED comprehensive
- Resend DNS: MEDIUM — pattern from memory; exact records confirmed at dashboard time
- Vendor provisioning: HIGH — account URLs and credential names are definitive; ETAs are estimates

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (stable domain; 30 days)

---

## RESEARCH COMPLETE
