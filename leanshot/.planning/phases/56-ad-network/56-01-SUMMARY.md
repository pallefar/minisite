---
phase: 56-ad-network
plan: "01"
subsystem: ads-core
tags: [ads, guard, freq-cap, placement-registry, typescript, vitest]
dependency_graph:
  requires: []
  provides:
    - canShowAds(surface, tier) guard
    - AdSurface type + EXCLUDED_SURFACES set
    - canShowNextImpression / resetSessionCounts freq cap
    - AdPlacementConfig interface + AdServingMode union
    - fetchPlacements() fail-safe fetcher
  affects:
    - leanshot/src/lib/ads/ (new module, all files created)
tech_stack:
  added: []
  patterns:
    - Pure TypeScript module-level guard (no framework deps)
    - Module-level Map for ephemeral session state (no localStorage)
    - Fail-safe async fetcher (catch → [] instead of throw)
key_files:
  created:
    - leanshot/src/lib/ads/canShowAds.ts
    - leanshot/src/lib/ads/canShowAds.test.ts
    - leanshot/src/lib/ads/freqCap.ts
    - leanshot/src/lib/ads/freqCap.test.ts
    - leanshot/src/lib/ads/placementRegistry.ts
    - leanshot/src/lib/ads/placementRegistry.test.ts
  modified: []
decisions:
  - "EXCLUDED_SURFACES hardcoded frozen Set (not DB-config): compliance invariant; test asserts exact membership so future removal fails CI"
  - "Tier check before surface check in canShowAds (T-56-02): paid gate first, then exclusion"
  - "freqCap uses module-level Map (not localStorage): resets on page reload per session spec"
  - "fetchPlacements returns [] on error (not throws): fail-safe so no ad fetch error reaches render path"
  - "DEFAULT_FREQ_CAP = 3: sane ceiling default when DB row omits the field"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-25T14:04:55Z"
  tasks_completed: 3
  files_created: 6
---

# Phase 56 Plan 01: Ad Guard Core Summary

**One-liner:** Pure dependency-free ad guard trio — canShowAds surface+tier exclusion, session freq-cap Map, and AdPlacementConfig registry contract — 41 Vitest tests, all green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | canShowAds surface+tier guard (AD-03, AD-10) | e4339b69 | canShowAds.ts, canShowAds.test.ts |
| 2 | Session frequency cap (AD-08) | b6aa834c | freqCap.ts, freqCap.test.ts |
| 3 | Placement registry type contract + fetcher (AD-05, AD-04) | eb86fcb3 | placementRegistry.ts, placementRegistry.test.ts |

## Exported Signatures (verbatim for Plans 56-03 / 56-05)

### canShowAds.ts

```typescript
export type AdSurface =
  | 'clinic' | 'clinic-settings' | 'clinic-drill-in' | 'share' | 'admin' | 'dose-log' | 'patient'
  | 'home' | 'body' | 'nutrition' | 'activity' | 'supplements' | 'mood' | 'insights'
  | 'community' | 'classroom' | 'events' | 'marketing' | 'onboarding';

export const EXCLUDED_SURFACES: ReadonlySet<AdSurface>;  // 7 MUST-NEVER surfaces, frozen

export function canShowAds(surface: AdSurface, tier: Tier): boolean;
// tier==='paid' → false; surface in EXCLUDED_SURFACES → false; else true
```

### freqCap.ts

```typescript
export function canShowNextImpression(placementId: string, sessionCeiling: number): boolean;
// true + increment while count < ceiling; false (no increment) at ceiling

export function resetSessionCounts(): void;
// clears all session counters (call in beforeEach for test isolation)
```

### placementRegistry.ts

```typescript
export type AdServingMode = 'embed-code' | 'ad-platform' | 'house-ads';

export interface AdPlacementConfig {
  placement_id: string;
  surface: AdSurface;
  mode: AdServingMode;
  network: 'admob' | 'adsense' | null;
  freq_cap_per_session: number;
  enabled: boolean;
  ab_variant: string | null;    // AD-07 PostHog split
  embed_html: string | null;    // embed-code mode
  house_ad_slug: string | null; // house-ads mode
}

export function rowToPlacementConfig(row: Record<string, unknown>): AdPlacementConfig;
// safe defaults: enabled=false, freq_cap_per_session=3, nulls for optional fields

export async function fetchPlacements(): Promise<AdPlacementConfig[]>;
// reads ad_placements table; returns [] on any error (T-56-03 fail-safe)
```

## Verification Results

- `npx vitest run src/lib/ads/ --config vite.config.ts` — 41 tests, 3 files, all passed
- `npx tsc -p tsconfig.app.json --noEmit` — no type errors
- No imports from `native/health` in any ads/ file

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints or auth paths introduced. `fetchPlacements` reads the `ad_placements` table using the existing Supabase client (anon/user JWT via RLS). No PHI fields in the table. Consistent with T-56-03 disposition (accept).

## Self-Check: PASSED

- leanshot/src/lib/ads/canShowAds.ts — FOUND (committed e4339b69)
- leanshot/src/lib/ads/canShowAds.test.ts — FOUND (committed e4339b69)
- leanshot/src/lib/ads/freqCap.ts — FOUND (committed b6aa834c)
- leanshot/src/lib/ads/freqCap.test.ts — FOUND (committed b6aa834c)
- leanshot/src/lib/ads/placementRegistry.ts — FOUND (committed eb86fcb3)
- leanshot/src/lib/ads/placementRegistry.test.ts — FOUND (committed eb86fcb3)
