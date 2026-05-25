# Phase 55: HealthKit + Two-Tunnel Firewall — Research

**Researched:** 2026-05-25
**Domain:** Capacitor HealthKit plugin, ESLint flat-config custom rules, PHI firewall architecture, iOS privacy manifest
**Confidence:** HIGH (existing codebase inventory); MEDIUM (HealthKit plugin API — verified via npm/GitHub/docs but on-device behavior deferred)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use a maintained Capacitor HealthKit plugin (research selects; fallback custom Swift bridge). Replace the `health.ts` stub with full read-only implementation.
- Read types: bodyMass, height, stepCount, sleepAnalysis, heartRate, activeEnergyBurned, dietaryProtein → map to EXISTING weight/steps/sleep tables (no new domain tables).
- 3 INDEPENDENT enforcement layers: (1) ESLint AST rule, (2) runtime guard helper, (3) CI grep gate. Each catches what the others miss.
- Blocks: any `health-*` module/Edge-Fn importing ad/marketing modules; no health signal in any ad-targeting payload.
- Carveout pattern: legitimate cross-reads extracted into sibling helpers (keep rejected-alternative names OUT of committed files — negation-grep trap per `feedback_negation_grep_defeated_by_comment_string`).
- Explicit OPT-IN consent screen (UI-SPEC approved), default OFF, full disclosure. UI-SPEC already generated and approved.
- Revoke: Settings toggle OFF blocks future syncs; historical data optionally purgeable.
- `PrivacyInfo.xcprivacy` lists every HealthKit read type.
- "Done" = 3-layer firewall + full health.ts + import-mapping (mock-tested) + consent UI + revoke/purge + privacy manifest. On-device → Phase 70.

### Claude's Discretion
- Plugin selection, exact firewall AST-rule shape, import-mapping transforms, sync interval defaults, migration shapes (opt-in flag, sync state).

### Deferred Ideas (OUT OF SCOPE)
- On-device HealthKit permission grant, real metric read, background sync on device, battery-state behavior on device → Phase 70.
- HealthKit entitlement provisioning + Apple review verification of PrivacyInfo.xcprivacy → Phase 70.
- Android Health Connect parity → out of scope (iOS-only).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HEALTH-01 | HealthKit entitlement declared in iOS app; Capacitor plugin imports HKHealthStore | Plugin: `@capgo/capacitor-health` ^8.5.2; iOS plist + entitlement config documented below |
| HEALTH-02 | OPT-IN consent screen: explicit user choice with full disclosure; no silent default-on | UI-SPEC approved; `HealthKitConsentModal` + `HealthKitSettingsSection` composition defined |
| HEALTH-03 | Read-only import: bodyMass/height/stepCount/sleepAnalysis/heartRate/activeEnergyBurned/dietaryProtein; mapped to existing tables | Import-mapping table documented; existing table schemas confirmed |
| HEALTH-04 | Two-tunnel firewall: health-import Edge Fn never touches ad-tracking; lint rule enforced | 3-layer mechanism designed; extends existing Phase 12 zones |
| HEALTH-05 | PrivacyInfo.xcprivacy lists every health read type | Existing file at `apps/ios/App/App/PrivacyInfo.xcprivacy`; `NSPrivacyCollectedDataTypeHealth` already present; read-type API-level extensions needed |
| HEALTH-06 | Background sync at admin-configurable interval; battery-aware skip | Deferred to Phase 70 (on-device); Phase 55 ships the structure + mock tests |
| HEALTH-07 | User can revoke from Settings; future syncs blocked; historical data optionally purgeable | Revoke/purge via SECDEF RPC + `healthkit_sync_state` table |
| HEALTH-08 | 3-layer enforcement: CI grep + ESLint AST + runtime assertion; each independently testable | Full mechanism specified below |
</phase_requirements>

---

## Summary

Phase 55 ships the full HealthKit read-only import pipeline for LeanShot iOS, with the centerpiece being a three-layer firewall that structurally prevents PHI from ever reaching ad-targeting surfaces. The on-device execution (actual HealthKit permission prompt, real metric reads, background sync) is deferred to Phase 70 HUMAN-UAT; Phase 55 delivers all of the code, tests, migrations, and enforcement infrastructure that can be validated without a real iOS device or approved entitlement.

**Plugin decision:** `@capgo/capacitor-health` ^8.5.2 is the correct choice. It is the only Capacitor HealthKit plugin with `@capacitor/core >= 8.0.0` peer dependency (confirmed via `npm view`), has 13,372 weekly downloads, an active public GitHub repo (`Cap-go/capacitor-health`), and was published 2026-05-24. The alternative `@perfood/capacitor-healthkit` 1.3.2 requires `@capacitor/core ^4.0.0` and is incompatible with the project's Capacitor 8. Install requires `--legacy-peer-deps` due to the `@sentry/capacitor` sibling-check issue (per `reference_sentry_capacitor_npm_install_blocker`).

**Firewall mechanism:** The Phase 12 `import-x/no-restricted-paths` firewall (Zones 1–6) is already in `eslint.config.js` and blocks `health.ts` from flowing into `ads*.ts`, `analytics/`, `affiliate/`, `ads/`, `marketing/`, `stripe/`. Phase 55 extends this with a net-new ESLint custom rule (`no-health-in-ad-context.cjs`) that mirrors the Phase 39 PHARMA-02 pattern — a dedicated `.cjs` file in `eslint-rules/`, a runtime guard helper (`assertHealthTunnel`), and a CI grep gate script (`check-no-health-in-ad-context.sh`).

**Import mapping:** HealthKit samples map to existing tables (`weights`, `sleep`, `workouts` for steps/activity, `profiles` for height) using client-direct writes through the existing Supabase RLS-gated paths. `steps` has no server-side table — it is stored as a `Record<string,number>` in Zustand and synced locally only; HealthKit step imports follow the same pattern. A new `healthkit_sync_state` table per user tracks `healthkit_enabled`, `sync_interval`, `last_synced_at`, `revoked_at`, and an `hk_source` tag on imported rows.

**Primary recommendation:** Ship `@capgo/capacitor-health` + extend existing ESLint zone rules with a named CJS custom rule + `healthkit_sync_state` migration + client-direct import mapping. No new domain tables — reuse existing schema.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HealthKit permission request | iOS Native (Capacitor plugin) | — | OS-level permission; must be native |
| HealthKit data read | iOS Native (Capacitor plugin) | — | HKHealthStore only accessible from native layer |
| Import mapping (HealthKit → DB rows) | Client (src/lib/native/health.ts) | — | Small transform; client writes to Supabase via RLS-gated REST; no Edge Fn needed for read-only simple upsert |
| PHI audit logging | Database (SECDEF RPC log_phi_access) | — | Existing infra; call at import trigger site |
| Opt-in state + revoke/purge | Database (healthkit_sync_state table + SECDEF purge RPC) | Client (Zustand mirror) | Server is source of truth; client mirrors for UI |
| Firewall enforcement — ESLint | Build-time (eslint.config.js + eslint-rules/) | — | Compile-time gate; catches import violations before runtime |
| Firewall enforcement — runtime | Client (src/lib/native/healthAssert.ts) | — | Throws in dev/test; warns in prod |
| Firewall enforcement — CI grep | CI (.github/workflows/ci.yml + scripts/) | — | Last line of defense; comment-stripped |
| Consent UI | Client (src/components/healthkit/) | — | Consumer surface; follows DS primitives per UI-SPEC |
| Privacy manifest | iOS build artifact (apps/ios/App/App/PrivacyInfo.xcprivacy) | — | Apple App Store reviewer artifact |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@capgo/capacitor-health` | ^8.5.2 | Capacitor 8 HealthKit bridge; read-only `readSamples()` for bodyMass/steps/sleep/heartRate/calories/protein/height | Only Capacitor 8-compatible HealthKit plugin; actively maintained; 13k/wk downloads; SPM native install [VERIFIED: npm registry] |

### Supporting (all already in package.json)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@capacitor/core` | ^8.3.4 | Plugin runtime | All native bridge calls |
| `eslint-plugin-import-x` | (existing) | Existing firewall zones; extend with new health-in-ad zone | Already wired in eslint.config.js |
| `vitest` | (existing) | Unit tests for firewall rule, import mapper, consent UI | All non-device tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@capgo/capacitor-health` | `@perfood/capacitor-healthkit` | perfood requires `@capacitor/core ^4.0.0` — incompatible with project's Capacitor 8; not viable |
| `@capgo/capacitor-health` | Custom Swift bridge | Avoids plugin dependency but requires Swift authoring + Xcode targets; no benefit given plugin has Cap8 support + SPM |
| Client-direct write | `health-import` Edge Fn | Edge Fn adds latency and cold-start cost for simple upsert; RLS already enforces isolation; client-direct is fine for personal-only writes |

**Installation:**
```bash
npm install @capgo/capacitor-health --legacy-peer-deps
npx cap sync
```
`--legacy-peer-deps` required due to `@sentry/capacitor` sibling-check conflict (per project memory `reference_sentry_capacitor_npm_install_blocker`).

---

## Package Legitimacy Audit

> slopcheck was not available at research time. All packages below are tagged `[ASSUMED]` from registry verification; the planner must gate the install with checkpoint:human-verify.

| Package | Registry | Age | Downloads/wk | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-------------|-----------|-------------|
| `@capgo/capacitor-health` | npm | ~8 months (first: 2025-09-24) | 13,372 | github.com/Cap-go/capacitor-health | not run | [ASSUMED] — planner must add checkpoint:human-verify before install |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none (registry check passes: 13k/wk, active repo, Capgo is a known Capacitor plugin organization, no postinstall script detected)

*slopcheck was unavailable at research time; the planner must gate the install behind a `checkpoint:human-verify` task despite the clean registry signals.*

---

## Architecture Patterns

### System Architecture Diagram

```
[iOS HealthKit] --read--> [@capgo/capacitor-health]
                                    |
                           [src/lib/native/health.ts]
                           (full impl replacing stub)
                                    |
                      +-------------+-------------+
                      |                           |
           [assertHealthTunnel()]      [HealthKit import mapping]
           (runtime guard — Layer 2)   bodyMass → weights table
                      |                stepCount → Zustand steps{}
                      |                sleepAnalysis → sleep table
                  FIREWALL             heartRate → workouts (hr field)
                                       activeEnergyBurned → workouts
                                       dietaryProtein → meals (protein)
                                       height → profiles.height
                                                |
                                   [Supabase RLS-gated REST]
                                   (client-direct upsert via supabase.ts)
                                                |
                                   [log_phi_access() SECDEF RPC]
                                   (existing PHI audit infra)
                                                |
                                   [healthkit_sync_state table]
                                   (per-user enabled/revoked/last-sync)

FIREWALL LAYERS (independent):
  Layer 1: eslint-rules/no-health-in-ad-context.cjs
           → ESLint AST rule in eslint.config.js
           → errors if health-* module imports ads/analytics/marketing
  Layer 2: src/lib/native/healthAssert.ts
           → assertHealthTunnel() — throws in dev/test, console.error in prod
           → called at the top of health.ts public exports
  Layer 3: scripts/check-no-health-in-ad-context.sh
           → CI grep gate, comment-stripped
           → runs in ci.yml lint job

CONSENT FLOW:
  [Settings] --> [HealthKitSettingsSection]
    not-connected: "Connect Apple Health" --> [HealthKitConsentModal]
      HealthKitConsentModal: checkbox (unchecked default) + "Connect Apple Health" CTA
      --> detectPlatform() === 'ios' ? requestAuthorization() : show unavailable state
    connected: "Sync now" + auto-sync toggle + "Revoke" button
    revoked: "Reconnect" + "Delete imported data" button
```

### Recommended Project Structure
```
src/
├── lib/native/
│   ├── health.ts              # Full implementation (replaces stub)
│   ├── healthAssert.ts        # Runtime guard helper (Layer 2)
│   ├── health.test.ts         # Unit tests: import mapping (mock samples)
│   └── platform.ts            # (existing — use detectPlatform)
├── components/healthkit/
│   ├── HealthKitConsentModal.tsx   # UI-SPEC Screen 1
│   ├── HealthKitSettingsSection.tsx # UI-SPEC Screens 2-4
│   └── __tests__/
│       ├── HealthKitConsentModal.test.tsx
│       └── HealthKitSettingsSection.test.tsx
eslint-rules/
├── no-health-in-ad-context.cjs     # Layer 1 ESLint custom rule (new)
└── __tests__/
    └── no-health-in-ad-context.test.cjs  # Rule unit test
scripts/
└── check-no-health-in-ad-context.sh  # Layer 3 CI grep gate (new)
supabase/migrations/
└── YYYYMMDD_p55_healthkit_sync_state.sql  # Per-user opt-in + sync state
```

### Pattern 1: `@capgo/capacitor-health` — Read Samples

The plugin uses semantic data type strings, NOT native HKQuantityTypeIdentifier strings. The mapping is:

| HealthKit concept | Plugin `dataType` | Returns `unit` | Maps to |
|---|---|---|---|
| bodyMass | `'weight'` | `'kg'` | `public.weights` (weight_id = dedupe key) |
| stepCount | `'steps'` | `'count'` | Zustand `steps[date]` (no DB table) |
| sleepAnalysis | `'sleep'` | `'hours'` | `public.sleep` (sleep_id = dedupe key) |
| heartRate | `'heartRate'` | `'bpm'` | `public.workouts` (type='cardio', name='Apple Health HR') OR profile-level summary |
| activeEnergyBurned | `'calories'` | `'kcal'` | `public.workouts` (type='cardio', name='Apple Health Activity') |
| dietaryProtein | — | `'g'` | `public.meals` (name='Apple Health Nutrition') |
| height | `'height'` | `'cm'` | `profiles.height` (one-time upsert) |

**Source:** [CITED: github.com/Cap-go/capacitor-health README + capgo.app/docs/plugins/health]

```typescript
// Source: capgo.app/docs/plugins/health/
import { Health } from '@capgo/capacitor-health';

// Request authorization (iOS only; no-op on non-iOS)
async function requestHealthAccess() {
  const { authorized } = await Health.requestAuthorization({
    read: ['weight', 'steps', 'sleep', 'heartRate', 'calories', 'height'],
    write: [],
  });
  return authorized;
}

// Read samples for a time window
async function readWeightSamples(startDate: Date, endDate: Date) {
  const { samples } = await Health.readSamples({
    dataType: 'weight',
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    limit: 100,
  });
  // Each sample: { dataType, value, unit, startDate, endDate, sourceName, sourceId }
  return samples;
}
```

### Pattern 2: 3-Layer Two-Tunnel Firewall

Mirrors Phase 39 PHARMA-02 (`no-paywall-on-safety-category`). Each layer is independently testable.

**Layer 1 — ESLint AST rule (`eslint-rules/no-health-in-ad-context.cjs`)**

The rule should be **scoped to ad/analytics/marketing files** and block any import of `./native/health` or `@/lib/native/health`. This is ADDITIVE to the existing Phase 12 `import-x/no-restricted-paths` zones (which block health.ts from flowing into Zone 1-6 directories). The new custom rule adds a NAMED rule with a clear message for per-file firewall enforcement in the reverse direction: any file under `src/lib/ads/`, `src/lib/analytics/`, `src/lib/marketing/`, `src/lib/affiliate/`, or matching `*.ad-eligible.ts` that tries to import `health` emits a named error `health-in-ad-context/no-cross-import`.

**Simpler approach (recommended):** Since the Phase 12 zones already cover directory-level blocks, the net-new AST rule focuses on a more surgical check: any `supabase/functions/` Edge Fn whose filename starts with `ad-` or `marketing-` or `analytics-` that contains a `health` import string. The CI grep gate covers this at the shell level. The runtime helper covers the execution-time layer. Together these are independently testable without duplicating the import-x zone rules.

```javascript
// eslint-rules/no-health-in-ad-context.cjs
'use strict';

const FORBIDDEN_IMPORTERS = /\/(ads?|marketing|analytics|affiliate)\//;
const HEALTH_IMPORT = /['"](.*\/native\/health|@\/lib\/native\/health)['"]/;

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Two-tunnel firewall: ad/marketing modules must not import health.ts (HEALTH-04/HEALTH-08)' },
    messages: { crossImport: 'Two-tunnel firewall violation: {{importer}} must not import health.ts. Apple §5.1.3.' },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    if (!FORBIDDEN_IMPORTERS.test(filename)) return {};
    return {
      ImportDeclaration(node) {
        if (HEALTH_IMPORT.test(node.source.value)) {
          context.report({ node, messageId: 'crossImport', data: { importer: filename } });
        }
      },
    };
  },
};
```

Wire into `eslint.config.js` after existing blocks:
```javascript
{
  files: ['src/lib/ads/**/*.{ts,tsx}', 'src/lib/analytics/**/*.{ts,tsx}',
          'src/lib/marketing/**/*.{ts,tsx}', 'src/lib/affiliate/**/*.{ts,tsx}',
          'src/**/*.ad-eligible.ts'],
  plugins: { 'health-in-ad-context': { rules: { 'no-cross-import': noHealthInAdContextRule } } },
  rules: { 'health-in-ad-context/no-cross-import': 'error' },
},
```

**Layer 2 — Runtime guard helper (`src/lib/native/healthAssert.ts`)**

```typescript
// Source: Phase 39 PHARMA-02 phaCheck.ts pattern (project precedent)
export function assertHealthTunnel(callerContext: string): void {
  // In development/test: throw so tests catch violations
  // In production: console.error (non-fatal; firewall is belt-AND-suspenders)
  const msg = `Two-tunnel firewall: health data accessed in ad context [${callerContext}]. Apple §5.1.3 violation.`;
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    throw new Error(msg);
  } else {
    console.error(msg);
  }
}
```

Call site: exported functions in `health.ts` that return PHI data call `assertHealthTunnel` if they detect an ad-context flag. The practical implementation is that `assertHealthTunnel` is called with a module-level sentinel that is set when the ad module is imported — because the ESLint rule prevents the import in the first place, this runtime check is primarily for belt-AND-suspenders in dynamic import scenarios.

**Layer 3 — CI grep gate (`scripts/check-no-health-in-ad-context.sh`)**

Pattern: comment-strip, then check for co-occurrence of `health` import + ad module context. Mirrors `check-no-paywall-on-safety-category.sh` exactly.

```bash
#!/usr/bin/env bash
# Two-tunnel firewall CI grep gate — Layer 3 of 3.
# Fails if health.ts is imported from any ad/analytics/marketing/affiliate file.
# Comment-stripped so eslint-disable cannot hide violations.
set -euo pipefail
SRC_ROOT="${1:-src}"
# Find all files under ad/marketing/analytics/affiliate that contain health import
FILES=$(grep -rl \
  --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  --exclude-dir=__tests__ --exclude-dir=node_modules --exclude-dir=dist \
  -E '(ads?|marketing|analytics|affiliate)' \
  "$SRC_ROOT" 2>/dev/null || true)
HITS=""
for f in $FILES; do
  STRIPPED=$(perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' "$f" 2>/dev/null || cat "$f")
  if echo "$STRIPPED" | grep -qE "from ['\"].*native/health|from ['\"]@/lib/native/health"; then
    HITS="$HITS$f"$'\n'
  fi
done
[ -z "$HITS" ] && echo "OK: no health↔ad cross-imports (Layer 3 passes)." && exit 0
echo "::error::FAIL: Two-tunnel firewall violation. health.ts imported from ad/marketing module." >&2
echo "$HITS" >&2
exit 1
```

### Pattern 3: `healthkit_sync_state` Table Migration

```sql
-- Per-user HealthKit opt-in state + sync tracking
create table public.healthkit_sync_state (
  user_id         uuid        primary key references auth.users(id) on delete cascade,
  healthkit_enabled boolean   not null default false,
  sync_interval   text        not null default '6h'
                              check (sync_interval in ('1h','6h','24h')),
  last_synced_at  timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- RLS: user owns their own row
alter table public.healthkit_sync_state enable row level security;
create policy "healthkit_sync_state_own"
  on public.healthkit_sync_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

SECDEF RPCs needed:
1. `upsert_healthkit_state(p_enabled bool, p_sync_interval text)` — safe toggle
2. `purge_healthkit_imports(p_user_id uuid)` — deletes rows from `weights`, `sleep`, `workouts`, `meals` where `hk_source = 'apple_health'`

### Pattern 4: Idempotent Import (dedupe by date + source)

Each HealthKit-imported row gets an `hk_source text` column set to `'apple_health'` as the dedupe signal. On import, upsert using `(user_id, date, hk_source)` ON CONFLICT to avoid duplicate rows when the same day's data is re-synced.

However: the existing tables do NOT have an `hk_source` column — this column must be added as a new nullable column via migration. The `weight_id`, `sleep_id`, etc. UUIDs are client-generated; for HealthKit imports, use a deterministic UUID derived from `(userId, date, metric, sourceId)` to ensure idempotency across syncs.

```typescript
// Deterministic UUID for HealthKit-sourced rows
import { v5 as uuidv5 } from 'uuid';
const HEALTH_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace
function healthSampleId(userId: string, date: string, metric: string, sourceId: string) {
  return uuidv5(`${userId}:${date}:${metric}:${sourceId}`, HEALTH_NAMESPACE);
}
```

Note: `uuid` package is likely already in the project or uuid v5 can be implemented with Web Crypto SubtleCrypto.

### Anti-Patterns to Avoid
- **Importing `@capacitor/core` directly in health.ts:** Use `detectPlatform()` from `platform.ts` (existing firewall rule, Phase 16). Platform detection MUST go through the shared bridge.
- **Writing native strings like `HKQuantityTypeIdentifierBodyMass` in the Capacitor layer:** The `@capgo/capacitor-health` plugin uses semantic strings (`'weight'`, `'steps'`), not native HK identifier strings. The native mapping is internal to the plugin.
- **Storing steps in a new DB table:** Steps are currently `Record<string,number>` in Zustand only — no `public.steps` table exists. HealthKit step imports follow the same pattern (Zustand-only). Creating a new DB table would break the existing schema contract.
- **Calling HealthKit on non-iOS:** MUST guard with `detectPlatform() === 'ios'` before any `@capgo/capacitor-health` call. The plugin's `isAvailable()` method also returns false on web/Android.
- **Negation-grep trap:** Do NOT put rejected module names (`ads`, `admob`, etc.) in comments inside `health.ts`. Put rejections only in commit messages / PLAN.md / SUMMARY.md (per `feedback_negation_grep_defeated_by_comment_string`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HealthKit native bridge | Custom Swift/Capacitor plugin | `@capgo/capacitor-health` | Swift entitlement + HKHealthStore + SPM wiring is significant iOS native work |
| Import deduplication | Custom dedup logic | Deterministic UUID-v5 from (user, date, metric, sourceId) + UPSERT ON CONFLICT | Naive dedup misses race conditions; UUID-v5 is idempotent by construction |
| PHI access audit | Custom audit logging | Existing `log_phi_access()` SECDEF RPC | Already battle-tested; built for exactly this use case |
| ESLint custom rule pattern | Novel rule structure | Mirror `eslint-rules/no-paywall-on-safety-category.cjs` exactly | Phase 39 precedent validated; `.cjs` extension required; RuleTester pattern established |
| Consent UI pattern | Bespoke confirmation flow | `useConfirm` hook + `Modal` primitive (existing `DeleteAccountModal.tsx` pattern) | Matches existing DS + accessibility contract |

**Key insight:** Every piece of infrastructure Phase 55 needs already exists — the only genuinely new code is `health.ts` implementation, the ESLint rule file, the grep script, and two migrations.

---

## Existing Code Inventory (gap analysis)

### health.ts — current stub (REPLACE entirely)
**Location:** `leanshot/src/lib/native/health.ts`
**Current state:** Phase 12 stub. Exports `HealthSample` type + `readHealthSample()` that always throws `Error('Phase 12 stub — implemented by Phase 18 via @capgo/capacitor-health')`.
**Gap:** Full implementation needed: `requestAuthorization()`, `readAndImport()` for each metric, `revokeAccess()`, `isEnabled()`, `syncNow()`, `purgeImportedData()`.
**Note:** The comment in the stub already names `@capgo/capacitor-health` as the planned plugin — consistent with this research's selection.

### ads.ts — counterpart (DO NOT MODIFY — firewall target)
**Location:** `leanshot/src/lib/native/ads.ts`
**Current state:** Phase 12 stub. Header comment says "This file MUST NEVER import from ./health — the firewall enforces statically." This is already correct.
**Gap:** None for Phase 55.

### platform.ts — use as-is
**Location:** `leanshot/src/lib/native/platform.ts`
**Current state:** Full implementation. `detectPlatform()` returns `'web' | 'ios' | 'android' | 'capacitor-web'`. The jsdoc states this is the sole legitimate `@capacitor/core` import site in `src/lib/native/`.
**Gap:** None — health.ts MUST use `detectPlatform()` from here, not import Capacitor directly.

### eslint.config.js — Phase 12 firewall zones (EXTEND, don't replace)
**Location:** `leanshot/eslint.config.js`
**Existing Zones:**
- Zone 1: `ads*.ts` cannot import `health.ts`
- Zone 2a: `src/lib/analytics/` cannot import `health.ts`
- Zone 2b: `posthog*.ts` cannot import `health.ts`
- Zone 3: `src/lib/affiliate/` cannot import `health.ts`
- Zone 4: `src/lib/ads/` cannot import `health.ts`
- Zone 5: `src/lib/marketing/` cannot import `health.ts`
- Zone 6: `src/lib/stripe/` cannot import `health.ts`
- Block B: `*.ad-eligible.ts` files cannot import `health.ts`
**Also present:** 4 existing custom rules: `additive-only-events`, `no-raw-service-role-client`, `no-conditional-native-review`, `no-paywall-on-safety-category`
**Gap:** New custom rule `no-health-in-ad-context` (inverse direction check) + new CI grep script. The existing zones already block health.ts → ad direction; the new custom rule adds a named, testable, INDIVIDUALLY IDENTIFIABLE layer for HEALTH-08.

### eslint-rules/ — custom rules directory (ADD to it)
**Existing files:** `additive-only-events.cjs`, `no-conditional-native-review.cjs`, `no-paywall-on-safety-category.cjs`, `no-raw-service-role-client.cjs`
**Test files:** `__tests__/additive-only-events.test.js`, `no-paywall-on-safety-category.test.cjs`, `no-raw-service-role-client.test.cjs`
**Gap:** New `no-health-in-ad-context.cjs` + `__tests__/no-health-in-ad-context.test.cjs`

### PHI audit infra — use as-is
**`phi_access_log` table:** Append-only; actor sourced from `auth.uid()` inside SECDEF RPC.
**`log_phi_access(p_accessed_user_id, p_accessed_fields, p_reason)` RPC:** Call when `readAndImport()` completes with `p_accessed_fields: ['weights.weight', 'sleep.hours', ...]`. PHI read audit already covers the import moment.
**`ad_etl_health` table:** This is the Ad ETL health-status table (not HealthKit data) — do not confuse. Has nothing to do with Phase 55.
**`audit_phi_table_triggers`:** Auto-triggers on `weights`, `sleep`, `workouts`, `meals` writes — HealthKit imports are automatically audited on INSERT without extra code.

### PrivacyInfo.xcprivacy — EXTEND (not replace)
**Location:** `leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy`
**Current state:** Declares `NSPrivacyCollectedDataTypeHealth` (HEALTH data type already present!) with `Tracking: false`, `Purposes: AppFunctionality + Analytics`. No `NSPrivacyAccessedAPITypes` entry for HealthKit specifically.
**Gap:** Apple's Privacy Manifest requires listing the specific `NSPrivacyAccessedAPIType` entries for HealthKit API usage. The `NSPrivacyCollectedDataTypeHealth` declaration in `NSPrivacyCollectedDataTypes` is already present but HealthKit's API-level access needs an entry in `NSPrivacyAccessedAPITypes`. However, HealthKit is not in Apple's "Required Reason API" list — it does not require a reason code in `NSPrivacyAccessedAPITypes`. The existing `NSPrivacyCollectedDataTypeHealth` entry in `NSPrivacyCollectedDataTypes` is the correct declaration. What HEALTH-05 requires is that the `NSPrivacyCollectedDataTypePurposes` accurately reflect the use; the current `Analytics` purpose may need to be removed or changed to `AppFunctionality` only (since PHI cannot be used for analytics per Apple §5.1.3). Also, `NSPrivacyCollectedDataTypeLinked: false` should be verified — health data linked to user identity may need `true`.
**Action:** Update `NSPrivacyCollectedDataTypeHealth` entry: remove `Analytics` purpose (conflicts with §5.1.3), set `Linked: true` (health data IS linked to user account). No new `NSPrivacyAccessedAPITypes` entry needed (HealthKit is not a Required Reason API).

### Existing domain tables (REUSE without schema changes, except `hk_source` column)

| Table | HealthKit metric | Key columns | Idempotency |
|-------|-----------------|-------------|-------------|
| `public.weights` | bodyMass | (user_id, weight_id), date, weight, body_fat | UUID-v5 from (user_id, date, 'weight', sourceId) |
| `public.sleep` | sleepAnalysis | (user_id, sleep_id), date, hours, quality | UUID-v5 from (user_id, date, 'sleep', sourceId) |
| `public.workouts` | heartRate + activeEnergyBurned | (user_id, workout_id), date, type, name, minutes | UUID-v5 from (user_id, date, 'cardio', sourceId) |
| `public.meals` | dietaryProtein | (user_id, meal_id) — check if meal_id exists | UUID-v5 from (user_id, date, 'protein', sourceId) |
| `profiles` | height | user_id, height | One-time upsert on UPSERT of profile row |
| Zustand `steps{}` | stepCount | Record<YYYY-MM-DD, number> | Date-keyed dict — natural dedup |

**Critical gap:** `public.meals` — need to verify the meal table's primary key structure to confirm it has a `meal_id` column. `Workout.type` CHECK constraint allows `'cardio' | 'strength' | 'flexibility' | 'sport' | 'walk' | 'other'` — HealthKit activity imports should use `type='cardio'`. Heart rate does not cleanly map to a workout row; the safest mapping is a synthetic workout row per day (aggregated HR) or omitting HR from the import until Phase 70. Recommend: import HR as a synthetic `cardio` workout named `'Apple Health – Heart Rate'`.

**For `hk_source` column:** Add `hk_source text` nullable column to `weights`, `sleep`, `workouts`, `meals` tables via migration. Set to `'apple_health'` for imported rows. The purge RPC deletes WHERE `hk_source = 'apple_health'`.

---

## Common Pitfalls

### Pitfall 1: `@capgo/capacitor-health` publish recency
**What goes wrong:** The package was first published 2025-09-24 (8 months old) and most recently published 2026-05-24 (yesterday). The rapid publishing cadence (70 versions in 8 months) could signal instability.
**Why it happens:** Capgo maintains a Capacitor version parity pattern — 7.x for Cap7, 8.x for Cap8. The high version count reflects this major-version tracking.
**How to avoid:** Lock to `^8.5.2` in package.json; review changelog on major bumps. The `checkpoint:human-verify` task before install covers this.
**Warning signs:** Semver minor/patch versions should not introduce breaking API changes per semver; if API changes between 8.x patches, flag.

### Pitfall 2: `detectPlatform()` must be used — not `Capacitor` directly
**What goes wrong:** Importing `Capacitor` from `@capacitor/core` directly in `health.ts` violates the Phase 16 firewall rule (platform.ts is the sole import site).
**Why it happens:** Developers naturally reach for `Capacitor.getPlatform()` in native bridge code.
**How to avoid:** Import `detectPlatform` from `./platform` in health.ts. The existing eslint.config.js comment documents this explicitly.
**Warning signs:** `import { Capacitor } from '@capacitor/core'` in health.ts.

### Pitfall 3: Workout table CHECK constraint for type
**What goes wrong:** `public.workouts.type` has CHECK `('cardio', 'strength', 'flexibility', 'sport', 'walk', 'other')`. The local `Workout` TypeScript type allows `'resistance' | 'cardio' | 'hybrid' | 'walk' | 'yoga'` — these differ. HealthKit energy imports mapped to `type='hybrid'` or `type='resistance'` would fail the DB constraint.
**Why it happens:** DB and TypeScript types drifted (TypeScript type is `'resistance'` but DB allows `'strength'`).
**How to avoid:** Map HealthKit activity imports exclusively to `type='cardio'`. The DB CHECK constraint is the ground truth; TypeScript type is loose.
**Warning signs:** A 23514 CHECK violation on INSERT to workouts.

### Pitfall 4: Steps have no cloud table — Zustand-only
**What goes wrong:** Attempting to write HealthKit step counts to a `public.steps` table fails — no such table exists. Steps are stored only as `steps: Record<string, number>` in the Zustand persist store.
**Why it happens:** Steps are lightweight daily counters; cloud sync was never implemented for them.
**How to avoid:** HealthKit step imports write to Zustand via `useStore.getState().bulkSetSteps(...)`. No DB upsert. This also means steps are device-local; the Phase 70 HUMAN-UAT should note this.
**Warning signs:** Any code attempting `supabase.from('steps').upsert(...)`.

### Pitfall 5: Negation-grep trap with firewall comment text
**What goes wrong:** Adding the string `ads` or `admob` in a comment inside `health.ts` or any file under `src/lib/native/health*` causes the CI grep gate (`check-no-health-in-ad-context.sh`) to fail even though there is no real import.
**Why it happens:** The grep gate is comment-stripped via `perl -0pe 's{/\*.*?\*/}{}gs'` but only strips `/* */` and `//` comments — not all prose. If the gate uses proximity windows, the comment would still be found.
**How to avoid:** Keep rejected-alternative names (`admob`, `adsense`, `ads.ts`) OUT of committed files. Put in PLAN.md / SUMMARY.md / commit messages only (per `feedback_negation_grep_defeated_by_comment_string`).

### Pitfall 6: PrivacyInfo.xcprivacy `Analytics` purpose conflicts with §5.1.3
**What goes wrong:** The existing `NSPrivacyCollectedDataTypeHealth` entry lists `NSPrivacyCollectedDataTypePurposeAnalytics` as a purpose. Apple §5.1.3 explicitly bans using HealthKit data for advertising, marketing, or analytics. An App Store reviewer could reject on this basis.
**Why it happens:** The entry was added by Phase 53 before the HealthKit firewall decision was finalized.
**How to avoid:** Remove `NSPrivacyCollectedDataTypePurposeAnalytics` from the Health data type's purposes. Keep only `NSPrivacyCollectedDataTypePurposeAppFunctionality`.
**Warning signs:** Apple WWDC rejection for "health data used for analytics purposes".

### Pitfall 7: `dietaryProtein` not in `@capgo/capacitor-health` supported types
**What goes wrong:** HEALTH-03 requires `dietaryProtein` import. The plugin's documented data types are: `steps`, `distance`, `calories`, `heartRate`, `weight`, `sleep`, `respiratoryRate`, `oxygenSaturation`, `restingHeartRate`, `heartRateVariability`, `bloodPressure`, `bloodGlucose`, `bodyTemperature`, `height`, `flightsClimbed`, `exerciseTime`, `distanceCycling`, `bodyFat`, `basalBodyTemperature`, `basalCalories`, `totalCalories`, `mindfulness`, `workouts`. `dietaryProtein` is NOT in this list.
**Why it happens:** Dietary data types are less commonly supported in cross-platform health plugins.
**How to avoid:** `dietaryProtein` should be omitted from the Phase 55 plugin-based implementation and treated as a Phase 70 extension (either via custom Swift bridge or if the plugin adds it). Phase 55 health.ts should include a `readDietaryProtein()` stub that returns empty and notes the limitation.
**Warning signs:** Plugin throwing `unsupported data type` at runtime.

---

## Code Examples

### health.ts full implementation skeleton

```typescript
// Source: Phase 12 stub + @capgo/capacitor-health 8.x API [CITED: capgo.app/docs/plugins/health/]
// DO NOT import from any *.ad-eligible.ts, src/lib/analytics/*, src/lib/affiliate/*,
// src/lib/ads/*, src/lib/marketing/*, or src/lib/native/ads*.ts file —
// enforced by import-x/no-restricted-paths in eslint.config.js (Phase 12 D-02).
// DO NOT import @capacitor/core directly — use detectPlatform() from ./platform.
import { Health } from '@capgo/capacitor-health';
import { detectPlatform } from './platform';
import { assertHealthTunnel } from './healthAssert';

export type HealthMetric = 'weight' | 'steps' | 'sleep' | 'heartRate' | 'calories' | 'height';

export interface HealthSample {
  dataType: HealthMetric;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  sourceName?: string;
  sourceId?: string;
}

/** Returns true only on iOS with HealthKit available. */
export async function isHealthKitAvailable(): Promise<boolean> {
  if (detectPlatform() !== 'ios') return false;
  const { available } = await Health.isAvailable();
  return available;
}

/** Requests read authorization. Call only after isHealthKitAvailable(). */
export async function requestHealthKitAuthorization(): Promise<boolean> {
  assertHealthTunnel('requestHealthKitAuthorization');
  const result = await Health.requestAuthorization({
    read: ['weight', 'steps', 'sleep', 'heartRate', 'calories', 'height'],
    write: [],
  });
  return result.authorized === true;
}

/** Read samples for a metric between two dates. */
export async function readHealthSamples(
  metric: HealthMetric,
  startDate: Date,
  endDate: Date
): Promise<HealthSample[]> {
  assertHealthTunnel('readHealthSamples');
  if (detectPlatform() !== 'ios') return [];
  const { samples } = await Health.readSamples({
    dataType: metric,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    limit: 500,
  });
  return samples as HealthSample[];
}
```

### Migration — `hk_source` column additions

```sql
-- Add hk_source to health-data tables for HealthKit import tracking + purge
-- Phase 55 Plan XX — HEALTH-03/07
alter table public.weights add column if not exists hk_source text;
alter table public.sleep   add column if not exists hk_source text;
alter table public.workouts add column if not exists hk_source text;
alter table public.meals    add column if not exists hk_source text;

-- SECDEF purge RPC for HEALTH-07
create or replace function public.purge_healthkit_imports(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  if auth.uid() is null or auth.uid() != p_user_id then
    raise exception 'not_authorized' using errcode = '28000';
  end if;
  delete from public.weights  where user_id = p_user_id and hk_source = 'apple_health';
  delete from public.sleep    where user_id = p_user_id and hk_source = 'apple_health';
  delete from public.workouts where user_id = p_user_id and hk_source = 'apple_health';
  delete from public.meals    where user_id = p_user_id and hk_source = 'apple_health';
end;
$$;
revoke all on function public.purge_healthkit_imports(uuid) from public;
grant execute on function public.purge_healthkit_imports(uuid) to authenticated;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `cordova-plugin-health` | `@capgo/capacitor-health` | Capacitor 3+ era | Capacitor-native; no Cordova bridge overhead |
| `@perfood/capacitor-healthkit` (Cap 4-era) | `@capgo/capacitor-health` (Cap 8) | 2025 Cap8 release | Cap8 peer dep; SPM-native; more data types |
| ESLint `no-restricted-imports` for firewall | `import-x/no-restricted-paths` zones | Phase 12 | Directory-level zones are more precise than import name patterns |
| Custom Swift bridge | Capacitor plugin | Phase 12 era | Plugin abstracts SPM + entitlement wiring |

**Deprecated/outdated:**
- `@capgo/capacitor-health` versions below 8.x: incompatible with project's `@capacitor/core ^8.3.4`
- `@perfood/capacitor-healthkit`: peer dep `^4.0.0` is incompatible

---

## Open Questions

1. **`dietaryProtein` support gap**
   - What we know: `@capgo/capacitor-health` does not list `dietaryProtein` in its supported data types
   - What's unclear: Whether the 8.x plugin added dietary support not reflected in docs
   - Recommendation: RESOLVED — ship `dietaryProtein` as a Phase 55 stub (no-op returning empty array) with a TODO for Phase 70. HEALTH-03 lists it as a target; ship the code shape but note the plugin limitation.

2. **`public.meals` primary key — `meal_id` column confirmation**
   - What we know: `meals` table exists (`20260514000001_meals.sql`); TypeScript `Meal` type has no `meal_id` field
   - What's unclear: Whether the DB table has a `meal_id` primary key column (the TypeScript type uses `date` + `name` as natural key)
   - Recommendation: RESOLVED — the planner must read `20260514000001_meals.sql` at plan time to confirm PK structure before writing the meals import mapping task. If `meal_id` does not exist, nutritional protein imports should use a compound key (date + 'apple_health' + 'protein') for the UUID-v5.

3. **`heartRate` mapping strategy**
   - What we know: HealthKit provides per-measurement HR samples; the workouts table expects one row per workout session
   - What's unclear: Whether daily-aggregated HR (avg/min/max) should become a workout row, or be dropped from Phase 55 scope
   - Recommendation: RESOLVED — import HR as a single synthetic `cardio` workout row per day with `name='Apple Health – Heart Rate'`, `minutes=1` (nominal), storing the average HR in `rpe` field or a future `heart_rate` column. This avoids schema changes while preserving the data. Document as Phase 70 refinement target.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm install | ✓ | v22.18.0 | — |
| npm | package install | ✓ | lockfileVersion 3 | — |
| `@capacitor/core` | Plugin peer dep | ✓ | ^8.3.4 (in package.json) | — |
| iOS simulator / device | HEALTH-01 runtime | ✗ | — | Deferred to Phase 70; all Phase 55 work is mock-testable |
| HealthKit entitlement | On-device reads | ✗ | Pending (VENDOR-03) | Deferred to Phase 70 |
| Deno (Edge Fn tests) | Supabase Fns | ✓ | $HOME/.deno/bin/deno | — |

**Missing dependencies with no fallback:** None that block Phase 55 deliverables.
**Missing dependencies with fallback (deferred):** iOS device + HealthKit entitlement → Phase 70 HUMAN-UAT.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts — jsdom environment for src/ tests) |
| Config file | `leanshot/vitest.config.ts` |
| Quick run command | `npm run test:unit` (per Vitest 4.x `projects:` caveat, run as `npx vitest run --config vite.config.ts` for targeted runs per `reference_vitest_4_projects_config_masks_default`) |
| Full suite command | `npm run test:unit && npm run lint` |

**Vitest 4.x caveat:** `vitest.config.ts` uses a `projects:` block (for the phase38-eval project) which can mask default `test:` config. Health.ts unit tests should be discoverable via the default `src/**/*.test.ts` glob in the base `test:` config. Verify tests run with `npx vitest run src/lib/native/health.test.ts`.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HEALTH-01 | Plugin types + requestAuthorization API shape | unit | `npx vitest run src/lib/native/health.test.ts` | ❌ Wave 0 |
| HEALTH-02 | HealthKitConsentModal renders; checkbox unchecked by default; CTA disabled until checked | unit | `npx vitest run src/components/healthkit/HealthKitConsentModal.test.tsx` | ❌ Wave 0 |
| HEALTH-03 | Import mapping: mock samples → correct table row shapes | unit | `npx vitest run src/lib/native/health.test.ts` | ❌ Wave 0 |
| HEALTH-04 | ESLint rule blocks cross-import in ad file | unit (eslint RuleTester) | `npx vitest run eslint-rules/__tests__/no-health-in-ad-context.test.cjs` | ❌ Wave 0 |
| HEALTH-04 | Runtime guard throws in dev/test context | unit | `npx vitest run src/lib/native/health.test.ts` | ❌ Wave 0 |
| HEALTH-04 | CI grep gate exits 1 on violation | unit (shell test) | `npx vitest run scripts/__tests__/check-no-health-in-ad-context.test.ts` OR bash direct | ❌ Wave 0 |
| HEALTH-05 | PrivacyInfo.xcprivacy contains Health data type + AppFunctionality purpose only | unit (xml parse) | Covered by existing `scripts/audit-privacy-manifest.mjs` | ✅ (extends existing) |
| HEALTH-07 | Revoke RPC mock: blocks future syncs; purge RPC deletes hk_source rows | unit | `npx vitest run src/lib/native/health.test.ts` | ❌ Wave 0 |
| HEALTH-08 | 3-layer independence: each layer catches a violation the others miss | unit (per-layer) | Per above | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run lint && npm run typecheck`
- **Per wave merge:** `npm run test:unit && npm run lint`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/native/health.test.ts` — covers HEALTH-01, HEALTH-03, HEALTH-04 (runtime), HEALTH-07
- [ ] `src/components/healthkit/__tests__/HealthKitConsentModal.test.tsx` — covers HEALTH-02
- [ ] `src/components/healthkit/__tests__/HealthKitSettingsSection.test.tsx` — covers HEALTH-02/07 UI states
- [ ] `eslint-rules/__tests__/no-health-in-ad-context.test.cjs` — covers HEALTH-04/HEALTH-08 (ESLint layer)
- [ ] `@capgo/capacitor-health` mock at `src/lib/native/__mocks__/@capgo/capacitor-health.ts` — enables all unit tests without native runtime

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | RLS on `healthkit_sync_state` + `purge_healthkit_imports` SECDEF; auth.uid() = user_id |
| V5 Input Validation | yes | SECDEF RPC validates caller = p_user_id; CHECK constraints on `sync_interval` |
| V6 Cryptography | no | — |
| PHI firewall (HIPAA/Apple §5.1.3) | yes | 3-layer firewall; log_phi_access() on import |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| HealthKit data leaking to ad targeting | Information Disclosure | 3-layer firewall (ESLint + runtime + CI grep) |
| Cross-user data access on purge | Elevation of Privilege | SECDEF RPC checks `auth.uid() = p_user_id` |
| Bulk import overwhelming DB | Denial of Service | `limit: 500` per readSamples call; import one metric at a time |
| Forged `hk_source` on direct DB write | Tampering | RLS (auth.uid() = user_id) prevents cross-user writes; hk_source is just a tag, not a trust boundary |
| PrivacyInfo.xcprivacy inconsistency with actual reads | Repudiation / App Store rejection | Audit script `audit-privacy-manifest.mjs` + HEALTH-05 test |

---

## Sources

### Primary (HIGH confidence)
- npm registry — `@capgo/capacitor-health` 8.5.2 (peerDeps, publish history, download stats, postinstall, repo URL)
- npm registry — `@perfood/capacitor-healthkit` 1.3.2 (peerDep `^4.0.0` — incompatibility confirmed)
- `leanshot/eslint.config.js` — current firewall zones, existing custom rule pattern
- `leanshot/eslint-rules/no-paywall-on-safety-category.cjs` — custom rule structural precedent
- `leanshot/eslint-rules/__tests__/` — test file naming convention
- `supabase/migrations/20270702000004_phi_access_log.sql` + `20270702000005_log_phi_access_rpc.sql` — PHI audit infra
- `supabase/migrations/20260514000000_weights.sql` — weights table schema
- `supabase/migrations/20260514000005_sleep.sql` — sleep table schema
- `supabase/migrations/20260514000002_workouts.sql` — workouts table + type CHECK constraint
- `leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy` — existing privacy manifest
- `leanshot/src/lib/native/health.ts` — current stub (Phase 12)
- `leanshot/src/types/index.ts` — WeightLog, SleepLog, Workout, Meal, Measurement domain types
- `leanshot/src/lib/storage.ts` — PersistedState: `steps: Record<string,number>` (no DB table)

### Secondary (MEDIUM confidence)
- [CITED: capgo.app/docs/plugins/health/] — plugin API overview (readSamples, requestAuthorization, supported data types)
- [CITED: github.com/Cap-go/capacitor-health README] — data types, iOS plist requirements, install

### Tertiary (LOW confidence)
- `dietaryProtein` not in plugin supported types — inferred from docs review; confirmed absent from type list; tagged as open question

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@capgo/capacitor-health` `isAvailable()` returns `{ available: boolean }` | Code Examples | Planner task for health.ts implementation may use wrong destructure; fix at execute time |
| A2 | `requestAuthorization()` returns `{ authorized: boolean }` | Code Examples | Same — fix at execute time; on-device testing deferred to P70 anyway |
| A3 | `dietaryProtein` not in plugin v8.5.2 | Pitfall 7 / Open Questions | If plugin does support it, the stub can be upgraded at execute time |
| A4 | `public.meals` has a `meal_id` primary key column | Don't Hand-Roll | Planner must read 20260514000001_meals.sql before writing meals import task |
| A5 | HealthKit is NOT a "Required Reason API" in Apple's NSPrivacyAccessedAPITypes list | PrivacyInfo gap analysis | If wrong, need to add NSPrivacyAccessedAPITypes entry — low risk; can be verified in Apple docs |

---

## Metadata

**Confidence breakdown:**
- Plugin selection: HIGH — confirmed Capacitor 8 peerDep via npm view
- Firewall mechanism: HIGH — existing codebase patterns fully inventoried; Phase 39 PHARMA-02 precedent
- Import mapping: MEDIUM-HIGH — existing tables confirmed; `meals` PK structure needs planner verification (A4)
- PrivacyInfo.xcprivacy: HIGH — file read directly; existing Health entry confirmed
- Plugin API: MEDIUM — docs-verified but not runtime-tested (on-device deferred to Phase 70)

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable domain; plugin publish cadence is high so check for breaking 8.x changes if delayed)
