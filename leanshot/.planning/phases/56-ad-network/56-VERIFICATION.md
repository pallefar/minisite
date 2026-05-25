---
phase: 56-ad-network
verified: 2026-05-25T00:00:00Z
status: passed
score: 6/6
overrides_applied: 0
deferred:
  - truth: "Free-tier consumer surface shows live ad placements (real AdSense/AdMob fill)"
    addressed_in: "Phase 70"
    evidence: "D-08 milestone contract: real ad fill / on-device AdMob / live eCPM / publisher approval deferred to Phase 70 (Consolidated UAT). SC-1 is verifiable at infrastructure level: canShowAds gate passes free-tier surfaces, AdRenderer dispatches 3 modes, initAdNetwork installed. Real publisher IDs and live fill are Phase 70 scope."
  - truth: "Admin revenue dashboard shows live eCPM / RPM / fill rate / CTR data"
    addressed_in: "Phase 70"
    evidence: "D-08: live eCPM/RPM data requires publisher approval (Phase 70). Infrastructure verified: get_ad_revenue_dashboard RPC exists, AdRevenueDashboardPage calls it and renders rows, empty-state is correct pre-P70 behavior."
---

# Phase 56: Ad Network — Verification Report

**Phase Goal:** Three-mode ad system (embed-code / ad-platform / house ads) with strict surface exclusion (clinic / doctor-share / admin / dose-log / patient / share NEVER show ads), tier-gated (Pro/Lifetime zero ads), HealthKit firewall preserved, and per-network revenue ETL closing the unit-economics loop with Phase 33 ad-spend.
**Verified:** 2026-05-25T00:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Free-tier consumer surface shows ad placements; Pro/Lifetime shows zero ads | VERIFIED (infra) | `canShowAds.ts`: `tier==='paid'→false` gate first; `AdRenderer.tsx` dispatches EmbedAdSlot/PlatformAdSlot/HouseAdSlot; `@capacitor-community/admob@^8.0.0` in package.json. Real fill deferred to Phase 70 (D-08). |
| 2 | Clinic / doctor-share / admin / dose-log / share / patient surfaces show zero ads; runtime guard + CI grep test prove it | VERIFIED | `EXCLUDED_SURFACES` frozen Set in canShowAds.ts (7 surfaces). `check-no-ads-on-excluded-surfaces.sh` + `.test.sh` (3-assertion self-test). Both gates wired in `.github/workflows/ci.yml` lines 47-56. |
| 3 | Frequency capping limits per-user-per-session-per-placement impressions to admin-configured ceiling | VERIFIED | `freqCap.ts`: `canShowNextImpression` module-level Map counter; `AdRenderer.tsx` calls it before dispatch (line 79). `freqCap.test.ts`: 41 tests across 3 files, all green per orchestrator gate. |
| 4 | Admin revenue dashboard shows eCPM / RPM / fill rate / CTR by placement + network | VERIFIED (infra) | `AdRevenueDashboardPage.tsx` calls `supabase.rpc('get_ad_revenue_dashboard')` on mount (lines 140-151), renders KPI strip + per-network breakdown table. Registered in `modules.ts` at `growth/ad-revenue`. RPC defined in migration 20280401000005 with `is_admin_at_least` guard. Live data deferred to Phase 70 (D-08). |
| 5 | Advertiser block-list excludes competing GLP-1 brands; CSP allowlist generated from this | VERIFIED | `cspGenerator.ts`: `filterBlocklisted` applied before `appendAdNetworkHosts`. `middleware.ts`: `fetchAdCspHosts` GETs `ad_csp_allowlist` + `ad_advertiser_blocklist` in parallel; result wired into CSP via `appendAdNetworkHosts`. Migration 20280401000002 creates `ad_advertiser_blocklist` table. 11 unit tests including SECURITY assertion that `wegovy.com` never survives into final CSP string. |
| 6 | HealthKit data structurally cannot reach ad-targeting (3-layer test green) | VERIFIED | Layer 1 (runtime): `assertNoHealthData` called in `initAdNetwork`, `showBannerAd`, `showInterstitialAd` (ads.ts lines 23, 38, 57). Layer 2 (test): `healthAssert.test.ts` 24 tests (19 Phase 55 + 5 AD-11 regression). Layer 3 (CI grep): `check-no-health-in-ad-context.sh` in ci.yml. |

**Score:** 6/6 truths verified

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases per D-08 contract.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Real AdSense/AdMob live fill (publisher approval) | Phase 70 | D-08 milestone contract: "real ad fill / on-device AdMob / live eCPM / publisher approval → Phase 70" |
| 2 | Live eCPM / RPM / fill rate / CTR data in revenue dashboard | Phase 70 | D-08: publisher approval prerequisite. Infrastructure (RPC + dashboard component) fully wired. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `leanshot/src/lib/ads/canShowAds.ts` | Surface+tier guard | VERIFIED | Substantive: frozen EXCLUDED_SURFACES Set, tier check first, 88 lines |
| `leanshot/src/lib/ads/freqCap.ts` | Session freq-cap | VERIFIED | Module-level Map counter, ceiling guard |
| `leanshot/src/lib/ads/placementRegistry.ts` | Placement contract + fetcher | VERIFIED | AdPlacementConfig interface, fail-safe fetchPlacements |
| `leanshot/src/lib/ads/adsense.ts` | Consent-gated AdSense injector | VERIFIED | Script idempotency guard, consent gate |
| `leanshot/src/lib/ads/cspGenerator.ts` | CSP pure functions | VERIFIED | filterBlocklisted + appendAdNetworkHosts |
| `leanshot/src/components/ads/AdRenderer.tsx` | 3-mode dispatch | VERIFIED | canShowAds gate + freqCap + switch on mode |
| `leanshot/src/components/ads/EmbedAdSlot.tsx` | Sandboxed iframe embed | VERIFIED | `sandbox='allow-same-origin'` |
| `leanshot/src/components/ads/PlatformAdSlot.tsx` | AdMob/AdSense platform slot | VERIFIED | placeholder div when publisher ID absent (correct pre-P70) |
| `leanshot/src/components/ads/HouseAdSlot.tsx` | House ad slot | VERIFIED | slug dispatch |
| `leanshot/src/lib/native/ads.ts` | AdMob init + healthAssert | VERIFIED | assertNoHealthData at every entry point |
| `leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx` | Revenue dashboard | VERIFIED | RPC call on mount, KPI strip, network table, empty/loading/error states |
| `leanshot/src/lib/admin/modules.ts` | Module manifest entry | VERIFIED | `growth-ad-revenue` at `growth/ad-revenue` route, lazy import |
| `leanshot/middleware.ts` | CSP middleware augmentation | VERIFIED | adCspCache + fetchAdCspHosts + appendAdNetworkHosts wired |
| `supabase/functions/ad-revenue-etl/index.ts` | Revenue ETL Edge Fn | VERIFIED | normalizeReportRow + raw_payload fallback + graceful 401/403 |
| `supabase/migrations/20280401000001_ad_placements.sql` | ad_placements table | VERIFIED | Exists, forward-dated |
| `supabase/migrations/20280401000002_ad_advertiser_blocklist.sql` | Blocklist table | VERIFIED | Exists, includes `wegovy.com` seed |
| `supabase/migrations/20280401000003_ad_revenue_facts.sql` | Revenue facts table | VERIFIED | Exists, upsert key on (network, placement_id, report_date) |
| `supabase/migrations/20280401000004_ad_network_config_add_serving.sql` | Network config ALTER | VERIFIED | Exists |
| `supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql` | Cron + RPC | VERIFIED | get_ad_revenue_dashboard SECDEF with is_admin_at_least guard |
| `leanshot/scripts/check-no-ads-on-excluded-surfaces.sh` | AD-03 CI grep gate | VERIFIED | Comment-stripped perl pattern, exit codes 0/1/2 |
| `leanshot/scripts/check-no-ads-on-excluded-surfaces.test.sh` | Gate self-test | VERIFIED | 3 assertions: clean/violation/comment-strip |
| `.github/workflows/ci.yml` | Both gates wired | VERIFIED | Lines 47-56: HEALTH-08 gate + AD-03 gate in `lint` job |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `AdRenderer.tsx` | `canShowAds.ts` | import + call line 73 | WIRED | `if (!canShowAds(surface, tier)) return null` |
| `AdRenderer.tsx` | `freqCap.ts` | import + call line 79 | WIRED | `if (!canShowNextImpression(...)) return null` |
| `AdRenderer.tsx` | EmbedAdSlot/PlatformAdSlot/HouseAdSlot | switch on `placement.mode` | WIRED | 3 case branches |
| `ads.ts` (native) | `healthAssert.ts` | import + call at each boundary | WIRED | initAdNetwork, showBannerAd, showInterstitialAd all call assertNoHealthData |
| `middleware.ts` | `cspGenerator.ts` | import appendAdNetworkHosts | WIRED | Called after adCspCache refresh (line 303-306) |
| `middleware.ts` | `ad_csp_allowlist` DB table | REST fetch in fetchAdCspHosts | WIRED | `${supabaseUrl}/rest/v1/ad_csp_allowlist?enabled=eq.true` |
| `AdRevenueDashboardPage.tsx` | `get_ad_revenue_dashboard` RPC | supabase.rpc call on mount | WIRED | Lines 140-151: setRows populated from real RPC result |
| `modules.ts` | `AdRevenueDashboardPage` | lazy import | WIRED | `import('@/components/admin/growth/AdRevenueDashboardPage')` |
| `ci.yml` | `check-no-ads-on-excluded-surfaces.sh` | bash run step | WIRED | Line 56: `run: bash scripts/check-no-ads-on-excluded-surfaces.sh src` |
| `ci.yml` | `check-no-health-in-ad-context.sh` | bash run step | WIRED | Line 48: `run: bash scripts/check-no-health-in-ad-context.sh src` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `AdRevenueDashboardPage.tsx` | `rows` (AdRevenueRow[]) | `supabase.rpc('get_ad_revenue_dashboard')` on mount | Yes — RPC queries `ad_revenue_facts` table via SECDEF fn | FLOWING (empty pre-P70; correct behavior) |
| `middleware.ts` adCspCache | `scriptHosts`, `connectHosts` | REST fetch of `ad_csp_allowlist` + `ad_advertiser_blocklist` tables | Yes — DB-driven, 60s TTL cache | FLOWING |

### Behavioral Spot-Checks

Orchestrator confirmed green before this verification (stated in `<already_run_gates>`):

| Behavior | Result | Status |
|----------|--------|--------|
| canShowAds/freqCap/placementRegistry vitest (41 tests) | 41/41 pass | PASS |
| adsense.test.ts + AdRenderer.test.tsx (15 tests) | 15/15 pass | PASS |
| cspGenerator.test.ts (11 tests) | 11/11 pass | PASS |
| AdRevenueDashboardPage.test.tsx (8 tests) | 8/8 pass | PASS |
| ad-revenue-etl deno test (7 tests) | 7/7 pass | PASS |
| AD-03 exclusion gate (clean-src + self-test) | 3/3 assertions pass | PASS |
| HEALTH-08 firewall gate (clean-src) | pass | PASS |
| healthAssert regression (24 tests) | 24/24 pass | PASS |
| app tsc --noEmit | 0 errors | PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared for this phase. Orchestrator-run gates serve as equivalent proof.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| AD-01 | AdMob iOS+Android via Capacitor plugin | VERIFIED | `@capacitor-community/admob@^8.0.0` in package.json; ads.ts with initAdNetwork (test mode) |
| AD-02 | AdSense web embed lazy-loaded after consent | VERIFIED | `adsense.ts` consent-gated injector; PlatformAdSlot dispatches to it |
| AD-03 | Excluded surfaces zero ads — runtime guard + CI grep (3-layer) | VERIFIED | EXCLUDED_SURFACES frozen Set + AdRenderer gate + CI grep gate + self-test |
| AD-04 | Three modes: embed-code / ad-platform / house-ads | VERIFIED | AdRenderer switch dispatches all three; EmbedAdSlot/PlatformAdSlot/HouseAdSlot all exist |
| AD-05 | Per-placement admin config in ad_placements table | VERIFIED | Migration 20280401000001; AdPlacementConfig interface; fetchPlacements fetcher |
| AD-06 | Revenue dashboard (eCPM/RPM/fill/CTR by placement + network) | VERIFIED | AdRevenueDashboardPage + get_ad_revenue_dashboard RPC + modules.ts entry |
| AD-07 | A/B testing across providers per placement | VERIFIED | `ab_variant` field in AdPlacementConfig; AdRenderer resolves via `window.posthog.getFeatureFlag` |
| AD-08 | Frequency capping per user per session per placement | VERIFIED | freqCap.ts module-level Map; AdRenderer gates on canShowNextImpression |
| AD-09 | Advertiser block-list + CSP allowlist generated from it | VERIFIED | cspGenerator.ts filterBlocklisted; middleware.ts fetchAdCspHosts; migration 20280401000002 |
| AD-10 | Tier-based gating: Pro/Lifetime zero ads | VERIFIED | canShowAds: `tier==='paid'→false` checked first |
| AD-11 | HealthKit data cannot reach ad-targeting (3-layer) | VERIFIED | assertNoHealthData at ads.ts entry points; healthAssert.test.ts 24 tests; CI grep gate |
| AD-12 | Per-network revenue ETL (daily Edge Fn + ad_revenue_facts) | VERIFIED | ad-revenue-etl Edge Fn; cron in migration 20280401000005; raw_payload fallback for pre-P70 empty reports |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `adsense.ts:24` | `ca-pub-XXXX` in comment | INFO | Publisher ID format example in JSDoc — NOT a debt marker. Standard notation for AdSense IDs. |
| `PlatformAdSlot.tsx` | Placeholder div "Ad slot — coming soon" when `VITE_ADSENSE_PUBLISHER_ID` is empty | INFO | Intentional per D-08. Real fill arrives Phase 70 with publisher approval. |
| `HouseAdSlot.tsx` | Unknown slugs render "LeanShot — coming soon" | INFO | Intentional — CMS/copy wired later. |
| `ads.ts` | `initializeForTesting: true` always | INFO | Intentional per D-08. `isTesting: false` arrives Phase 70. |

No TBD, FIXME, or XXX debt markers found in phase-created files. The `XXXX` string in `adsense.ts` is a publisher ID format placeholder in JSDoc (`ca-pub-XXXX`) — not a debt marker pattern. No BLOCKER anti-patterns.

### Human Verification Required

None. Per milestone contract D-08: `autonomous:true`, HUMAN-UAT empty. Items requiring live ad fill (real AdMob render, live eCPM data, on-device publisher approval) are explicitly deferred to Phase 70 by design. All automatable deliverables verified.

### Gaps Summary

No gaps. All 6 roadmap success criteria are verified at the infrastructure/code level. The two deferred items (live ad fill, live revenue data) are explicitly addressed by D-08 milestone contract and Phase 70 roadmap scope — they are not actionable gaps for Phase 56.

The two MUST-NEVER invariants are both proven:
1. **Surface-exclusion (AD-03):** 3-layer — frozen EXCLUDED_SURFACES Set (runtime) + AdRenderer gate (runtime) + CI grep gate (build-time) + self-test proving the gate is non-trivial.
2. **HealthKit firewall (AD-11):** 3-layer — assertNoHealthData at every ads.ts entry point (runtime) + healthAssert.test.ts 24 tests (unit) + check-no-health-in-ad-context.sh CI grep (build-time).

---

_Verified: 2026-05-25T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
