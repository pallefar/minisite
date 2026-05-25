---
phase: 56-ad-network
reviewed: 2026-05-25T00:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - leanshot/src/lib/ads/canShowAds.ts
  - leanshot/src/lib/ads/freqCap.ts
  - leanshot/src/lib/ads/placementRegistry.ts
  - leanshot/src/lib/ads/cspGenerator.ts
  - leanshot/src/lib/native/ads.ts
  - leanshot/src/lib/ads/adsense.ts
  - leanshot/src/components/ads/AdRenderer.tsx
  - leanshot/src/components/ads/EmbedAdSlot.tsx
  - leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx
  - leanshot/src/lib/admin/modules.ts
  - leanshot/middleware.ts
  - supabase/functions/ad-revenue-etl/index.ts
  - supabase/migrations/20280401000001_ad_placements.sql
  - supabase/migrations/20280401000002_ad_advertiser_blocklist.sql
  - supabase/migrations/20280401000003_ad_revenue_facts.sql
  - supabase/migrations/20280401000004_ad_network_config_add_serving.sql
  - supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql
  - leanshot/scripts/check-no-ads-on-excluded-surfaces.sh
findings:
  critical: 4
  warning: 3
  info: 2
  total: 9
status: issues_found
---

# Phase 56: Ad Network — Code Review Report

**Reviewed:** 2026-05-25T00:00:00Z
**Depth:** deep
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Phase 56 ships the ad-serving scaffolding: canShowAds surface+tier guard, frequency cap, placement registry, CSP generator, AdRenderer, EmbedAdSlot, AdSense injector, native AdMob bridge, admin revenue dashboard, 5 migrations, and a daily ETL Edge Function.

The tier-gating logic, EXCLUDED_SURFACES frozen Set, and the three-layer surface-exclusion discipline are structurally sound. The SECDEF RPC uses `is_admin_at_least` correctly. The `Deno.serve()` top-level call is appropriately acknowledged in comments.

Four blockers are found: (1) the CI grep gate misses the `src/components/share/` directory (doctor-share surface is unguarded at Layer 3); (2) both `ad_csp_allowlist` and `ad_advertiser_blocklist` have admin-only RLS while the middleware reads them with the anon key — the fetch will receive an empty array, silently making the blocklist bypass detection impossible and CSP hosts never appearing; (3) `EmbedAdSlot` uses `allow-same-origin` in its sandbox, which combined with omitting `allow-scripts` still allows the embedded document to read `document.cookie` and navigate the parent when served from the same origin; (4) KPI aggregation in the revenue dashboard computes eCPM/RPM as a simple average of averages rather than impressions-weighted, producing incorrect figures for decisions.

---

## Critical Issues

### CR-01: CI grep gate misses `src/components/share/` — doctor-share surface unprotected at Layer 3

**File:** `leanshot/scripts/check-no-ads-on-excluded-surfaces.sh:77-93`

**Issue:** The `find` command covers `*/components/dashboard/share/*` but there is a separate `src/components/share/` tree (`SharePage.tsx`, `share-client.ts`, `CodeEntryScreen.tsx`, `ShareRevokedScreen.tsx`) which is the actual doctor-share surface (`AdSurface = 'share'`). An ad-serving import dropped into `src/components/share/` would bypass Layer 3 entirely — the script would find zero hits and exit 0. Layer 1 (ESLint `import-x/no-restricted-paths`) and Layer 2 (canShowAds runtime check) are still operational, but the three-layer discipline is incomplete for this surface.

**Fix:**
```bash
# Add the additional path in the find predicate (lines 77-93):
FILES=$(find "$SRC_ROOT" \
  \( \
    -path "*/components/clinic/*" \
    -o -path "*/components/admin/*" \
    -o -path "*/components/dashboard/share/*" \
    -o -path "*/components/share/*" \          # ADD: doctor-share surface
    -o -name "MedicationTab.tsx" \
    -o -name "*dose-log*" \
    -o -name "*patient*" \
  \) \
  ...
```

---

### CR-02: `ad_csp_allowlist` and `ad_advertiser_blocklist` have admin-only RLS but are read by the middleware with the anon key — fetch returns empty, blocklist is never enforced

**File:** `supabase/migrations/20280401000002_ad_advertiser_blocklist.sql:33-63` and `leanshot/middleware.ts:119-176`

**Issue:** Both tables have a single `for all` policy gated on `public.is_admin_at_least('admin')`. The Edge Middleware calls `fetchAdCspHosts` using the `SUPABASE_ANON_KEY` in the `Authorization` header. An anon session is not an admin, so Postgres returns an empty array for both tables. The consequences are:

1. `ad_csp_allowlist` always returns `[]` → no ad-network hosts ever enter the CSP via the dynamic path (Google AdSense will be blocked by the static CSP).
2. `ad_advertiser_blocklist` always returns `[]` → `filterBlocklisted` receives an empty blocklist → every row in the (also-empty) allowlist passes → net effect: no hosts enter CSP at all. This means T-56-11 (GLP-1 competitor host exclusion) is untestable and would not function even if the allowlist had rows.

When a superadmin later adds hosts to `ad_csp_allowlist`, the CSP will still remain empty because the anon key cannot read the rows. The failure is silent — `fetchAdCspHosts` only throws on non-OK HTTP status; a 200 with an empty `[]` body (which is what PostgREST returns for an RLS-denied SELECT) does not raise.

**Fix:** Add an anon SELECT policy to both tables so the middleware can read them without granting write access:

```sql
-- In migration 20280401000002 (or a new migration):
create policy "ad_csp_allowlist_anon_select"
  on public.ad_csp_allowlist
  for select
  using (true);   -- public read; no PHI; hostnames are non-sensitive

create policy "ad_advertiser_blocklist_anon_select"
  on public.ad_advertiser_blocklist
  for select
  using (true);   -- public read; blocklist hostnames are non-sensitive
```

Alternatively read both tables via service-role inside a SECDEF RPC and call that from the middleware with the service-role key (same pattern as the vault-based cron auth).

---

### CR-03: `EmbedAdSlot` sandbox `allow-same-origin` lets embedded document access parent cookies and local storage

**File:** `leanshot/src/components/ads/EmbedAdSlot.tsx:22-23`

**Issue:** The sandbox attribute is `sandbox="allow-same-origin"`. When a `srcDoc` iframe has `allow-same-origin`, the embedded document's origin is treated as the same as the parent page. This grants the embedded HTML (which is advertiser-supplied content stored in `embed_html`) access to `document.cookie`, `localStorage`, and `sessionStorage` of the parent origin. A malicious or compromised `embed_html` value could exfiltrate the Zustand persisted store (which contains user health data), the Anthropic API key from localStorage, and all Supabase session cookies. This directly violates the FIREWALL requirement.

Removing `allow-same-origin` causes `srcDoc` iframes to be treated as a unique null origin, which is the secure default: they can render HTML and CSS but cannot read parent storage or set same-site cookies.

**Fix:**
```tsx
// EmbedAdSlot.tsx line 22 — remove allow-same-origin entirely:
<iframe
  title={`ad-embed-${placementId}`}
  srcDoc={srcDoc}
  sandbox=""                          // null origin: no scripts, no same-origin storage access
  style={{ border: 'none', width: '100%', height: '90px' }}
  aria-label="Advertisement"
/>
```

If scripts are needed for the ad to render (e.g. AdSense `<ins>` tags), use `sandbox="allow-scripts"` WITHOUT `allow-same-origin` — scripts run in a null origin context and cannot reach parent storage.

---

### CR-04: `ad_placements` table has no anon SELECT policy — `fetchPlacements()` always returns `[]` for every logged-in free/past_due user

**File:** `supabase/migrations/20280401000001_ad_placements.sql:24-30` and `leanshot/src/lib/ads/placementRegistry.ts:87-101`

**Issue:** `ad_placements` has a single `for all` policy gated on `is_admin_at_least('admin')`. `fetchPlacements()` calls the Supabase anon client (the browser's `supabase` instance) — it runs as an authenticated user session, not a service-role session. A free-tier user is not an admin, so PostgREST returns an empty array. `fetchPlacements` silently returns `[]`. `AdRenderer` receives an empty placement config list → no ads ever render, regardless of tier or surface.

This is a functional blocker: the entire ad-serving pipeline is dead on arrival because placements cannot be read by the clients that need to display them.

**Fix:** Add an authenticated SELECT policy (non-admin users need read access to enabled placements; write is still admin-only):

```sql
-- In migration 20280401000001 (or a new migration):
create policy "ad_placements_authenticated_select"
  on public.ad_placements
  for select
  to authenticated
  using (enabled = true);   -- only expose enabled placements; never expose disabled/draft rows
```

This ensures free-tier and past_due users can read enabled placements while the existing `ad_placements_admin_all` policy gives admins full CRUD.

---

## Warnings

### WR-01: `canShowAds` treats `past_due` identically to `free` — no explicit check

**File:** `leanshot/src/lib/ads/canShowAds.ts:84-87`

**Issue:** The function only gates on `tier === 'paid'`. `Tier` is `'free' | 'paid' | 'past_due'`. The comment acknowledges this (`// free/past_due`), and showing ads to `past_due` users is the stated intent. The risk is that if a future tier value is added (e.g. `'trial'`, `'grandfathered'`) and the developer forgets to update `canShowAds`, the new tier will silently show ads. An allowlist (explicit paid-tier suppression list) or an exhaustive switch is safer than an implicit "anything not `paid`" fall-through.

**Fix:**
```typescript
export function canShowAds(surface: AdSurface, tier: Tier): boolean {
  // Explicit paid-tier suppression — extend this list if new paid tiers are added.
  const PAID_TIERS: ReadonlySet<Tier> = new Set(['paid']);
  if (PAID_TIERS.has(tier)) return false;
  return !EXCLUDED_SURFACES.has(surface);
}
```

Or, if intentionally showing ads on `past_due` and never on any other paid tier, add a TypeScript exhaustive check comment and a unit test that asserts `canShowAds` returns `true` for every non-paid `Tier` value.

---

### WR-02: ETL Edge Function `Deno.serve()` is top-level (not guarded by `import.meta.main`) — acknowledged but not fixed

**File:** `supabase/functions/ad-revenue-etl/index.ts:167`

**Issue:** Per project memory `reference_deno_test_top_level_serve_trap`, unguarded `Deno.serve()` causes `deno test path/` to bind a real HTTP server on import, producing a dangling promise that aborts all tests. The comment at line 14-20 acknowledges this and states "Tests MUST only import the pure helpers". This is documented but not fixed, meaning any future developer who runs `deno test supabase/functions/ad-revenue-etl/` will get an unexpected server bind and aborted test run.

**Fix:**
```typescript
// Replace the bare Deno.serve call with import.meta.main guard:
if (import.meta.main) {
  Deno.serve(async (req: Request): Promise<Response> => {
    // ... handler body unchanged
  });
}
```

This is the standard Deno pattern for entry-point gating and would allow the test file to safely import `normalizeReportRow` and `computeEcpmRpm` without port binding.

---

### WR-03: Revenue dashboard eCPM/RPM displayed as simple average of averages — incorrect aggregation produces misleading KPIs

**File:** `leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx:170-176`

**Issue:** The KPI strip computes:
```ts
const avgEcpm = rows.reduce((sum, r) => sum + r.ecpm_usd, 0) / rows.length;
const avgRpm  = rows.reduce((sum, r) => sum + r.rpm_usd,  0) / rows.length;
```

eCPM and RPM are themselves derived ratios (`(revenue / impressions) * 1000`). Averaging ratios without weighting by impressions produces an incorrect result whenever row impression counts differ — a day with 10 impressions is given the same weight as a day with 100,000 impressions. The correct aggregate is:

```
eCPM = (total_revenue / total_impressions) * 1000
```

The `ctr` computation on line 174 correctly uses total impressions as denominator; eCPM/RPM should follow the same pattern. Since the SECDEF RPC returns individual rows (not pre-aggregated), the fix belongs in the `kpis` memo.

**Fix:**
```typescript
const kpis = useMemo(() => {
  if (!rows || rows.length === 0) return { ecpm: 0, rpm: 0, fillRate: 0, ctr: 0 };

  const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);
  const totalClicks      = rows.reduce((sum, r) => sum + r.clicks, 0);
  const totalRevenue     = rows.reduce((sum, r) => sum + r.estimated_revenue_usd, 0);
  const avgFillRate      = rows.reduce((sum, r) => sum + r.fill_rate, 0) / rows.length;

  const ecpm = totalImpressions > 0 ? (totalRevenue / totalImpressions) * 1000 : 0;
  const rpm  = ecpm; // RPM = eCPM at page-view level; set to 0 until page-view denominator is available
  const ctr  = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  return { ecpm, rpm, fillRate: avgFillRate, ctr };
}, [rows]);
```

The per-network grouping in `networkGroups` has the same bug at line 221-225 and should apply the same weighted fix.

---

## Info

### IN-01: `publisherId` passed as URL query parameter and `data-ad-client` attribute — publisherId must be validated as `ca-pub-\d+` format

**File:** `leanshot/src/lib/ads/adsense.ts:37-38`

**Issue:** The AdSense script URL is built by string interpolation: `${ADSENSE_SCRIPT_URL}?client=${publisherId}`. If `publisherId` contains special characters (spaces, quotes, slashes), it will produce a malformed URL or a broken `data-ad-client` attribute. The guard at line 29 (`if (!publisherId) return`) only checks for falsy; it does not validate the format. The real publisher ID format is `ca-pub-[16 digits]`.

**Fix:** Add a format guard before injection:
```typescript
const PUB_ID_RE = /^ca-pub-\d{16}$/;
if (!publisherId || !PUB_ID_RE.test(publisherId)) return;
```

---

### IN-02: `AdRenderer` — `void network` comment acknowledges dead code path

**File:** `leanshot/src/components/ads/AdRenderer.tsx:100`

**Issue:** The `network` variable resolved via A/B logic at lines 82-86 is explicitly voided on line 100 with the comment "used for future routing; PlatformAdSlot branches on detectPlatform()". This means the A/B variant resolution runs every render but has no effect on the `ad-platform` branch — `PlatformAdSlot` does not receive `network` as a prop. This is dead code that will accumulate stale logic until Phase 70.

**Fix:** Either pass `network` to `PlatformAdSlot` now (as a prop, even if ignored), or remove the A/B resolution from the `ad-platform` branch until Phase 70 when the prop is actually consumed:
```typescript
case 'ad-platform':
  return <PlatformAdSlot placementId={placement.placement_id} network={network ?? undefined} />;
```

---

_Reviewed: 2026-05-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
