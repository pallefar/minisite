---
phase: 56-ad-network
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - leanshot/src/lib/ads/canShowAds.ts
  - leanshot/src/lib/ads/canShowAds.test.ts
  - leanshot/src/lib/ads/freqCap.ts
  - leanshot/src/lib/ads/freqCap.test.ts
  - leanshot/src/lib/ads/placementRegistry.ts
  - leanshot/src/lib/ads/placementRegistry.test.ts
autonomous: true
requirements: [AD-03, AD-08, AD-10]
must_haves:
  truths:
    - "canShowAds returns false for every excluded surface (clinic, clinic-settings, clinic-drill-in, share, admin, dose-log, patient) regardless of tier"
    - "canShowAds returns false when tier === 'paid' on every surface (Pro/Lifetime zero ads)"
    - "canShowAds returns true only for allowed consumer/marketing surfaces when tier is free or past_due"
    - "Frequency cap blocks the impression once the per-placement session ceiling is reached"
    - "Placement registry exposes a typed AdPlacementConfig (mode embed-code|ad-platform|house-ads, network, freq_cap_per_session) consumable by AdRenderer"
  artifacts:
    - path: "leanshot/src/lib/ads/canShowAds.ts"
      provides: "canShowAds(surface, tier) pure guard + AdSurface type + EXCLUDED_SURFACES set"
      exports: ["canShowAds", "AdSurface", "EXCLUDED_SURFACES"]
    - path: "leanshot/src/lib/ads/freqCap.ts"
      provides: "Session-local frequency cap counter"
      exports: ["canShowNextImpression", "resetSessionCounts"]
    - path: "leanshot/src/lib/ads/placementRegistry.ts"
      provides: "AdPlacementConfig type + AdServingMode union + registry fetch contract"
      exports: ["AdPlacementConfig", "AdServingMode", "fetchPlacements"]
  key_links:
    - from: "leanshot/src/lib/ads/canShowAds.ts"
      to: "leanshot/src/types/index.ts (Tier)"
      via: "import type Tier"
      pattern: "import type.*Tier"
    - from: "leanshot/src/lib/ads/canShowAds.ts"
      to: "EXCLUDED_SURFACES"
      via: "hardcoded MUST-NEVER set (not config-driven)"
      pattern: "EXCLUDED_SURFACES"
---

<objective>
Build the pure, dependency-free core of the ad system: the `canShowAds(surface, tier)` surface+tier exclusion guard (AD-03 / AD-10), the session-local frequency cap (AD-08), and the placement-registry type contract (AdPlacementConfig + AdServingMode) that downstream serving + dashboard plans implement against.

Purpose: This is the single MUST-NEVER trust boundary for ads. Every ad render path flows through `canShowAds` first; ad sub-components never re-read tier. Shipping it as a pure, fully-tested module in Wave 0 with no codebase imports beyond the `Tier` type gives every later plan a stable contract and a green test it cannot break silently.
Output: `src/lib/ads/canShowAds.ts`, `freqCap.ts`, `placementRegistry.ts` + their Vitest specs.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/56-ad-network/56-RESEARCH.md
@.planning/phases/56-ad-network/56-CONTEXT.md

<interfaces>
<!-- Verified from codebase. Use these directly — no exploration needed. -->

From leanshot/src/types/index.ts (line 272):
```typescript
export type Tier = 'free' | 'paid' | 'past_due';
```

From leanshot/src/lib/billing.ts (already prepared for this phase):
```typescript
// TIER_GATE_REGISTRY['ad-free'] = 'hard-block-no-ui' is already registered.
// getActiveTier(stripeStatus, currentPeriodEnd, now): Tier — returns 'free' | 'paid' | 'past_due'.
// Tier mapping for ads: tier === 'paid' -> zero ads; 'free' | 'past_due' -> ads allowed on permitted surfaces.
```

Excluded surfaces (MUST-NEVER — from RESEARCH §7 + ROADMAP success criterion 2):
clinic, clinic-settings, clinic-drill-in, share (covers #/share/* doctor-share), admin (all /admin/*), dose-log (/dose-log/*), patient (/patient/*).

Allowed surfaces (free tier): home, body, nutrition, activity, supplements, mood, insights, community, classroom, events, marketing, onboarding.
NOTE: 'medication' tab is PHI context → treat as dose-log-equivalent; it is NOT in the allowed list.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: canShowAds surface+tier guard (AD-03, AD-10)</name>
  <files>leanshot/src/lib/ads/canShowAds.ts, leanshot/src/lib/ads/canShowAds.test.ts</files>
  <behavior>
    - canShowAds(surface, 'paid') === false for ALL surfaces (Pro/Lifetime zero ads — D-10).
    - canShowAds(s, 'free') === false for every s in EXCLUDED_SURFACES: 'clinic','clinic-settings','clinic-drill-in','share','admin','dose-log','patient'.
    - canShowAds(s, 'past_due') === false for every excluded surface (past_due is non-paid but exclusion still wins).
    - canShowAds(s, 'free') === true for allowed surfaces: 'home','body','nutrition','activity','supplements','mood','insights','community','classroom','events','marketing','onboarding'.
    - EXCLUDED_SURFACES is a hardcoded Set (NOT loaded from DB/config) — a test asserts it contains exactly the 7 excluded surfaces.
  </behavior>
  <action>Create `src/lib/ads/canShowAds.ts` exporting the `AdSurface` union type (all allowed + excluded surface strings), a frozen module-level `EXCLUDED_SURFACES` Set&lt;AdSurface&gt; with exactly the 7 MUST-NEVER surfaces, and `canShowAds(surface: AdSurface, tier: Tier): boolean`. Logic: if tier === 'paid' return false; then return !EXCLUDED_SURFACES.has(surface). Import `Tier` as a type-only import from `@/types`. This file is under `src/lib/ads/` so the Phase 55 ESLint FORBIDDEN_IMPORTERS regex covers it — it MUST NOT import anything from `native/health`. Do NOT make EXCLUDED_SURFACES config-driven (it is the compliance invariant; keep it hardcoded per RESEARCH anti-pattern note). Write the test file first (RED), covering all behavior cases above plus the set-membership assertion, then implement.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/ads/canShowAds.test.ts --config vite.config.ts</automated>
  </verify>
  <done>All canShowAds tests green: paid→false everywhere, every excluded surface→false at free/past_due, every allowed surface→true at free. EXCLUDED_SURFACES set-membership test passes. tsc clean for the file.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Session frequency cap (AD-08)</name>
  <files>leanshot/src/lib/ads/freqCap.ts, leanshot/src/lib/ads/freqCap.test.ts</files>
  <behavior>
    - canShowNextImpression(placementId, ceiling) returns true and increments the counter while count &lt; ceiling.
    - Returns false (and does NOT increment past ceiling) once count === ceiling.
    - Counters are keyed per placementId — two placements with ceiling 1 each get one impression each independently.
    - resetSessionCounts() clears all counters so the next call returns true again.
    - State lives in a module-level Map (NOT localStorage) so it resets on page reload (per-session spec — RESEARCH anti-pattern: no localStorage).
  </behavior>
  <action>Create `src/lib/ads/freqCap.ts` with a module-level `const sessionCounts = new Map&lt;string, number&gt;()`, `canShowNextImpression(placementId: string, sessionCeiling: number): boolean` (read count, return false if &gt;= ceiling else increment and return true), and `resetSessionCounts(): void` clearing the map. No localStorage, no imports from `native/health`. Write the test (RED) covering all behavior cases — note the test must call resetSessionCounts() in beforeEach to isolate the shared module Map.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/ads/freqCap.test.ts --config vite.config.ts</automated>
  </verify>
  <done>Freq-cap tests green: ceiling enforced per placement, independent keys, reset works, no localStorage reference in source.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Placement registry type contract + fetcher (AD-05 contract / AD-04 modes)</name>
  <files>leanshot/src/lib/ads/placementRegistry.ts, leanshot/src/lib/ads/placementRegistry.test.ts</files>
  <behavior>
    - AdServingMode union is exactly 'embed-code' | 'ad-platform' | 'house-ads' (the 3 modes — D-04).
    - AdPlacementConfig shape includes: placement_id (string), surface (AdSurface), mode (AdServingMode), network ('admob'|'adsense'|null), freq_cap_per_session (number), enabled (boolean), ab_variant (string|null for AD-07 PostHog split), embed_html (string|null for embed-code mode), house_ad_slug (string|null for house-ads mode).
    - fetchPlacements() returns Promise&lt;AdPlacementConfig[]&gt;; on fetch error it returns [] (fail-safe: no placements = no ads, never throws into render path).
    - A pure mapper rowToPlacementConfig(row) normalizes a DB row to AdPlacementConfig with safe defaults (enabled defaults false, freq_cap_per_session defaults a sane ceiling).
  </behavior>
  <action>Create `src/lib/ads/placementRegistry.ts` exporting `AdServingMode`, the `AdPlacementConfig` interface (importing `AdSurface` from `./canShowAds`), a pure `rowToPlacementConfig(row: Record&lt;string, unknown&gt;): AdPlacementConfig` mapper, and `fetchPlacements(): Promise&lt;AdPlacementConfig[]&gt;` that reads the `ad_placements` table (the schema this maps to is created by Plan 56-02). Use the project's existing Supabase client import convention (grep `src/lib/` for the supabase client export — reuse it; do not instantiate a new client). On any error, catch and return []. This is the contract downstream AdRenderer (56-03) and admin dashboard (56-05) build against — keep the field names stable. Write the test (RED) for the AdServingMode union exhaustiveness, the mapper defaults, and fetchPlacements returning [] on a mocked rejected fetch.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/ads/placementRegistry.test.ts --config vite.config.ts</automated>
  </verify>
  <done>Registry tests green: 3-mode union, mapper safe defaults, fetchPlacements fail-safe returns []. AdPlacementConfig + AdServingMode exported for downstream plans.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| surface string → ad render decision | canShowAds is the single gate; a wrong/spoofed surface string must fail closed |
| Zustand tier → ad-free entitlement | free-tier user must not bypass the paid gate |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-56-01 | Elevation of Privilege | canShowAds EXCLUDED_SURFACES | mitigate | Hardcoded frozen Set (not DB-config); unit test asserts exact membership so a future edit that removes a surface fails CI |
| T-56-02 | Spoofing | tier gate | mitigate | tier comes from server-synced Zustand store; canShowAds returns false for 'paid' first, before any surface logic |
| T-56-03 | Information Disclosure | placementRegistry fetch | accept | reads admin-RLS'd ad_placements via existing client; fail-safe [] on error; no PHI in table |
</threat_model>

<verification>
- `cd leanshot && npx vitest run src/lib/ads/ --config vite.config.ts` — all three specs green.
- `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` — no type errors introduced.
- `cd leanshot && bash scripts/check-no-health-in-ad-context.sh src` — Layer 3 firewall still green (new ads/ files import no health).
</verification>

<success_criteria>
canShowAds enforces both tier gate and surface exclusion (proven by exhaustive unit tests), freq-cap enforces per-placement session ceilings, and the placement registry contract (AdPlacementConfig + AdServingMode) is exported for downstream plans. No new health import in ad-context files.
</success_criteria>

<output>
Create `.planning/phases/56-ad-network/56-01-SUMMARY.md` when done. Record the exact exported signatures of canShowAds, AdSurface, AdPlacementConfig, AdServingMode, canShowNextImpression so plans 56-03/56-05 consume them verbatim.
</output>
