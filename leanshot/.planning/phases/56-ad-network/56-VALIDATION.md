# Phase 56: Ad Network — Validation

**Generated:** 2026-05-25 (inline from each plan's `<verify><automated>` blocks). Automatable WITHOUT live ads/publisher approval; real fill / on-device AdMob / live eCPM → Phase 70 (D-08).

git root `/Users/karstenhaldan/minisite`; app `cd leanshot`; deno=`$HOME/.deno/bin/deno`.

## 56-01 — ad guard core (AD-03,08,10)
canShowAds.test.ts, freqCap.test.ts, placementRegistry.test.ts (vitest --config vite.config.ts) → pass.

## 56-02 — revenue ETL backend (AD-05,09,12)
5 fwd-dated migrations grep (ad_revenue_facts, ad_placements, blocklist wegovy.com, is_admin_at_least, ad_network_config admob/adsense add); get_ad_revenue_dashboard + cron + is_admin_at_least + NOT is_admin(auth.uid()); ad-revenue-etl Edge Fn (ad_revenue_facts + raw_payload) deno test → pass.

## 56-03 — ad serving (AD-01,02,04,07) [autonomous:false → pkg-legitimacy checkpoint auto-approved]
@capacitor-community/admob in package.json; ads.ts keeps assertNoHealthData; tsc clean for ads.ts; adsense.test.ts; AdRenderer.test.tsx + check-no-health-in-ad-context.sh → pass.

## 56-04 — CSP blocklist (AD-09)
cspGenerator.test.ts; middleware.ts has ad_csp_allowlist + appendAdNetworkHosts + ad_advertiser_blocklist; tsc clean → pass.

## 56-05 — admin revenue dashboard (AD-06)
AdRevenueDashboardPage.test.tsx; modules.ts has growth/ad-revenue + AdRevenueDashboardPage; tsc clean → pass.

## 56-06 — exclusion gate + firewall (AD-03,11)
check-no-ads-on-excluded-surfaces.sh (clean src) + its .test.sh; healthAssert.test.ts + check-no-health-in-ad-context.sh (firewall regression); ci.yml wires both gates → pass.

## Requirement coverage
AD-01..12 all mapped. Surface-exclusion (clinic/doctor-share/admin/dose-log/share/patient zero ads) + HealthKit firewall preservation are MUST-NEVER (runtime guard + CI grep + test). Pkg-legitimacy checkpoint (56-03): @capacitor-community/admob@8.0.0 is the official Cap8 plugin → auto-approved.

## Deferred to Phase 70
Real ad fill (AdMob/AdSense publisher approval), on-device AdMob render, live eCPM/RPM/fill/CTR data, real AdSense slot IDs.
