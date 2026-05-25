---
phase: 57-watch-apps-apple-watch-wear-os
reviewed: 2026-05-25T00:00:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - leanshot/src/lib/watch/sync-contract.ts
  - leanshot/src/lib/watch/complication-data.ts
  - leanshot/eslint-rules/no-health-in-ad-context.cjs
  - leanshot/scripts/check-no-health-in-ad-context.sh
  - leanshot/apps/ios/App/LeanShotWatch/QuickLogView.swift
  - leanshot/apps/ios/App/LeanShotWatch/WatchConnectivityManager.swift
  - leanshot/apps/android/wear/src/main/java/app/leanshot/wear/WatchDataLayerService.kt
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: resolved
resolved: 2026-05-25T00:00:00Z
resolution: >
  CR-01 fixed (eslint.config.js files[] now includes src/lib/watch/**; verified active via
  --print-config). WR-01 fixed (complication-data.ts nextSite now excludes sites used <14d,
  matching SiteRotationCard 'empty' status; 34/34 watch tests green). IN-01 fixed
  (EMPTY_DEFAULT returned via spread). WR-02 addressed (explicit TODO/WARNING added to the
  Swift makeStubDedupedId stub noting it deliberately diverges from the TS canonical and must
  be ported at Phase 70). IN-02 left as documented scaffold stub (already carries TODO Phase 70).
  Fix commit follows 57 wave merges.
---

# Phase 57: Code Review Report

**Reviewed:** 2026-05-25
**Depth:** deep
**Files Reviewed:** 7 (TS modules + firewall files + native scaffolds)
**Status:** issues_found

## Summary

The two primary TS modules (`sync-contract.ts`, `complication-data.ts`) are generally correct: the T-57-AUTH user_id trust boundary is properly enforced, intra-batch and server-side deduplication is sound, and the `assertHealthTunnel` Layer 2 marker is called. One **critical** gap exists in the three-layer WATCH-08 firewall: `eslint.config.js` omits `src/lib/watch/` from the `files:` array that activates the `no-health-in-ad-context` rule, leaving Layer 1 silent for the newly-protected surface. Two behavioral warnings: the watch complication's site-rotation recommendation diverges from `SiteRotationCard` in the 7–14-day window, and the Swift scaffold's `makeStubDedupedId` implements a different (stripped) algorithm than the TS canonical function — an ID-format mismatch that will silently surface as broken deduplication if the Phase 70 wiring inherits the stub.

Native scaffolds (SwiftUI, WidgetKit, Wear OS Compose/Tile) are reviewed leniently per the scope contract; stub UI and deferred behavior are intentional.

---

## Critical Issues

### CR-01: Layer 1 ESLint firewall does not cover `src/lib/watch/` — WATCH-08 gap

**File:** `leanshot/eslint.config.js:344-360`

**Issue:** The `files:` array that activates the `leanshot-health/no-health-in-ad-context` rule lists `src/lib/ads/`, `src/lib/analytics/`, `src/lib/marketing/`, `src/lib/affiliate/`, `src/lib/native/ads*.ts`, and `src/**/*.ad-eligible.ts` — but **not** `src/lib/watch/**/*.{ts,tsx}`. The rule's internal `FORBIDDEN_IMPORTERS` regex (`.cjs` line 52) does include `lib/watch`, so the regex is correct, but ESLint never applies the rule to watch files because the config's `files:` glob does not match them. Layer 3 (shell grep, `.sh` line 75) and Layer 2 (`assertHealthTunnel`) both cover `lib/watch`, but the WATCH-08 requirement mandates **three independent** layers. Layer 1 is currently a no-op for this surface.

**Concrete risk:** A future `src/lib/watch/` file that imports `health.ts` (e.g. to pull pharmacology data into a complication) would pass ESLint CI, pass the Layer 2 marker (which is a tracing no-op, not a throw), and only be caught by the Layer 3 shell grep — which runs as a separate CI step that may be skipped on draft PRs.

**Fix:** Add `src/lib/watch/**/*.{ts,tsx}` to the `files:` array in the health-context ESLint config block:

```js
// leanshot/eslint.config.js ~line 345
files: [
  'src/lib/ads/**/*.{ts,tsx}',
  'src/lib/analytics/**/*.{ts,tsx}',
  'src/lib/marketing/**/*.{ts,tsx}',
  'src/lib/affiliate/**/*.{ts,tsx}',
  'src/lib/watch/**/*.{ts,tsx}',   // ← add this line
  'src/lib/native/ads*.ts',
  'src/**/*.ad-eligible.ts',
],
```

---

## Warnings

### WR-01: `watchComplicationData` `nextSite` logic diverges from `SiteRotationCard` in the 7–14-day window

**File:** `leanshot/src/lib/watch/complication-data.ts:89-95`

**Issue:** The comment at line 86–88 claims the logic is "SiteRotationCard.tsx lines 23-30 recency logic, extracted pure." It is not identical. The divergence occurs for sites used 7–14 days ago:

| Surface | Sites used 7–14d ago | Recommendation behaviour |
|---|---|---|
| `SiteRotationCard` | Marked `'older'` | **Not** eligible for `'next'` — only `'empty'` sites (>14d or never) get the `'next'` badge |
| `watchComplicationData` | Not in `recentSites` (set requires `< 7d`) | **Eligible** — `SITES.find(s => !recentSites.has(s))` picks them |

Scenario: user injected all 8 sites between 8 and 13 days ago (GLP-1 users with weekly cadence will be in this state regularly). The phone UI (`SiteRotationCard`) shows no recommendation, but the Apple Watch complication and Wear OS tile recommend `abdomen-ul`. The watch contradicts the phone on the most safety-relevant feature of the complication.

**Fix:** Mirror `SiteRotationCard`'s two-tier status logic:

```typescript
// complication-data.ts — replace lines 89-95
const siteStatus: Record<string, 'recent' | 'older' | 'empty'> = Object.fromEntries(
  SITES.map((s) => [s, 'empty' as const]),
);
injections.slice(0, 8).forEach((inj) => {
  if (!inj.site) return;
  const days = (today.getTime() - new Date(inj.datetime).getTime()) / 86_400_000;
  if (days < 7 && siteStatus[inj.site] === 'empty') siteStatus[inj.site] = 'recent';
  else if (days < 14 && siteStatus[inj.site] === 'empty') siteStatus[inj.site] = 'older';
});
const nextSite = (SITES.find((s) => siteStatus[s] === 'empty') ?? null) as InjectionSite | null;
```

---

### WR-02: Swift `makeStubDedupedId` produces IDs that do not match TS `makeDedupedId` for any input

**File:** `leanshot/apps/ios/App/LeanShotWatch/QuickLogView.swift:56-78`

**Issue:** The Swift stub iterates over raw UTF-8 bytes and XORs only `bytes[i % 16]` per byte. The TS canonical function (`sync-contract.ts:71-78`) additionally XORs `bytes[(i+1) % 16]` with the high byte of the UTF-16 code point, then applies a rotate-and-XOR carry mix step to `bytes[(i+2) % 16]`. For any ASCII input (which all watch payloads will be), the high-byte XOR is zero, but the **carry mix step is entirely absent in Swift**. Empirically:

```
Input: ('apple_watch', '2024-01-15T10:00:00.000Z')
Swift stub output:  17d7c90b-c9c7-5281-84ed-58ca47d432d2
TS canonical output: 5f1cb352-6bad-51f9-bcc2-4212b476d59f
```

They differ for every input. The watch sends the Swift-computed `deduped_id` in its payload; `dedupeAndMerge` trusts `q.deduped_id` as the `log_id` and uses it for idempotency checks against `existingLogIds`. This works correctly during Phase 57 (the stub runs and the ID is stored). The risk surfaces at Phase 70 wiring: if the Swift implementation is replaced with the correct algorithm, all scaffold-era logs (stored with `SWIFT_ID`) will not be deduped by new arrivals (which send `TS_ID`). Each watch-tap would produce a duplicate injection row.

The comment at line 55–56 says "Minimal stub dedupe ID … full algorithm lives in TS sync-contract.ts," which acknowledges the gap — but the divergence is not flagged as a known deviation to fix at Phase 70. Without an explicit TODO referencing the ID-format break, Phase 70 implementers may port the algorithm correctly and silently introduce duplicate injections for any existing scaffold-era test data.

**Fix:** Add an explicit Phase 70 WARNING comment and, optionally, use a simple UUID placeholder so no one mistakes the stub output for a stable ID format:

```swift
// QuickLogView.swift line 55
// STUB: produces IDs that DO NOT MATCH TS makeDedupedId (carry mix step omitted).
// Phase 70 MUST replace this entire function with a full port of the TS algorithm.
// Any injections logged via this stub will have log_ids that CANNOT be deduplicated
// by a correctly-ported Phase 70 implementation without a data migration.
private func makeStubDedupedId(source: String, datetime: String) -> String {
    return UUID().uuidString.lowercased()  // random — signals scaffold clearly
}
```

---

## Info

### IN-01: `EMPTY_DEFAULT` returned by direct reference — mutation by caller corrupts future calls

**File:** `leanshot/src/lib/watch/complication-data.ts:35-41, 63`

**Issue:** The module-level `const EMPTY_DEFAULT` is returned directly on line 63 (`return EMPTY_DEFAULT`). TypeScript callers typed as receiving `WatchComplicationData` can mutate the returned object (e.g. `result.nextSite = 'thigh-l'`), which would corrupt `EMPTY_DEFAULT` for all subsequent calls in the same module lifetime. Current tests do not mutate the return value, but this is a latent correctness trap. The pattern used elsewhere in the app (e.g. `initialState` in `storage.ts`) uses factory functions precisely to avoid this.

**Fix:** Return a spread copy, or freeze the constant:

```typescript
// Option A — spread (cheapest):
if (!state.user) return { ...EMPTY_DEFAULT };

// Option B — freeze at declaration:
const EMPTY_DEFAULT: WatchComplicationData = Object.freeze({
  nextDoseDate: null,
  currentStreak: 0,
  nextSite: null,
  medication: '',
  lastDose: null,
});
```

---

### IN-02: Kotlin `sendQueuedLog` sends `site: ""` (empty string) instead of `null`

**File:** `leanshot/apps/android/wear/src/main/java/app/leanshot/wear/QuickLogActivity.kt:48`

**Issue:** The scaffold sends `"site" to ""` (empty string). The TS `WatchQueuedLog.site` field is typed as `InjectionSite | null`; an empty string is not a member of the `InjectionSite` union. `dedupeAndMerge` passes `q.site` directly to `Injection.site` (line 132 of `sync-contract.ts`), and the DB `injections.site` column has no CHECK constraint, so `""` would be stored as-is and later treated as an invalid site value by all site-rotation logic. The Java Map is `Map<String, String>`, making true `null` unrepresentable without a type change.

This is a scaffold with explicit Phase 70 TODO comments, so the severity is info rather than warning. The fix at Phase 70 should change the payload map type to `Map<String, Any?>` and send `null` for an unspecified site, matching the Swift pattern (`NSNull()`).

**Fix for Phase 70:** Change `sendQueuedLog` signature and QuickLogActivity payload:

```kotlin
// QuickLogActivity.kt — Phase 70 fix
val logMap: Map<String, Any?> = mapOf(
    "deduped_id" to WatchDataLayerService.makeDedupedId("wear_os", datetime),
    "datetime" to datetime,
    "dose" to "0.5",
    "unit" to "mg",
    "site" to null,          // ← null, not ""
    "source" to "wear_os"
)
```

---

_Reviewed: 2026-05-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
