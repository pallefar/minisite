# Phase 56: Ad Network - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Three-mode ad system (embed-code / ad-platform / house-ads) with strict surface exclusion (clinic / doctor-share / admin / `/dose-log/*` / `/share/*` / `/patient/*` NEVER show ads), tier-gating (Pro/Lifetime = zero ads), the HealthKit two-tunnel firewall preserved, advertiser block-list → CSP allowlist, frequency capping, per-network revenue ETL, and an admin revenue dashboard — closing the unit-economics loop against Phase 33 ad-spend.

**Already in place (EXTEND):** `src/lib/native/ads.ts` (stub + `assertNoHealthData` firewall boundary guard wired in Phase 55); v1.3 Phase 33 ad-SPEND ETL infra (`ad_spend_facts_partition`, `ad_network_config`, `ad_revenue_normalized_matview`, `rls_deny_ad_tables`, `ad_etl_cron_schedules`, `trigger_ad_etl_backfill`); `billing.ts` (Pro/Lifetime tier logic); `AdminMetrics*` admin-dashboard pattern; consent-config.ts; the Phase 55 firewall (ESLint rule + assertNoHealthData + CI grep gate).

**Net-new this phase:** `@capacitor-community/admob` + AdSense web component; 3 serving modes; `canShowAds(surface,tier)` runtime exclusion guard + CI grep test; tier-gating via billing.ts; frequency cap; GLP-1 advertiser block-list → CSP allowlist generator; per-network REVENUE side of the ETL; admin revenue dashboard module.

Per D-08: real ad FILL (AdMob/AdSense publisher approval pending), on-device AdMob rendering → Phase 70. Build serving components + config + all guards/ETL/dashboard now, verifiable without live ads.
</domain>

<decisions>
## Implementation Decisions

### Ad serving (plugins, 3 modes)
- `@capacitor-community/admob` for mobile; AdSense via a `<script>`-injecting web component. Install `--legacy-peer-deps`.
- 3 config-driven modes per placement: **embed-code** (sandboxed raw advertiser snippet), **ad-platform** (AdMob/AdSense), **house-ads** (self-promo).
- Real ad fill + on-device AdMob → P70.

### Surface exclusion + tier-gating (MUST-NEVER guard)
- Runtime `canShowAds(surface, tier)` guard + a CI grep test proving ad components NEVER reach clinic / doctor-share / admin / `/dose-log/*` / `/share/*` / `/patient/*` (mirror the Phase 55 firewall discipline: runtime + CI grep, ideally + an ESLint/structural check).
- Tier-gating reuses `billing.ts` — Pro/Lifetime → zero ads. Free tier → ads on allowed consumer surfaces only.

### Block-list/CSP, frequency cap, revenue ETL, dashboard
- Advertiser block-list defaults to competing GLP-1 brands; the CSP allowlist is GENERATED from the block-list (exclude blocked, allow approved networks). Keep CSP assembly in Edge Middleware (vercel.json doesn't interpolate env — memory).
- Frequency cap: per-user-per-session-per-placement, admin-configured ceiling.
- Revenue ETL: EXTEND the Phase 33 ad-ETL (`ad_revenue_normalized_matview` + network config) with per-network REVENUE rows; close the unit-economics loop vs ad-spend.
- Admin revenue dashboard: NEW admin module reusing the `AdminMetrics*` pattern (eCPM / RPM / fill rate / CTR by placement + network) + admin manifest entry + catch-all router branch (avoid manifest↔router drift). is_staff RLS. **No separate UI-SPEC** — reuse existing admin DS.

### Defer posture
- "Done" = serving components + 3 modes + `canShowAds` exclusion guard + CI test + tier-gate + freq-cap + GLP-1 block-list→CSP + per-network revenue ETL + admin dashboard + a test proving the HealthKit firewall is preserved against ad-serving code. Real ad fill / on-device AdMob / publisher approval → Phase 70.

### Claude's Discretion
- Plugin specifics, placement registry shape, freq-cap windows, CSP generator details, matview revenue columns, dashboard layout (within AdminMetrics DS).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/native/ads.ts` (stub + firewall guard), `billing.ts` (tier), `src/components/consent/consent-config.ts`.
- Phase 33 ad migrations: `20270703000002_ad_network_config.sql`, `20270703000008_ad_revenue_normalized_matview.sql`, `20270703000001_ad_spend_facts_partition.sql`, `20270703000010_rls_deny_ad_tables.sql`, `20270703000011_ad_etl_cron_schedules.sql`, `20270703000012_trigger_ad_etl_backfill_secdef.sql`.
- Admin dashboard pattern: `src/components/admin/AdminMetrics*` + `AdminShell.tsx` + `src/lib/admin/modules.ts` manifest (+ catch-all router — Phase 42 drift lesson).
- Phase 55 firewall: `eslint-rules/no-health-in-ad-context.cjs`, `src/lib/native/healthAssert.ts` (`assertNoHealthData`), `scripts/check-no-health-in-ad-context.sh`.
- `public.is_staff()` RLS helper.

### Established Patterns
- MUST-NEVER invariant = runtime guard + CI grep (+ ESLint) — same discipline as the two-tunnel firewall (Phase 55 / Phase 39).
- Capacitor: cap sync only, `--legacy-peer-deps`, detectPlatform from platform.ts (firewall-safe).
- CSP dynamic assembly → Edge Middleware, NOT vercel.json (no env interpolation).
- `npm run lint` is RED project-wide (pre-existing debt) — gate via tsc + targeted tests, per-file eslint for regressions.

### Integration Points
- AdMob plugin in package.json; AdSense web component; canShowAds guard in src/lib/; CI grep gate in scripts/ + ci.yml; revenue ETL migration; admin module in src/components/admin/ + modules.ts.

</code_context>

<specifics>
## Specific Ideas
- AdMob/AdSense publisher IDs are pending-provisioning (Phase 52 smoke-tracked; publisher approval 1-2 weeks) → real fill at P70.
- Clinic-zero-ads + share/patient/dose-log exclusion is a trust + compliance invariant — must be a real guard + test, not convention.
- HealthKit firewall (Phase 55) must remain green after ad-serving code lands — add a regression test.
</specifics>

<deferred>
## Deferred Ideas
- Real ad fill (AdMob/AdSense publisher approval), on-device AdMob rendering, live eCPM/RPM data → Phase 70 HUMAN-UAT.
- Meta Audience Network / additional networks → out of scope (AdMob + AdSense only this phase).
</deferred>
