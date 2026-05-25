# Phase 56: Ad Network - Research

**Researched:** 2026-05-25
**Domain:** Ad serving (AdMob iOS/Android + AdSense web), surface exclusion guard, revenue ETL, admin dashboard
**Confidence:** HIGH (existing codebase fully inventoried; @capacitor-community/admob v8 confirmed on npm; patterns verified from Phase 33/55 migrations and source)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `@capacitor-community/admob` for mobile; AdSense via a `<script>`-injecting web component. Install `--legacy-peer-deps`.
- 3 config-driven modes per placement: **embed-code** (sandboxed raw advertiser snippet), **ad-platform** (AdMob/AdSense), **house-ads** (self-promo).
- Real ad fill + on-device AdMob → P70.
- Runtime `canShowAds(surface, tier)` guard + a CI grep test proving ad components NEVER reach clinic / doctor-share / admin / `/dose-log/*` / `/share/*` / `/patient/*` (mirror the Phase 55 firewall discipline: runtime + CI grep, ideally + an ESLint/structural check).
- Tier-gating reuses `billing.ts` — Pro/Lifetime → zero ads. Free tier → ads on allowed consumer surfaces only.
- Advertiser block-list defaults to competing GLP-1 brands; the CSP allowlist is GENERATED from the block-list (exclude blocked, allow approved networks). Keep CSP assembly in Edge Middleware (vercel.json doesn't interpolate env).
- Frequency cap: per-user-per-session-per-placement, admin-configured ceiling.
- Revenue ETL: EXTEND the Phase 33 ad-ETL with per-network REVENUE rows; close the unit-economics loop vs ad-spend.
- Admin revenue dashboard: NEW admin module reusing the `AdminMetrics*` pattern (eCPM / RPM / fill rate / CTR by placement + network) + admin manifest entry + catch-all router branch. is_staff RLS. No separate UI-SPEC.
- "Done" = serving components + 3 modes + `canShowAds` exclusion guard + CI test + tier-gate + freq-cap + GLP-1 block-list→CSP + per-network revenue ETL + admin dashboard + a test proving the HealthKit firewall is preserved against ad-serving code. Real ad fill / on-device AdMob / publisher approval → Phase 70.

### Claude's Discretion
- Plugin specifics, placement registry shape, freq-cap windows, CSP generator details, matview revenue columns, dashboard layout (within AdminMetrics DS).

### Deferred Ideas (OUT OF SCOPE)
- Real ad fill (AdMob/AdSense publisher approval), on-device AdMob rendering, live eCPM/RPM data → Phase 70 HUMAN-UAT.
- Meta Audience Network / additional networks → out of scope (AdMob + AdSense only this phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AD-01 | AdMob iOS + Android SDKs wired via Capacitor plugin; env vars set | @capacitor-community/admob v8.0.0 — peer: @capacitor/core ^8.0.0 (matches project ^8.3.4); init + banner + interstitial API documented below |
| AD-02 | AdSense for web embedded on free-tier marketing pages only; lazy-loaded after consent | consent-config.ts already has `marketing` category + `ad_storage` consent mode v2; script injection pattern documented below |
| AD-03 | Ad placements ENFORCED off on excluded surfaces — runtime guard + CI grep + optional ESLint | canShowAds guard design + CI grep pattern mirrors scripts/check-no-health-in-ad-context.sh |
| AD-04 | Three coexisting modes — embed-code / ad-platform / house-ads | Placement registry design (see Architecture Patterns) |
| AD-05 | Per-placement admin config in `ad_placements` table | New migration; extends ad_network_config pattern |
| AD-06 | Revenue dashboard in admin (eCPM / RPM / fill / CTR by placement + network) | AdminMetrics pattern; new admin module + ADMIN_MODULES entry |
| AD-07 | A/B testing across providers per placement | PostHog feature flag via existing ADMIN_MODULES flagKey pattern |
| AD-08 | Frequency capping per user per session per placement | Client-side session counter + admin-configured ceiling from ad_placements |
| AD-09 | Advertiser block-list defaults to GLP-1 brands; CSP allowlist generated from this | Block-list stored in new table; CSP generator extends middleware.ts appendFrameSrcHosts pattern |
| AD-10 | Tier-based gating: Pro/Lifetime = ZERO ads | billing.ts `getActiveTier()` + `TIER_GATE_REGISTRY['ad-free']` already defined |
| AD-11 | HealthKit data structurally cannot reach ad-targeting | Phase 55 3-layer firewall already in place; regression test needed |
| AD-12 | Per-network revenue ETL — daily Edge Fn → `ad_revenue_facts`; joined with ad_spend_facts | New table + migration + SECDEF RPC; cron schedule extends migration 11 pattern |
</phase_requirements>

---

## Summary

Phase 56 builds a three-mode ad system on top of a substantially complete Phase 33 ad-spend ETL and Phase 55 HealthKit firewall. The primary work is net-new: the client-side `canShowAds(surface, tier)` runtime guard, a placement registry + renderer (3 modes), AdMob/AdSense initialization stubs, frequency capping, a GLP-1 block-list→CSP generator, a new `ad_revenue_facts` table + ETL Edge Fn, and an admin revenue dashboard module.

**What Phase 33 already ships (EXTEND, do NOT rebuild):** `ad_spend_facts` (partitioned), `ad_network_config` (meta/google/tiktok attribution windows), `ad_revenue_normalized` matview (SPEND-side only — joins spend_facts with conversions for CAC, NOT revenue inflow), `rls_deny_ad_tables` (admin-only RLS), `ad_etl_cron_schedules` (hourly spend ETL + matview refresh), `trigger_ad_etl_backfill_secdef`, `fx_rates`, `ad_etl_health`, `ad_etl_gaps`, `growth_targets`, `cac_alerts`. The existing matview is a **CAC/spend-side view** — it does NOT contain network revenue (eCPM/impressions/fill data). Phase 56 must add the revenue side.

**The critical data gap:** There is NO `ad_revenue_facts` table. The existing `ad_revenue_normalized` matview confusingly named — it normalizes SPEND to compute CAC, not revenue inflow. Phase 56 must create `ad_revenue_facts` (per-network revenue rows: impressions, clicks, fill_rate, estimated_revenue_usd, ecpm, rpm) and extend/replace the matview or add a new revenue matview.

**Primary recommendation:** Ship `canShowAds` + placement registry + 3-mode renderer + billing tier gate in Wave 0; extend Phase 33 ETL with `ad_revenue_facts` + cron + admin dashboard in Wave 1; wire AdMob init stub + AdSense script injector (non-live) in Wave 2; CSP generator + CI grep gate in Wave 3.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ad placement rendering (web) | Browser / Client | — | AdSense script injection and ad slot rendering are browser-side; no SSR |
| Ad placement rendering (mobile) | Browser / Client (Capacitor) | — | AdMob plugin bridges native SDK via Capacitor; no backend involved |
| canShowAds surface + tier guard | Browser / Client | — | Guard runs before rendering; pure function over surface string + tier from Zustand |
| Frequency cap enforcement | Browser / Client | API / Backend | Session-local counter (fast path) with admin ceiling from ad_placements table |
| GLP-1 block-list storage + CSP generation | API / Backend | CDN / Static | Block-list in DB; CSP generated at request time in Edge Middleware |
| Revenue ETL (ad_revenue_facts) | API / Backend | Database / Storage | Daily cron Edge Fn pulls from AdMob/AdSense APIs; writes to Supabase |
| Admin revenue dashboard | Browser / Client | API / Backend | React admin module reads via SECDEF RPC; server enforces is_staff() |
| HealthKit firewall regression | Browser / Client | CI | 3-layer: ESLint + runtime + CI grep — existing + new regression test |
| Consent gate for AdSense | Browser / Client | — | consent-config.ts `marketing` category already wires `ad_storage` Consent Mode v2 |

---

## Existing Codebase Inventory (AUTHORITATIVE — Phase 56 EXTENDS these)

### 1. `src/lib/native/ads.ts` — CURRENT STATE

**File:** `/Users/karstenhaldan/minisite/leanshot/src/lib/native/ads.ts`
**Status:** Phase 12 stub — Phase 56 REPLACES the body (NOT the import structure)

Key facts:
- Already imports `assertNoHealthData` from `./healthAssert` (Phase 55 Layer 2 boundary guard)
- Exports `AdPlacement` union: `'marketing-sidebar' | 'free-tier-banner' | 'interstitial'`
- `initAdNetwork()` throws with "Phase 12 stub — implemented by Phase 20 via @capacitor-community/admob + GPT"
- The stub already calls `assertNoHealthData({}, 'initAdNetwork')` — demonstrating the guard pattern
- Comment explicitly tells Phase 56: "call assertNoHealthData(targetingParams, 'buildAdParams') on any user-data object before passing to ad network SDK"

**Phase 56 action:** Replace `initAdNetwork()` body with real implementation; extend the `AdPlacement` union; add `canShowAds()`, placement registry types, and serving functions. Keep `assertNoHealthData` import and calls.

### 2. `src/lib/native/platform.ts` — UNCHANGED

**File:** `/Users/karstenhaldan/minisite/leanshot/src/lib/native/platform.ts`
**Exports:** `detectPlatform(): Platform` — returns `'web' | 'ios' | 'android' | 'capacitor-web'`
**Usage in Phase 56:** Drive mobile vs web branch in ad serving (AdMob on ios/android; AdSense on web)

### 3. `src/lib/billing.ts` — ALREADY PREPARED FOR PHASE 56

**File:** `/Users/karstenhaldan/minisite/leanshot/src/lib/billing.ts`
- `getActiveTier(stripeStatus, currentPeriodEnd, now): Tier` — returns `'free' | 'paid' | 'past_due'`
- `TIER_GATE_REGISTRY['ad-free'] = 'hard-block-no-ui'` — already registered, no consumer yet
- `TierGate` component (`src/components/billing/TierGate.tsx`) reads `useStore((s) => s.tier)`
- **Tier mapping for ads:** `tier === 'paid'` → zero ads; `tier === 'free' | 'past_due'` → ads on allowed surfaces

**Phase 56 `canShowAds(surface, tier)` design:**
```typescript
// src/lib/ads/canShowAds.ts
export function canShowAds(surface: AdSurface, tier: Tier): boolean {
  // Tier gate — paid users see zero ads (billing.ts TIER_GATE_REGISTRY['ad-free'])
  if (tier === 'paid') return false;
  // Surface exclusion — MUST-NEVER surfaces get hard false regardless of tier
  return !EXCLUDED_SURFACES.has(surface);
}

const EXCLUDED_SURFACES = new Set<AdSurface>([
  'clinic', 'clinic-settings', 'clinic-drill-in',
  'doctor-share',   // #/share/* hash route
  'admin',          // all /admin/* routes
  'dose-log',       // /dose-log/* path
  'patient',        // /patient/* path
]);
```

### 4. Phase 33 Ad ETL — WHAT EXISTS (EXTEND)

**Tables shipped:**

| Table | Schema Highlights | Phase 56 Action |
|-------|-------------------|-----------------|
| `ad_spend_facts` | Partitioned RANGE(spend_date); network IN ('meta','google','tiktok'); spend_local, spend_usd, clicks, impressions, conversions | Read-only; Phase 56 does NOT modify |
| `ad_network_config` | network PK, default_attribution_window_seconds, default_attribution_model | Extend: add AdMob + AdSense network rows |
| `ad_revenue_normalized` | **MATVIEW — SPEND/CAC side only.** Joins ad_spend_facts + events_mirror on payment_completed. Returns: network, spend_usd, clicks, impressions, attributed_conversions, cac_usd | Does NOT contain revenue inflow — this is a spending matview misnamed "revenue_normalized" |
| `rls_deny_ad_tables` | All 7 Phase 33 tables: admin-only via `is_admin_at_least('admin')` | Phase 56 new tables get same policy |
| `fx_rates`, `ad_etl_health`, `ad_etl_gaps`, `growth_targets`, `cac_alerts` | Supporting ETL tables | No changes needed |

**Cron schedules (migration 11):**
- Hourly: `ad_spend_cron_meta` (:05), `ad_spend_cron_google` (:06), `ad_spend_cron_tiktok` (:07)
- Hourly: `ad_revenue_refresh` (:10) — refreshes `ad_revenue_normalized` matview
- Daily: `fx_rates_ecb` (17:00), `ad_etl_gap_detect` (05:00), `cac_alert_cron` (00:30)
- **Phase 56 adds:** `ad_revenue_etl_cron` (daily ~03:00 UTC) calling new `ad-revenue-etl` Edge Fn

**SECDEF functions:** `refresh_ad_revenue_normalized()`, `run_ad_etl_gap_detection()`, `trigger_ad_etl_backfill(...)`, `get_cac_summary(...)`. Phase 56 adds `get_ad_revenue_dashboard(...)`.

### 5. Phase 55 Firewall — THREE LAYERS (PRESERVE + EXTEND)

**Layer 1 — ESLint AST:** `leanshot/eslint-rules/no-health-in-ad-context.cjs`
- Blocks: files under `/ads?/`, `/marketing/`, `/analytics/`, `/affiliate/` OR `*.ad-eligible.ts` from importing `native/health`
- **Phase 56 new ad files** will be under `src/lib/ads/` or `src/components/ads/` — these directories match `FORBIDDEN_IMPORTERS` regex and will be covered automatically

**Layer 2 — Runtime:** `src/lib/native/healthAssert.ts`
- `assertNoHealthData(value, ctx?)` — throws in both dev AND prod if value has health-shaped keys (`bodyMass`, `weight`, `steps`, etc.)
- `ads.ts` already calls it; Phase 56 serving functions MUST call it on any user-data object passed to ad SDKs

**Layer 3 — CI grep:** `scripts/check-no-health-in-ad-context.sh`
- Comment-stripped grep on `*/ads/*`, `*/ad/*`, `*/marketing/*`, `*/analytics/*`, `*/affiliate/*` files
- Checks for `native/health` import
- Phase 56 regression test: run this script and assert exit 0 after ad-serving files are added

### 6. Admin Module Pattern — How to Register a New Module

**Manifest:** `src/lib/admin/modules.ts` — `ADMIN_MODULES` array (currently 31 entries)
**Pattern for new entry:**
```typescript
{
  key: 'ad-revenue',
  label: 'Ad Revenue',
  route: 'growth/ad-revenue',   // → /admin/growth/ad-revenue
  icon: TrendingUpIcon,         // reuse existing import
  lazy: () => import('@/components/admin/growth/AdRevenueDashboardPage').then(m => ({ default: m.AdRevenueDashboardPage })),
  flagKey: 'admin.growth.ad_revenue.enabled',
  minRole: 'admin' as AdminRole,
}
```
**Routing:** `AdminShell.tsx` uses URL-prefix routing (`pathname.startsWith('/admin/growth/ad-revenue/')`). Adding the manifest entry is sufficient — no hardcoded switch branch per `feedback_admin_module_manifest_vs_router_branch_drift`.

**AdminMetrics component pattern:**
- `AdminMetricsKpiStrip.tsx` — 4 `<Card span={3}>` tiles with useCountUp animation
- `AdminMetricsMrrChart.tsx` — BaseChart line+bar combo
- Revenue dashboard tiles: eCPM / RPM / fill rate / CTR (same 4-tile pattern); grouped by network+placement

### 7. Surface/Route Model — canShowAds Surface Enumeration

The app has two routing systems:
- **Consumer (Zustand TabId):** `'home' | 'medication' | 'symptoms' | 'body' | 'nutrition' | 'activity' | 'supplements' | 'mood' | 'insights' | 'community' | 'classroom' | 'events'`
- **Path-based (App.tsx View type):** `'share' | 'clinic' | 'clinic-settings' | 'clinic-drill-in' | 'clinic-invite' | 'admin-*' | 'doctor-share'` (hash `#/share/`)

**Excluded surfaces for ads (AD-03):**

| Surface | How Identified | Reason |
|---------|----------------|--------|
| clinic | View = 'clinic' \| 'clinic-settings' \| 'clinic-drill-in' | B2B clinical surface |
| doctor-share | hash starts `#/share/` → View = 'share' | Read-share for doctors |
| admin | pathname starts `/admin/` | Staff-only surface |
| dose-log | TabId = 'medication' OR pathname `/dose-log/*` | PHI context |
| patient | View = 'clinic-drill-in' (`/clinic/{slug}/patient/{uid}`) | PHI context |
| share | hash `#/share/` (same as doctor-share) | Anonymous read share |

**Allowed surfaces for ads (free tier):**
Consumer dashboard tabs except medication: `'home' | 'body' | 'nutrition' | 'activity' | 'supplements' | 'mood' | 'insights' | 'community' | 'classroom' | 'events'` + marketing/onboarding surfaces

### 8. CSP / Edge Middleware — How to Add Ad Network allowlist

**Current CSP (vercel.json static):**
```
script-src 'self' https://js.stripe.com https://assets.calendly.com ... ;
connect-src 'self' https://*.supabase.co ... ;
frame-src 'self' https://js.stripe.com ... ;
```

**Current middleware.ts augmentation:** `appendFrameSrcHosts()` dynamically appends `iframe_allowlist` hostnames to `frame-src` directive at request time.

**Phase 56 CSP extension pattern:**
1. Store GLP-1 block-list (competing brand domains) in `ad_advertiser_blocklist` table
2. Store approved ad network domains in same or separate `ad_csp_allowlist` table
3. Add a new middleware augmentation (parallel to iframe_allowlist fetch) that:
   - Fetches approved ad network hosts (60s cache)
   - Appends to `script-src` (AdSense `https://pagead2.googlesyndication.com`) and `connect-src`
   - Excludes any domain on the block-list
4. In-memory cache at 60s (same pattern as existing)
5. Block-list enforcement: if a hostname is in `ad_advertiser_blocklist`, it NEVER appears in CSP allowlist

**Default GLP-1 block-list entries (admin-editable):**
```
wegovy.com, ozempic.com, mounjaro.com, trulicity.com, saxenda.com, victoza.com, rybelsus.com
```

### 9. Consent Gate for AdSense

**Existing `consent-config.ts`** already configures:
- `marketing` category → `ad_storage: 'granted'` when accepted
- `ad_user_data: 'granted'` and `ad_personalization: 'granted'` when marketing accepted
- `CONSENT_CHANGE_EVENT` custom event (`leanshot:consent-change`)

**Phase 56 AdSense loading pattern:**
```typescript
// Wait for marketing consent before injecting adsbygoogle script
window.addEventListener('leanshot:consent-change', (e: CustomEvent<ConsentChangeDetail>) => {
  if (e.detail.categories.marketing && !document.getElementById('adsense-script')) {
    const s = document.createElement('script');
    s.id = 'adsense-script';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
    s.async = true;
    s.dataset.adClient = import.meta.env.VITE_ADSENSE_PUBLISHER_ID;
    document.head.appendChild(s);
  }
});
```

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@capacitor-community/admob` | 8.0.0 | AdMob iOS + Android native SDK bridge | Official Capacitor Community plugin; peer `@capacitor/core ^8.0.0` matches project `^8.3.4`; MIT; published 2020 (5yr history); active maintenance |
| `@capacitor/core` | ^8.3.4 (already installed) | Plugin bridge | Already in project |
| AdSense `adsbygoogle.js` | CDN (no npm package) | Web ad serving | Standard Google AdSense web integration; loaded dynamically after consent |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vanilla-cookieconsent` | Already installed | Consent gate trigger | `leanshot:consent-change` event already fires when marketing category changes |
| Vitest | Already installed | Unit tests for canShowAds, freq-cap, CSP generator | All new logic |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@capacitor-community/admob` | `Cap-go/capacitor-admob` | Alternative fork; less established; CONTEXT locked to capacitor-community |

**Installation:**
```bash
npm install --legacy-peer-deps @capacitor-community/admob
npx cap sync
```

**NOTE:** `vercel.json` already has `"installCommand": "npm install --legacy-peer-deps --update-sentry-capacitor"` — the `--legacy-peer-deps` flag is already in production install. Adding `@capacitor-community/admob` should not require any additional flag changes.

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All packages tagged [ASSUMED] for registry provenance; planner should verify before install.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@capacitor-community/admob` | npm | ~5 years (2020) | Established (capacitor community org) | github.com/capacitor-community/admob | [ASSUMED] | Provisionally approved — planner must checkpoint `npm view @capacitor-community/admob` before install; no postinstall script found |
| AdSense `adsbygoogle.js` | CDN (not npm) | 15+ years | Ubiquitous | Google | N/A — CDN, not npm package | Approved — standard Google product |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none detected

**Note on `@capacitor-community/admob` v8.0.0:** npm confirms `peerDependencies: { "@capacitor/core": "^8.0.0" }` — exact match to project's `@capacitor/core ^8.3.4`. The package was published 4 months ago (matches v8.0.0 release). Source: `npm view @capacitor-community/admob` confirmed in this session. [VERIFIED: npm registry] for version and peer dep; publisher legitimacy [ASSUMED] (slopcheck unavailable but package has 5+ year history under official capacitor-community GitHub org).

---

## Architecture Patterns

### System Architecture Diagram

```
User Request
     │
     ▼
App.tsx selectView()
     │
     ├─► View is excluded surface (clinic / share / admin / patient)?
     │        └─► canShowAds() returns false ─► No AdRenderer rendered
     │
     ├─► View is consumer dashboard?
     │        │
     │        ▼
     │   canShowAds(surface, tier)
     │        │
     │        ├─► tier === 'paid' ─► false ─► No AdRenderer
     │        └─► tier === 'free' ─► true ─► AdRenderer rendered
     │                                              │
     │                                    PlacementRegistry.get(placementId)
     │                                              │
     │                                    ┌─────────┴──────────┐
     │                                    │                    │
     │                               freqCap check        canShowAds OK?
     │                               (session counter         │
     │                                vs admin ceiling)   mode = embed|platform|house
     │                                    │                    │
     │                              over cap?            ┌─────┼─────┐
     │                              └─► skip             │     │     │
     │                                             embed  platf  house
     │                                             (iframe) (AdMob/  (self-
     │                                                      AdSense)  promo)
     │
     ├─► Ad CSP allowlist (Edge Middleware)
     │        │ fetch ad_csp_allowlist (60s cache)
     │        │ exclude ad_advertiser_blocklist (GLP-1 brands)
     │        └─► append to script-src + connect-src
     │
     └─► Revenue ETL (daily cron)
              │ ad-revenue-etl Edge Fn
              │ pulls AdMob + AdSense reports
              └─► INSERT INTO ad_revenue_facts
                       │
                       ▼
                  Admin Revenue Dashboard
                  (get_ad_revenue_dashboard SECDEF RPC)
                  eCPM / RPM / fill / CTR by placement+network
```

### Recommended Project Structure

```
src/
├── lib/ads/
│   ├── canShowAds.ts         # Pure guard function — MUST NOT import health
│   ├── placementRegistry.ts  # ad_placements config fetcher + type definitions
│   ├── freqCap.ts            # Session-local counter + admin ceiling check
│   └── adsense.ts            # AdSense script injector (consent-gated)
├── components/ads/
│   ├── AdRenderer.tsx        # Dispatches to embed/platform/house sub-renderers
│   ├── EmbedAdSlot.tsx       # Mode A: sandboxed iframe advertiser snippet
│   ├── PlatformAdSlot.tsx    # Mode B: AdMob (native) / AdSense slot (web)
│   └── HouseAdSlot.tsx       # Mode C: self-promo cross-sell
├── components/admin/growth/
│   └── AdRevenueDashboardPage.tsx  # New admin module
supabase/
├── functions/
│   └── ad-revenue-etl/       # New Edge Fn: daily revenue pull from AdMob/AdSense
├── migrations/
│   └── 20270802000001_ad_placements.sql          # placement registry table
│   └── 20270802000002_ad_advertiser_blocklist.sql # GLP-1 block-list table
│   └── 20270802000003_ad_revenue_facts.sql        # revenue facts table
│   └── 20270802000004_ad_revenue_etl_cron.sql     # daily cron + SECDEF RPCs
│   └── 20270802000005_rls_new_ad_tables.sql       # admin-only RLS
scripts/
└── check-no-ads-on-excluded-surfaces.sh  # New CI grep: ad components never reach excluded surfaces
```

### Pattern 1: canShowAds — Surface + Tier Guard

**What:** Pure function; call site is the `AdRenderer` component before any ad logic runs
**When to use:** Every location where ad placement is considered for rendering

```typescript
// Source: Phase 56 design, mirrors healthAssert.ts assertNoHealthData pattern
// src/lib/ads/canShowAds.ts
import type { Tier } from '@/types';

export type AdSurface =
  | 'home' | 'body' | 'nutrition' | 'activity' | 'supplements'
  | 'mood' | 'insights' | 'community' | 'classroom' | 'events'
  | 'marketing' | 'onboarding'
  | 'clinic' | 'clinic-settings' | 'clinic-drill-in'
  | 'share' | 'admin' | 'dose-log' | 'patient';

// MUST-NEVER set — hardcoded, not config-driven
const EXCLUDED_SURFACES = new Set<AdSurface>([
  'clinic', 'clinic-settings', 'clinic-drill-in',
  'share',   // covers #/share/* (doctor-share)
  'admin',   // covers all /admin/* paths
  'dose-log',
  'patient',
]);

export function canShowAds(surface: AdSurface, tier: Tier): boolean {
  if (tier === 'paid') return false;   // Pro/Lifetime = zero ads
  return !EXCLUDED_SURFACES.has(surface);
}
```

### Pattern 2: AdMob Initialization (Mobile)

**What:** Initialize AdMob on iOS/Android; NON-live in Phase 56 (publisher IDs pending)

```typescript
// Source: @capacitor-community/admob v8.0.0 API — [VERIFIED: npm registry]
// src/lib/native/ads.ts (replace initAdNetwork stub)
import { AdMob } from '@capacitor-community/admob';
import { assertNoHealthData } from './healthAssert';

export async function initAdNetwork(): Promise<void> {
  // HEALTH-08 Layer 2: verify no health data in targeting params
  assertNoHealthData({}, 'initAdNetwork');
  await AdMob.initialize({
    requestTrackingAuthorization: true,  // iOS ATT prompt
    testingDevices: [],                  // Add device IDs for testing
    initializeForTesting: true,          // Phase 56: testing mode — real IDs arrive P70
  });
}

export async function showBannerAd(adUnitId: string): Promise<void> {
  assertNoHealthData({ adUnitId }, 'showBannerAd');  // boundary check
  await AdMob.showBanner({
    adId: adUnitId,
    adSize: 'BANNER',
    position: 'BOTTOM_CENTER',
    margin: 0,
    isTesting: true,  // Phase 56: testing mode
  });
}

export async function showInterstitialAd(adUnitId: string): Promise<void> {
  assertNoHealthData({ adUnitId }, 'showInterstitialAd');
  await AdMob.prepareInterstitial({ adId: adUnitId, isTesting: true });
  await AdMob.showInterstitial();
}
```

### Pattern 3: Frequency Cap (Session-local + Admin Ceiling)

**What:** Per-user-per-session-per-placement counter; ceiling from admin-configured `ad_placements.freq_cap_per_session`

```typescript
// src/lib/ads/freqCap.ts
// Session Map resets on page reload — no localStorage (no cross-session leak)
const sessionCounts = new Map<string, number>();

export function canShowNextImpression(
  placementId: string,
  sessionCeiling: number,   // from ad_placements.freq_cap_per_session
): boolean {
  const key = placementId;
  const count = sessionCounts.get(key) ?? 0;
  if (count >= sessionCeiling) return false;
  sessionCounts.set(key, count + 1);
  return true;
}

export function resetSessionCounts(): void {
  sessionCounts.clear();
}
```

### Pattern 4: Revenue Facts Table (NEW — closes the ETL loop)

The existing matview `ad_revenue_normalized` is **spending-side** (computes CAC from spend + conversions). Phase 56 adds a REVENUE-side facts table sourced from network reporting APIs:

```sql
-- supabase/migrations/20270802000003_ad_revenue_facts.sql
create table if not exists public.ad_revenue_facts (
  id                    uuid          not null default gen_random_uuid() primary key,
  network               text          not null check (network in ('admob', 'adsense')),
  placement_id          uuid,         -- FK to ad_placements
  report_date           date          not null,
  impressions           bigint        not null default 0,
  clicks                bigint        not null default 0,
  fill_rate             numeric(5,4), -- 0.0000–1.0000
  estimated_revenue_usd numeric(12,6) not null default 0,
  ecpm_usd              numeric(12,6),  -- (revenue/impressions)*1000
  rpm_usd               numeric(12,6),  -- revenue per 1000 page views
  raw_payload           jsonb,          -- full API response for audit
  etl_run_at            timestamptz   not null default now(),
  constraint ad_revenue_facts_uq unique (network, placement_id, report_date)
);

-- Same admin-only RLS as Phase 33 tables
alter table public.ad_revenue_facts enable row level security;
create policy "ad_revenue_facts_admin_all"
  on public.ad_revenue_facts for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));
```

**ETL cron:** Add to the Phase 33 cron migration pattern (vault bearer, hardcoded project URL):
```sql
select cron.schedule(
  'ad_revenue_etl_cron',
  '0 3 * * *',  -- daily 03:00 UTC (after network report APIs refresh)
  $$SELECT net.http_post(
    url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ad-revenue-etl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );$$
);
```

**SECDEF revenue dashboard RPC:**
```sql
create or replace function public.get_ad_revenue_dashboard(
  p_start_date date default null,
  p_end_date   date default null
)
returns table (
  network text, report_date date, impressions bigint, clicks bigint,
  fill_rate numeric, estimated_revenue_usd numeric, ecpm_usd numeric, rpm_usd numeric
)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query select ...;
end;
$$;
```

### Pattern 5: CI Grep Gate for Ad Surface Exclusion

Mirror `check-no-health-in-ad-context.sh` — a comment-stripped grep that proves ad component imports NEVER appear in excluded surface files.

```bash
# scripts/check-no-ads-on-excluded-surfaces.sh
# Fail if any clinic/share/admin/dose-log/patient surface file imports AdRenderer
EXCLUDED_DIRS=("clinic" "share" "admin")
EXCLUDED_PATTERNS="AdRenderer|AdSlot|canShowAds"
# grep comment-stripped sources, exit 1 if any match found in excluded dirs
```

Additionally, a CI grep confirming `canShowAds` is never bypassed — any file importing from `*/ads/` that does NOT call `canShowAds` should fail.

### Anti-Patterns to Avoid

- **Placing ad logic in excluded surface files:** AdRenderer MUST only render within components that call `canShowAds` first. Never import AdRenderer directly in clinic/share/admin components.
- **Checking tier from ad component itself:** `canShowAds(surface, tier)` is the single entry point; ad sub-components trust the parent's decision, don't re-read tier.
- **Using window.localStorage for freq cap:** Session-scoped Map resets on page reload; localStorage would persist across sessions and violate "per-session" spec.
- **Hardcoding AdMob app IDs in source:** Use `import.meta.env.VITE_ADMOB_APP_ID_IOS` / `VITE_ADMOB_APP_ID_ANDROID` from vercel env.
- **Using `vercel.json` `headers` for dynamic CSP values:** Already established pattern — dynamic CSP values (ad network hosts) must go through `middleware.ts` at request time.
- **Importing health.ts in any file under `src/lib/ads/` or `src/components/ads/`:** ESLint rule `no-health-in-ad-context.cjs` FORBIDDEN_IMPORTERS regex `/(ads?|marketing|analytics|affiliate)/` covers these dirs automatically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AdMob native SDK bridge | Custom Capacitor plugin | `@capacitor-community/admob` v8.0.0 | Handles iOS ATT, Android consent API, banner/interstitial lifecycle |
| Consent mode v2 for AdSense | Custom gtag wrapper | Existing `consent-config.ts` with `ad_storage` Consent Mode v2 already wired | Already ships; `leanshot:consent-change` event fires on accept/reject |
| CSP header assembly | Custom header middleware | Extend existing `middleware.ts` | Append to existing `script-src`/`connect-src` using `appendFrameSrcHosts` pattern |
| Admin module routing | Hardcoded switch branches | ADMIN_MODULES manifest + catch-all router (per drift feedback) | Established pattern; manifest entry + URL-prefix routing is sufficient |
| Revenue ETL cursor tracking | Custom cursor table | `etl_cursors` table already exists in Phase 33 (can add `admob-revenue`, `adsense-revenue` rows) | Already has RLS + admin policy |
| HealthKit firewall enforcement | Per-file manual checks | Existing 3-layer system (ESLint + assertNoHealthData + CI grep) | Already covers `src/lib/ads/` and `src/components/ads/` directories |

---

## Common Pitfalls

### Pitfall 1: Confusing `ad_revenue_normalized` with a Revenue Facts Table
**What goes wrong:** Planner reads "ad_revenue_normalized" and assumes revenue ETL is done; it's actually a spend/CAC matview.
**Why it happens:** The name "revenue_normalized" refers to spend normalized across attribution windows, not revenue inflow.
**How to avoid:** Phase 56 MUST create `ad_revenue_facts` (new table). The matview stays for CAC dashboard; the new table serves the revenue dashboard.
**Warning signs:** If a plan references `ad_revenue_normalized` as the source for eCPM/RPM metrics, it's wrong.

### Pitfall 2: ad_network_config Only Has 'meta', 'google', 'tiktok'
**What goes wrong:** Phase 56 tries to insert AdMob/AdSense rows into `ad_network_config` with a CHECK constraint violation.
**Why it happens:** `ad_network_config` has `CHECK (network IN ('meta', 'google', 'tiktok'))`.
**How to avoid:** Either (a) alter the check constraint to add 'admob', 'adsense', or (b) create a separate `ad_serving_networks` table for the serving side. Recommended: ALTER the constraint. Migration MUST use idempotent `DO $$ IF NOT EXISTS $$` pattern.
**Warning signs:** Any plan that inserts ('admob',...) into ad_network_config without altering the constraint.

### Pitfall 3: AdMob Plugin Peer Dependency Conflict
**What goes wrong:** `npm install @capacitor-community/admob` fails due to peer dep conflict with `@sentry/capacitor`.
**Why it happens:** `@sentry/capacitor` has a documented npm install blocker (`reference_sentry_capacitor_npm_install_blocker`). The project already works around this with `--legacy-peer-deps`.
**How to avoid:** Always install with `--legacy-peer-deps`. `vercel.json` `installCommand` already includes this flag.
**Warning signs:** CI build failing on npm install step after admob is added.

### Pitfall 4: Vitest 4.x projects-config masks default tests
**What goes wrong:** `npm test` collects 0 tests for new ad-serving unit tests.
**Why it happens:** `vitest.config.ts` has a `projects:` block that masks the default `test:` config (`reference_vitest_4_projects_config_masks_default`).
**How to avoid:** Run tests with `npx vitest run --config vite.config.ts` for src/ unit tests, or verify via `npx vitest run src/lib/ads/canShowAds.test.ts`.
**Warning signs:** Test run reports 0 tests collected despite .test.ts files existing.

### Pitfall 5: Supabase Dollar-Quote Nesting in New Cron
**What goes wrong:** New cron schedule migration fails with "syntax error at or near DECLARE".
**Why it happens:** `DO $$...$$` inside `cron.schedule(..., $$...$$)` closes the outer `$$` on the first inner `$$`.
**How to avoid:** Use named dollar-quote tags: `$cron$...$body$`. See `reference_postgres_dollar_quote_nesting_in_cron_body`. Phase 33 migration 11 correctly uses the `$$SELECT net.http_post(...)$$` pattern (no inner `$$`) which is safe.
**Warning signs:** Migration push fails on any new cron that contains a `DO` block.

### Pitfall 6: `npm run lint` is RED Project-Wide
**What goes wrong:** CI lint step fails on pre-existing eslint errors unrelated to Phase 56.
**Why it happens:** Known pre-existing lint debt (CONTEXT.md: "npm run lint is RED project-wide").
**How to avoid:** Gate CI on `tsc --noEmit` + targeted per-file eslint for new Phase 56 files + specific rule test for `no-health-in-ad-context`. Do NOT use `npm run lint` as the Phase 56 CI gate.

### Pitfall 7: manifest↔router Drift for New Admin Module
**What goes wrong:** New admin module appears in nav but clicking it renders NotFoundCard.
**Why it happens:** `AdminShell.tsx` uses URL-prefix matching (`pathname.startsWith('/admin/growth/ad-revenue/')`) against the `route` field in `ADMIN_MODULES`. If the route is `'ad-revenue'` (not `'growth/ad-revenue'`) it won't match the nested URL.
**How to avoid:** Set `route: 'growth/ad-revenue'` to match the `/admin/growth/ad-revenue` URL path. AdminShell.tsx does NOT need a hardcoded switch case — the prefix match is generic per `feedback_admin_module_manifest_vs_router_branch_drift`.
**Warning signs:** Admin nav shows new module but clicking it shows NotAuthorizedCard or default page.

---

## Code Examples

### @capacitor-community/admob v8 — Initialize
```typescript
// Source: [VERIFIED: npm registry] github.com/capacitor-community/admob
import { AdMob } from '@capacitor-community/admob';

await AdMob.initialize({
  requestTrackingAuthorization: true,  // iOS ATT (IDFA)
  testingDevices: ['EMULATOR'],
  initializeForTesting: true,          // use test IDs; set false at P70
});
```

### @capacitor-community/admob v8 — Banner Ad
```typescript
// Source: [VERIFIED: npm registry] github.com/capacitor-community/admob
import { AdMob, BannerAdPosition } from '@capacitor-community/admob';

await AdMob.showBanner({
  adId: 'ca-app-pub-xxx/yyy',   // from VITE_ADMOB_BANNER_ID_IOS or ANDROID
  adSize: 'BANNER',
  position: BannerAdPosition.BOTTOM_CENTER,
  margin: 0,
  isTesting: true,
});
```

### @capacitor-community/admob v8 — Interstitial Ad
```typescript
// Source: [VERIFIED: npm registry] github.com/capacitor-community/admob
await AdMob.prepareInterstitial({
  adId: 'ca-app-pub-xxx/zzz',
  isTesting: true,
});
await AdMob.showInterstitial();
```

### AdSense Web — Consent-Gated Script Injection
```typescript
// Source: [ASSUMED] Google AdSense standard pattern + consent-config.ts integration
// In AdRenderer or adsense.ts — inject script only after marketing consent
function injectAdSenseScript(publisherId: string): void {
  if (document.getElementById('adsense-script')) return;  // idempotent
  const s = document.createElement('script');
  s.id = 'adsense-script';
  s.async = true;
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
  s.dataset.adClient = publisherId;
  // CSP must allow pagead2.googlesyndication.com in script-src (via middleware)
  document.head.appendChild(s);
}
```

### Admin Module Registration Pattern
```typescript
// Source: [VERIFIED: codebase] src/lib/admin/modules.ts lines 90-572
{
  key: 'ad-revenue',
  label: 'Ad Revenue',
  route: 'growth/ad-revenue',
  icon: TrendingUpIcon,    // already imported
  lazy: () => import('@/components/admin/growth/AdRevenueDashboardPage')
    .then(m => ({ default: m.AdRevenueDashboardPage })),
  flagKey: 'admin.growth.ad_revenue.enabled',
  minRole: 'admin' as AdminRole,
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate `ads.ts` stub throws on call | Real AdMob init + serving (Phase 56) | Phase 56 | `initAdNetwork()` becomes real implementation |
| No revenue facts table | `ad_revenue_facts` (Phase 56) | Phase 56 | eCPM/RPM/fill metrics can be stored and queried |
| No placement registry | `ad_placements` table (Phase 56) | Phase 56 | Per-placement admin config (size/network/freq_cap/mode) |
| `ad_network_config` only has meta/google/tiktok | Extended to include admob/adsense (Phase 56) | Phase 56 | CHECK constraint must be altered |
| No surface exclusion guard in code | `canShowAds(surface, tier)` (Phase 56) | Phase 56 | Compilable proof of exclusion + CI grep |

**Deprecated/outdated:**
- `initAdNetwork()` stub body: Replace with real implementation; the function signature and `assertNoHealthData` call must be preserved.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@capacitor-community/admob` v8.0.0 is compatible with Capacitor 8.3.4 (project version). Peer dep says `^8.0.0` which matches. | Standard Stack | Low — peer dep range directly confirmed via npm view |
| A2 | AdSense script injection pattern uses `pagead2.googlesyndication.com` for the JS URL | Code Examples | Low — this is the standard Google-published URL; easy to verify |
| A3 | `ad_revenue_facts` can store AdMob/AdSense reporting data returned by their APIs — specific API field names may differ | Revenue ETL | Medium — API shapes unknown until publisher approval; stub ETL stores raw_payload jsonb as fallback |
| A4 | The freq-cap session Map approach (no localStorage) satisfies the "per-user-per-session-per-placement" spec | Architecture | Low — per CONTEXT D-08, actual fill is P70; freq-cap is testable without live fill |
| A5 | GLP-1 competing brand domains can be stored and served from Supabase within the 60s CSP cache window without latency issues | CSP Generator | Low — mirrors existing iframe_allowlist cache pattern |
| A6 | `initializeForTesting: true` in AdMob init is sufficient for Phase 56 testing without publisher approval | Code Examples | Low — confirmed in AdMob plugin docs; test mode returns test ads |

---

## Open Questions (RESOLVED)

> All three resolved at plan time per the recommendations below and pinned into the 56-02/56-03 plan tasks.

1. **AdMob reporting API field names for revenue**
   - What we know: AdMob has a Reporting API; estimated_earnings, impressions, clicks, match_rate are common fields
   - What's unclear: Exact API schema and whether credentials are available before publisher approval
   - Recommendation: `ad-revenue-etl` Edge Fn should store full `raw_payload jsonb` and extract known fields; fail gracefully when API is not yet authorized

2. **ad_network_config CHECK constraint — alter or separate table?**
   - What we know: `CHECK (network IN ('meta', 'google', 'tiktok'))` exists; 'admob' and 'adsense' need to be added
   - What's unclear: Whether altering the constraint on a live table causes any lock contention
   - Recommendation: ALTER TABLE via migration (standard pattern); Supabase applies online; add 'admob', 'adsense' to constraint

3. **Exact AdSense ad slot IDs format**
   - What we know: Publisher ID is `ca-pub-XXXXXXXXXX`; slot IDs are per-placement
   - What's unclear: Whether slot IDs are provisioned before Phase 70 or only after publisher approval
   - Recommendation: Use placeholder slot IDs in env vars; AdRenderer renders a placeholder div when slot ID is empty

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm install | ✓ | v22.18.0 | — |
| npm | Package install | ✓ | lockfileVersion 3 | — |
| `@capacitor/core` | AdMob plugin peer dep | ✓ | ^8.3.4 | — |
| `npx cap sync` | After plugin install | ✓ | Capacitor CLI ^8.3.4 | — |
| Supabase CLI | Migration push | ✓ (project established) | — | — |
| ADMOB_APP_ID_IOS / ANDROID | AdMob init | Phase 52 provisioned | — | Use test app IDs (Phase 56 runs in test mode) |
| ADSENSE_PUBLISHER_ID | AdSense injection | Phase 52 provisioned | — | Skip injection if env var empty |
| Deno binary | Edge Fn testing | ✓ | `$HOME/.deno/bin/deno` | — |

**Missing dependencies with no fallback:** None — Phase 56 runs entirely in test/stub mode; real publisher IDs are deferred to P70.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (jsdom) — already installed |
| Config file | `leanshot/vitest.config.ts` (projects: block masks default; use `npx vitest run --config vite.config.ts`) |
| Quick run command | `npx vitest run src/lib/ads/ src/components/ads/` |
| Full suite command | `npx vitest run --config vite.config.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AD-03 | `canShowAds` returns false for all excluded surfaces | unit | `npx vitest run src/lib/ads/canShowAds.test.ts` | ❌ Wave 0 |
| AD-03 | CI grep proves ad components absent from clinic/share/admin | CI shell | `bash scripts/check-no-ads-on-excluded-surfaces.sh` | ❌ Wave 0 |
| AD-08 | Freq cap blocks impression after ceiling reached | unit | `npx vitest run src/lib/ads/freqCap.test.ts` | ❌ Wave 0 |
| AD-09 | CSP generator excludes block-listed domains | unit | `npx vitest run src/lib/ads/cspGenerator.test.ts` | ❌ Wave 0 |
| AD-10 | `canShowAds` returns false when tier='paid' | unit | `npx vitest run src/lib/ads/canShowAds.test.ts` | ❌ Wave 0 |
| AD-11 | Firewall regression: ad files don't import health | CI shell | `bash scripts/check-no-health-in-ad-context.sh` | ✅ exists |
| AD-11 | assertNoHealthData throws on health-shaped object at ad boundary | unit | `npx vitest run src/lib/native/healthAssert.test.ts` | ❌ (if missing) Wave 0 |
| AD-12 | Revenue ETL migration: ad_revenue_facts table schema | migration grep | `grep -c "ad_revenue_facts" supabase/migrations/2027*` | ❌ Wave 0 |
| AD-06 | Admin dashboard renders eCPM/RPM columns | unit | `npx vitest run src/components/admin/growth/AdRevenueDashboardPage.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/ads/ && bash scripts/check-no-health-in-ad-context.sh`
- **Per wave merge:** `npx vitest run --config vite.config.ts`
- **Phase gate:** Full suite green + CI grep gates pass before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/ads/canShowAds.test.ts` — covers AD-03, AD-10 (all 12 excluded surfaces + paid tier)
- [ ] `src/lib/ads/freqCap.test.ts` — covers AD-08
- [ ] `src/lib/ads/cspGenerator.test.ts` — covers AD-09
- [ ] `scripts/check-no-ads-on-excluded-surfaces.sh` — covers AD-03 CI grep
- [ ] `src/components/admin/growth/AdRevenueDashboardPage.test.tsx` — covers AD-06 render

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | partial | Freq cap uses session Map (in-memory only, no persistent session data) |
| V4 Access Control | yes | `canShowAds(surface, tier)` runtime guard + is_staff() RLS on admin tables |
| V5 Input Validation | yes | `assertNoHealthData()` validates targeting param shape; ad placement config from DB not user input |
| V6 Cryptography | no | — |

### Known Threat Patterns for Ad Network + HealthKit Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| HealthKit data leaking to ad targeting | Information Disclosure | 3-layer firewall: ESLint AST + assertNoHealthData + CI grep (existing) |
| Ad placement on excluded clinical surface | Elevation of Privilege / Trust | `canShowAds()` EXCLUDED_SURFACES hardcoded set; CI grep test |
| Free-tier user bypassing ad-free tier | Spoofing | `canShowAds(surface, tier)` reads from Zustand store which is server-synced; TierGate pattern |
| GLP-1 competitor ads appearing in CSP | Repudiation | Block-list table enforced in middleware; allowlist generated by excluding block-listed domains |
| Ad revenue ETL fetching unauthorized data | Information Disclosure | `ad_revenue_facts` RLS: `is_admin_at_least('admin')`; SECDEF RPC accessor |
| Revenue ETL Edge Fn called by unauthorized party | Spoofing | Service role bearer (vault pattern); same as Phase 33 ad-spend-cron auth |

---

## Sources

### Primary (HIGH confidence)
- `leanshot/src/lib/native/ads.ts` — Phase 12 stub + assertNoHealthData wiring [VERIFIED: codebase]
- `leanshot/src/lib/billing.ts` — `getActiveTier()` + `TIER_GATE_REGISTRY['ad-free']` [VERIFIED: codebase]
- `supabase/migrations/20270703000001-20270703000013_*.sql` — Full Phase 33 ad ETL schema [VERIFIED: codebase]
- `leanshot/eslint-rules/no-health-in-ad-context.cjs` — Layer 1 firewall AST rule [VERIFIED: codebase]
- `leanshot/src/lib/native/healthAssert.ts` — Layer 2 runtime guard + assertNoHealthData [VERIFIED: codebase]
- `leanshot/scripts/check-no-health-in-ad-context.sh` — Layer 3 CI grep gate [VERIFIED: codebase]
- `leanshot/middleware.ts` — CSP assembly + iframe_allowlist augmentation pattern [VERIFIED: codebase]
- `leanshot/vercel.json` — Static CSP baseline + installCommand flags [VERIFIED: codebase]
- `leanshot/src/lib/admin/modules.ts` — ADMIN_MODULES manifest pattern [VERIFIED: codebase]
- `npm view @capacitor-community/admob` — v8.0.0, peerDependencies `@capacitor/core ^8.0.0` [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- github.com/capacitor-community/admob README — AdMob.initialize(), showBanner(), prepareInterstitial() API [CITED: github.com/capacitor-community/admob]
- `consent-config.ts` marketing category + `ad_storage` Consent Mode v2 wiring [VERIFIED: codebase]

### Tertiary (LOW confidence / ASSUMED)
- AdSense script injection URL (`pagead2.googlesyndication.com`) — training knowledge [ASSUMED]
- AdMob Reporting API field names (estimated_earnings, impressions, match_rate) — training knowledge [ASSUMED]
- GLP-1 brand domain list (wegovy.com, ozempic.com, etc.) — publicly known brands [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — @capacitor-community/admob v8.0.0 confirmed via npm; peer deps exact match
- Existing codebase inventory: HIGH — all files directly read and verified
- Architecture: HIGH — mirrors established Phase 33/55/41 patterns exactly
- AdMob API specifics: MEDIUM — API surface verified from GitHub README; method names confirmed
- Revenue ETL API shapes: LOW — unknown until publisher approval; stub approach mitigates

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable — AdMob plugin major versions move slowly; P70 handles live fill)
