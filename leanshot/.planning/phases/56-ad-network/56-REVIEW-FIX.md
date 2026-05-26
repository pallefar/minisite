---
phase: 56-ad-network
fixed_at: 2026-05-25T16:34:00Z
review_path: leanshot/.planning/phases/56-ad-network/56-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 56: Code Review Fix Report

**Fixed at:** 2026-05-25T16:34:00Z
**Source review:** leanshot/.planning/phases/56-ad-network/56-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (4 Critical + 3 Warning)
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: CI grep gate misses `src/components/share/` — doctor-share surface unprotected at Layer 3

**Files modified:** `leanshot/scripts/check-no-ads-on-excluded-surfaces.sh`, `leanshot/scripts/check-no-ads-on-excluded-surfaces.test.sh`
**Commit:** 9ae363cf
**Applied fix:** Added `-path "*/components/share/*"` to the `find` predicate in the shell gate. Updated the directory comment block to document the new path. Added Assertion B2 to the self-test to plant a fake violation in `components/share/FakeSharePage.tsx` and assert exit 1 — all 4 self-test assertions now pass.

---

### CR-02: `ad_csp_allowlist` and `ad_advertiser_blocklist` have admin-only RLS — middleware anon reads return empty

**Files modified:** `supabase/migrations/20280401000006_ad_config_anon_select.sql` (new file)
**Commit:** 3a551401
**Applied fix:** Created forward-dated migration `20280401000006` adding `create policy "ad_csp_allowlist_anon_select" ... using (true)` and `create policy "ad_advertiser_blocklist_anon_select" ... using (true)` on the respective tables. Existing admin-write policies from `20280401000002` are untouched. Neither table contains PHI — hostnames and competitor domains are non-sensitive config.

---

### CR-04: `ad_placements` has no anon SELECT policy — `fetchPlacements()` always returns `[]`

**Files modified:** `supabase/migrations/20280401000007_ad_placements_authenticated_select.sql` (new file)
**Commit:** f84ba3bf
**Applied fix:** Created forward-dated migration `20280401000007` adding `create policy "ad_placements_authenticated_select" ... to authenticated using (enabled = true)`. Only enabled placements are exposed; disabled/draft rows remain hidden from non-admins. Admin CRUD via existing `ad_placements_admin_all` is unchanged.

---

### CR-03: `EmbedAdSlot` sandbox `allow-same-origin` lets embedded document access parent cookies and localStorage

**Files modified:** `leanshot/src/components/ads/EmbedAdSlot.tsx`, `leanshot/src/components/ads/AdRenderer.test.tsx`
**Commit:** 53887560
**Applied fix:** Changed `sandbox="allow-same-origin"` to `sandbox=""` (empty = null origin; no parent storage access). Updated the file-level JSDoc to explain why `allow-same-origin` is prohibited. Added a regression test in `AdRenderer.test.tsx` asserting `iframe.getAttribute('sandbox')` does not contain `allow-same-origin`. All 8 AdRenderer tests pass.

---

### WR-01: `canShowAds` uses `!== 'paid'` fallthrough — future tiers default to showing ads

**Files modified:** `leanshot/src/lib/ads/canShowAds.ts`
**Commit:** 8bc56992
**Applied fix:** Replaced `if (tier === 'paid') return false` with an explicit `AD_TIERS: ReadonlySet<Tier> = new Set(['free', 'past_due'])` allowlist and `if (!AD_TIERS.has(tier)) return false`. A new tier added to the `Tier` union will default to no ads until explicitly added to `AD_TIERS`. All 21 canShowAds unit tests pass unchanged (the existing test cases cover 'paid', 'free', 'past_due' exhaustively).

---

### WR-02: ETL Edge Function `Deno.serve()` top-level causes port bind during `deno test`

**Files modified:** `supabase/functions/ad-revenue-etl/index.ts`
**Commit:** 8c47773a
**Applied fix:** Wrapped `Deno.serve(...)` with `if (import.meta.main)`. Tests can now import `normalizeReportRow` and `computeEcpmRpm` safely. All 7 deno tests pass with `--allow-env` only (no `--allow-net` required).

---

### WR-03: Revenue dashboard eCPM/RPM computed as simple average of averages — misleading KPIs

**Files modified:** `leanshot/src/components/admin/growth/AdRevenueDashboardPage.tsx`
**Commit:** 62756387
**Applied fix:** Rewrote both the top-level `kpis` useMemo and the per-network `networkGroups` aggregation to use impressions-weighted eCPM/RPM: `(totalRevenue / totalImpressions) * 1000`. Removed the intermediate ecpm/rpm accumulator fields from the byNetwork map (now derived post-accumulation). `fill_rate` remains a simple row-count average; `ctr` was already correctly impression-weighted. TypeScript compile passes with no new errors.

---

_Fixed: 2026-05-25T16:34:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
